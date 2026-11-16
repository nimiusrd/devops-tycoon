/** #1167: coverage/trace/画面撮影と分離して、変更前後を同じ条件で直列計測する。 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const [mode = 'unit', output = 'reports/review-pile', url = 'http://127.0.0.1:5174'] =
  process.argv.slice(2);
const directory = resolve(output);
await mkdir(directory, { recursive: true });
const save = (name, value) =>
  writeFile(resolve(directory, name), `${JSON.stringify(value, null, 2)}\n`);

async function measureUnit() {
  const server = await createServer({
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true },
  });
  try {
    const { planBoardScene } = await server.ssrLoadModule('/src/render/boardScene.ts');
    const { presentBoardDots } = await server.ssrLoadModule('/src/render/boardPixiView.ts');
    const { reviewPilePresentationScales } = await server.ssrLoadModule(
      '/src/render/boardPileLayout.ts',
    );
    const { makeTask } = await server.ssrLoadModule('/tests/unit/helpers/sprintFixtures.ts');
    const { RunEngine } = await server.ssrLoadModule('/src/sim/run/engine.ts');
    const tasksIn = (lane, count, offset = 0) =>
      Array.from({ length: count }, (_, index) => makeTask(offset + index + 1, { lane }));
    const piled = Array.from({ length: 15 }, (_, index) =>
      makeTask(index + 1, {
        lane: 'review',
        kind: index % 5 === 0 ? 'complex' : index % 3 === 0 ? 'routine' : 'normal',
      }),
    );
    const cases = [
      { name: 'normal-12', tasks: [...tasksIn('review', 3), ...tasksIn('coding', 9, 20)] },
      { name: 'review-9-coding-9', tasks: [...tasksIn('review', 9), ...tasksIn('coding', 9, 20)] },
      {
        name: 'review-15-flow-048',
        tasks: [...piled, makeTask(29, { lane: 'coding', progress: 0.48 })],
      },
      {
        name: 'review-15-flow-050',
        tasks: [...piled, makeTask(29, { lane: 'coding', progress: 0.5 })],
      },
    ];
    for (const seed of ['qa-seed-1031', 'qa-seed-1030', 'devops-tycoon']) {
      const engine = new RunEngine({ seed, difficulty: 'easy' });
      engine.startRun('easy', [], seed);
      engine.beginSetupSprint();
      for (let step = 0; step <= 35; step += 1) {
        if ([0, 20, 26, 30, 35].includes(step)) {
          cases.push({ name: `${seed}-step-${step}`, tasks: engine.snapshot().sprint.tasks });
        }
        engine.step(100);
      }
    }
    const results = [];
    for (const { name, tasks } of cases) {
      const start = performance.now();
      const scene = planBoardScene(tasks);
      const coldMs = performance.now() - start;
      const warmMs = [];
      for (let repeat = 0; repeat < 5; repeat += 1) {
        const warmStart = performance.now();
        planBoardScene(tasks);
        warmMs.push(performance.now() - warmStart);
      }
      const presented = reviewPilePresentationScales().map((scale) => ({
        scale,
        dots: presentBoardDots(scene.dots, scale),
      }));
      results.push({ name, coldMs, warmMs });
      await save(`${name}.json`, { tasks, scene, presented });
      console.log(name, { coldMs, warmMs });
    }
    await save('unit.json', { node: process.version, results });
  } finally {
    await server.close();
  }
}

async function measureBrowser() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const results = [];
  try {
    for (const profile of [false, true]) {
      for (const congested of [false, true]) {
        const page = await browser.newPage({
          viewport: { width: 1024, height: 768 },
          deviceScaleFactor: 1,
        });
        await page.goto(`${url}/?renderer=pixi&tutorial=off&seed=qa-seed-1031`);
        await page.waitForFunction(() => !!window.game);
        await page.evaluate(() => {
          window.game.startRun('easy', [], 'qa-seed-1031');
          window.game.pause();
        });
        await page.waitForTimeout(1500);
        await page.evaluate(() => {
          window.game.beginSetupSprint();
          window.game.pause();
        });
        await page.getByTestId('board').waitFor();
        await page.getByTestId('board-pixi-mount').locator('canvas').first().waitFor();
        await page.getByTestId('webgl-status').waitFor({ state: 'hidden' });
        const steps = await page.evaluate((advance) => {
          let steps = 0;
          while (
            advance &&
            window.game.getState().sprint.tasks.filter((t) => t.lane === 'review').length < 9
          ) {
            window.game.step(100);
            if (++steps > 100) throw new Error('Review 滞留状態に到達しない');
          }
          return steps;
        }, congested);
        await page.waitForTimeout(700);
        const name = `${congested ? 'congested' : 'normal'}-${profile ? 'profile' : 'fps'}`;
        const session = profile ? await page.context().newCDPSession(page) : null;
        if (session) {
          await session.send('Profiler.enable');
          await session.send('Profiler.start');
        }
        const measurement = await page.evaluate(
          ({ profile }) =>
            new Promise((resolve) => {
              const counts = () =>
                Object.fromEntries(
                  ['backlog', 'coding', 'review', 'rework', 'done'].map((lane) => [
                    lane,
                    window.game.getState().sprint.tasks.filter((t) => t.lane === lane).length,
                  ]),
                );
              const before = counts();
              const longTasks = [];
              const observer = profile
                ? null
                : new PerformanceObserver((list) => {
                    longTasks.push(
                      ...list
                        .getEntries()
                        .map(({ startTime, duration }) => ({ startTime, duration })),
                    );
                  });
              observer?.observe({ type: 'longtask' });
              let frames = 0;
              let maxRafMs = 0;
              const start = performance.now();
              let last = start;
              let raf;
              const frame = (now) => {
                frames += 1;
                maxRafMs = Math.max(maxRafMs, now - last);
                last = now;
                raf = requestAnimationFrame(frame);
              };
              if (!profile) raf = requestAnimationFrame(frame);
              window.game.resume();
              setTimeout(
                () => {
                  window.game.pause();
                  const elapsedMs = performance.now() - start;
                  cancelAnimationFrame(raf);
                  if (observer) {
                    longTasks.push(
                      ...observer
                        .takeRecords()
                        .map(({ startTime, duration }) => ({ startTime, duration })),
                    );
                    observer.disconnect();
                  }
                  resolve({
                    before,
                    after: counts(),
                    elapsedMs,
                    frames,
                    fps: (frames * 1000) / elapsedMs,
                    maxRafMs,
                    longTaskMs: longTasks.reduce((sum, t) => sum + t.duration, 0),
                    longTasks,
                  });
                },
                profile ? 8000 : 12000,
              );
            }),
          { profile },
        );
        if (session) {
          const { profile: cpuProfile } = await session.send('Profiler.stop');
          await save(`${name}.cpuprofile`, cpuProfile);
          await session.detach();
        }
        results.push({ name, steps, ...measurement });
        console.log(name, measurement);
        await page.close();
      }
    }
    await save('browser.json', {
      node: process.version,
      chromium: browser.version(),
      url,
      results,
    });
  } finally {
    await browser.close();
  }
}

if (mode === 'unit') await measureUnit();
else if (mode === 'browser') await measureBrowser();
else throw new Error('unit または browser を指定してください');

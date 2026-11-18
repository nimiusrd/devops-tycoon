import type { Page } from '@playwright/test';
import type { GameHandle } from '../../src/game';
import type { RunSave } from '../../src/state/runPersistence';
import {
  REPLAY_SCHEMA_VERSION,
  snapshotReplayContent,
  type ReplayBlob,
} from '../../src/state/replay';
import {
  advanceCurrentSprintToResult,
  advanceCurrentSprintToReviewQueue,
  expect,
  test,
} from './fixtures';
import { planBoardScene } from '../../src/render/boardScene';
import { designToClient, readBoardCanvasFrame } from './boardCanvasPoint';
import { assignableTasks } from '../../src/sim/assignTask';

type CultureWindow = Window & {
  game: GameHandle;
  __boardPixiTest?: { freezeForScreenshot(): void };
};

const SEED = 'office-culture-680';
const VIEWPORTS = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'desktop-short', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

/** 公開save export/importで所持条件だけを変える。エンジン内部は参照しない。 */
async function importCultureSetup(
  page: Page,
  relics: string[],
  difficulty: 'easy' | 'hard' = 'easy',
  seed = SEED,
): Promise<RunSave> {
  await page.goto(`/?renderer=pixi&seed=${seed}`);
  await expect(page.getByTestId('title')).toBeVisible();
  return page.evaluate(
    async ({ seed, relics, difficulty }) => {
      const g = (window as CultureWindow).game;
      g.startRun(difficulty, [], seed);
      g.pause();
      const raw = g.exportRunSaveText();
      if (!raw) throw new Error('setup save missing');
      const save = JSON.parse(raw) as RunSave;
      save.state.relics = relics;
      const result = await g.importRunSaveText(JSON.stringify(save));
      if (!result.ok || !g.resumeRun()) throw new Error('setup import failed');
      g.pause();
      return save;
    },
    { seed, relics, difficulty },
  );
}

async function beginBoard(page: Page) {
  await page.evaluate(() => {
    const g = (window as CultureWindow).game;
    g.beginSetupSprint();
    g.pause();
  });
  await expect(page.getByTestId('board')).toHaveAttribute('data-effect-renderer', 'pixi');
  await expect(page.getByTestId('board-pixi-mount')).toHaveAttribute('data-board-assets', '5');
}

async function openCultureDescription(page: Page) {
  const toggle = page.getByTestId('runbar-details-toggle');
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
  const summary = page.getByTestId('office-culture-details').locator('summary');
  await expect(summary).toBeVisible();
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('office-culture-description')).toBeVisible();
}

async function assertBoardContract(page: Page) {
  const board = page.getByTestId('board');
  await expect(board).toHaveAttribute('data-effect-renderer', 'pixi');
  // resize後のAspectStage計測と幅モードの反映が揃ってから寸法を読む。
  await expect
    .poll(async () => {
      const box = await board.boundingBox();
      return box ? Math.abs(box.width / box.height / (1404 / 573) - 1) : Infinity;
    })
    .toBeLessThan(0.01);
  const box = await board.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(240);
  expect(box!.height).toBeGreaterThanOrEqual(96);
  expect(Math.abs(box!.width / box!.height / (1404 / 573) - 1)).toBeLessThan(0.01);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  // 背景SVGは操作を受けず、動的な人物・粒は実WebGLへ残す。
  expect(
    await page
      .getByTestId('office-culture-marker')
      .evaluate((el) => getComputedStyle(el).pointerEvents),
  ).toBe('none');
  await expect(page.getByTestId('board-pixi-mount').locator('canvas')).toBeVisible();
  await expect(page.getByTestId('board-flow-summary')).toBeVisible();
}

for (const motion of ['no-preference', 'reduce'] as const) {
  test(`文化掲示は5viewportの実WebGL合成とHTML説明を維持する ${motion} @pixi`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: motion });
    await importCultureSetup(page, ['psych-safety', 'small-pr', 'strong-ci']);
    await beginBoard(page);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await expect(page.getByTestId('office-culture-marker')).toHaveCount(1);
      await expect(page.getByTestId('office-culture-marker').locator('title')).toContainText(
        '小さく出す文化',
      );
      await openCultureDescription(page);
      await expect(page.getByTestId('office-culture-description')).toContainText('x1.15');
      await assertBoardContract(page);
      await page.screenshot({
        path: testInfo.outputPath(`culture-description-${viewport.name}.png`),
        fullPage: true,
        animations: 'disabled',
      });
      // 閉じた既定レイアウトで同seedの合成画像を比較する。
      await page.getByTestId('office-culture-details').locator('summary').click();
      const toggle = page.getByTestId('runbar-details-toggle');
      if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) === 'true')
        await toggle.click();
      await page.evaluate(() => (window as CultureWindow).__boardPixiTest!.freezeForScreenshot());
      await expect(page.getByTestId('board')).toHaveScreenshot(
        `office-culture-${viewport.name}-${motion}.png`,
        { animations: 'disabled', maxDiffPixelRatio: 0.02 },
      );
    }
  });
}

test('未所持・保存再開・次スプリント・新ランで実所持に追従する @pixi', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await importCultureSetup(page, []);
  await beginBoard(page);
  await expect(page.getByTestId('office-culture-marker')).toHaveCount(0);
  await expect(page.getByTestId('office-culture-details')).toHaveCount(0);
  await page.evaluate(() => (window as CultureWindow).__boardPixiTest!.freezeForScreenshot());
  await expect(page.getByTestId('board')).toHaveScreenshot('office-culture-unowned.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.02,
  });
  await importCultureSetup(page, ['small-pr']);
  await page.reload();
  await expect(page.getByTestId('title')).toBeVisible();
  await page.evaluate(() => {
    const g = (window as CultureWindow).game;
    g.resumeRun();
    g.pause();
  });
  await beginBoard(page);
  await expect(page.getByTestId('office-culture-marker')).toHaveCount(1);
  await advanceCurrentSprintToResult(page);
  const resultSave = await page.evaluate(() => (window as CultureWindow).game.exportRunSaveText());
  expect(resultSave).not.toBeNull();
  const nextSetup = JSON.parse(resultSave!) as RunSave;
  nextSetup.state.phase = 'setup';
  nextSetup.summary.phase = 'setup';
  nextSetup.state.sprintIndexInQuarter += 1;
  nextSetup.summary.sprintIndexInQuarter += 1;
  await page.evaluate(async (save) => {
    const g = (window as CultureWindow).game;
    const imported = await g.importRunSaveText(JSON.stringify(save));
    if (!imported.ok) throw new Error('next setup import failed');
    g.resumeRun();
    g.pause();
  }, nextSetup);
  await beginBoard(page);
  await expect(page.getByTestId('office-culture-marker')).toHaveCount(1);
  await page.evaluate(() => {
    const g = (window as CultureWindow).game;
    g.startRun('easy', [], 'office-culture-new-run');
    g.pause();
  });
  await beginBoard(page);
  await expect(page.getByTestId('office-culture-marker')).toHaveCount(0);
  await expect(page.getByTestId('office-culture-details')).toHaveCount(0);
});

test('リプレイの所持時点・記録定義・旧記録を現在のランへ差し替えない', async ({ page }) => {
  const save = await importCultureSetup(page, ['small-pr']);
  const owned = structuredClone(save.state);
  const unowned = { ...structuredClone(owned), relics: [] };
  const keyframes: ReplayBlob['keyframes'] = [
    { phase: 'setup', frame: unowned },
    { phase: 'setup', frame: owned },
  ];
  const content = snapshotReplayContent(keyframes);
  const recorded = content.relics.find((relic) => relic.id === 'small-pr')!;
  recorded.name = '記録時の小さく出す文化';
  recorded.description = '記録時の掲示説明';
  recorded.effects = { reviewEfficiencyMul: 1.4 };
  const replay: ReplayBlob = {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    id: 'office-culture-replay',
    seed: save.summary.seed,
    difficulty: save.summary.difficulty,
    trials: save.summary.trials,
    finishedAt: 1,
    outcome: { status: 'won', diagnosis: owned.diagnosis, score: 0 },
    keyframes,
    ruleset: save.ruleset,
    contentSnapshot: content,
  };
  expect(
    await page.evaluate(
      async (blob) => (window as CultureWindow).game.importReplayText(JSON.stringify(blob)),
      replay,
    ),
  ).toMatchObject({ ok: true });
  await page.evaluate((id) => (window as CultureWindow).game.openReplay(id, 0), replay.id);
  await expect(page.getByTestId('office-culture-details')).toHaveCount(0);
  await page.evaluate((id) => (window as CultureWindow).game.openReplay(id, 1), replay.id);
  await openCultureDescription(page);
  await expect(page.getByTestId('office-culture-description')).toContainText('記録時の掲示説明');
  await expect(page.getByTestId('office-culture-description')).toContainText('x1.4');
  await expect(page.getByTestId('office-culture-description')).not.toContainText('x1.15');
  // リプレイは離散フレーム。未記録の動的盤面を再構成しない。
  await expect(page.getByTestId('office-culture-marker')).toHaveCount(0);
  await page.evaluate(() => (window as CultureWindow).game.exitReplay());
  expect(
    await page.evaluate(
      async (blob) =>
        (window as CultureWindow).game.importReplayText(
          JSON.stringify({
            ...blob,
            schemaVersion: 1,
            id: 'office-culture-legacy',
            contentSnapshot: null,
            ruleset: null,
          }),
        ),
      replay,
    ),
  ).toMatchObject({ ok: true });
  await page.evaluate(() => (window as CultureWindow).game.openReplay('office-culture-legacy', 1));
  await openCultureDescription(page);
  await expect(page.getByTestId('office-culture-details').locator('summary')).toContainText(
    '不明なレリック（small-pr）',
  );
  await expect(page.getByTestId('office-culture-description')).toHaveText(
    '記録時のレリック定義が見つかりません。',
  );
});

test('掲示がある盤面でも既存座標のタスク差配が確定する @pixi', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await importCultureSetup(page, ['small-pr']);
  await beginBoard(page);
  await page.getByTestId('action-assignTask').click();
  const sprint = await page.evaluate(() => (window as CultureWindow).game.getState().sprint!);
  const candidateIds = new Set(assignableTasks(sprint).map((task) => task.id));
  const dot = planBoardScene(sprint.tasks).dots.find((dot) => candidateIds.has(dot.id))!;
  const frame = await readBoardCanvasFrame(page);
  const from = designToClient(frame, dot);
  const to = designToClient(frame, { x: 620, y: 260 });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as CultureWindow).game.getState().sprint!.metrics.actionCounts.assignTask ?? 0,
      ),
    )
    .toBe(1);
});

test('所持文化とReview Hellの警告を5viewportで併記できる @pixi', async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await importCultureSetup(page, ['small-pr'], 'hard', 'ri141-review-pressure-0');
  await beginBoard(page);
  await advanceCurrentSprintToReviewQueue(page, 12);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await assertBoardContract(page);
    await expect(page.getByTestId('board')).toHaveAttribute('data-review-hell', 'true');
    await expect(
      page.getByTestId('board').locator('[data-lane="review"] .board-flow-alert'),
    ).toHaveText('要対応');
    await expect(page.getByTestId('jam-alert')).toBeVisible();
    await expect(page.getByTestId('office-culture-marker')).toHaveCount(1);
  }
  await page.evaluate(() => (window as CultureWindow).__boardPixiTest!.freezeForScreenshot());
  await expect(page.getByTestId('board')).toHaveScreenshot('office-culture-review-hell.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.02,
  });
});

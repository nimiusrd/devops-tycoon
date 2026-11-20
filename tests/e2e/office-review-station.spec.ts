import type { Page } from '@playwright/test';
import { planBoardScene } from '../../src/render/boardScene';
import { assignableTasks } from '../../src/sim/assignTask';
import {
  REPLAY_SCHEMA_VERSION,
  snapshotReplayContent,
  type ReplayBlob,
} from '../../src/state/replay';
import type { RunSave } from '../../src/state/runPersistence';
import { designToClient, readBoardCanvasFrame } from './boardCanvasPoint';
import {
  advanceCurrentResultToDraft,
  advanceCurrentSprintToReviewQueue,
  advanceCurrentSprintToResult,
  beginPublicSprint,
  expect,
  test,
} from './fixtures';

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

test.describe.configure({ timeout: 90_000 });

async function openReviewDetails(page: Page) {
  const toggle = page.getByTestId('runbar-details-toggle');
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
  const summary = page.getByTestId('office-review-details').locator('summary');
  await expect(summary).toBeVisible();
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('office-review-description')).toBeVisible();
  return summary;
}

async function expectBoardReady(page: Page) {
  await expect(page.getByTestId('board')).toHaveAttribute('data-effect-renderer', 'pixi', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('board-pixi-mount')).toHaveAttribute('data-board-assets', '5', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('board-pixi-mount').locator('canvas')).toBeVisible();
}

async function beginBoard(page: Page) {
  await page.evaluate(() => {
    window.game!.beginSetupSprint();
    window.game!.pause();
  });
  await expectBoardReady(page);
}

test('進化の解放で設備が現れ、次スプリントと通常セーブの再開にも残る @pixi', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await beginPublicSprint(page, { seed: 'evo-overlay-pause', difficulty: 'easy' });
  await expectBoardReady(page);
  const marker = page.getByTestId('office-review-station');
  await expect(marker).toHaveCount(0);
  await advanceCurrentSprintToResult(page);
  await advanceCurrentResultToDraft(page);
  await page.evaluate(() => window.game!.skipDraft());
  const unlock = page.getByTestId('evo-review-1');
  const name = await unlock.locator('.evo-name').innerText();
  const tags = await page.getByTestId('evo-effect-tags-review-1').innerText();
  await unlock.click();
  await expect(unlock).toContainText('解放済み');
  await expect(marker.locator('title')).toHaveText(name);

  await page.getByTestId('evolution-done').click();
  await expect(page.getByTestId('beat')).toBeVisible();
  await page.evaluate(() => {
    window.game!.resolveBeat(0);
    if (window.game!.getState().phase === 'shop') window.game!.leaveShop();
    if (window.game!.getState().phase === 'recruit') window.game!.recruitChoose('skip');
    if (window.game!.getState().phase === 'rest') window.game!.restChoose('heal');
  });
  await expect(page.getByTestId('setup')).toBeVisible();
  const state = await page.evaluate(() => window.game!.getState());
  expect(state.sprintIndexInQuarter).toBe(1);
  expect(state.evolution.unlocked['review-1']).toBe(true);
  const setupSave = await page.evaluate(() => {
    const raw = window.game!.exportRunSaveText();
    if (!raw) throw new Error('次のスプリント準備を保存できませんでした');
    return JSON.parse(raw) as RunSave;
  });
  await beginBoard(page);
  await expect(marker).toHaveAttribute('data-evolution-id', 'review-1');
  await openReviewDetails(page);
  await expect(page.getByTestId('office-review-description')).toHaveText(
    'レビュアーの受入容量を拡大する',
  );
  await expect(page.getByTestId('office-review-effects')).toHaveText(tags);
  await page.getByTestId('runbar-details-toggle').click();

  await page.getByTestId('action-assignTask').click();
  const sprint = await page.evaluate(() => window.game!.getState().sprint!);
  const candidates = new Set(assignableTasks(sprint).map((task) => task.id));
  const dot = planBoardScene(sprint.tasks).dots.find((item) => candidates.has(item.id))!;
  const frame = await readBoardCanvasFrame(page);
  const from = designToClient(frame, dot);
  const to = designToClient(frame, { x: 620, y: 260 });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() => window.game!.getState().sprint!.metrics.actionCounts.assignTask ?? 0),
    )
    .toBe(1);

  const imported = await page.evaluate(async (save) => {
    return (await window.game!.importRunSaveText(JSON.stringify(save))).ok;
  }, setupSave);
  expect(imported).toBe(true);
  await page.reload();
  await page.getByTestId('resume-run').click();
  const profile = page.getByTestId('setup').getByTestId('company-profile');
  await profile.getByTestId('company-profile-summary').click();
  await profile.getByTestId('company-profile-branch-review').locator('summary').click();
  await expect(profile.getByTestId('company-profile-node-review-1')).toContainText('解放済み');
  await beginBoard(page);
  await expect(marker.locator('title')).toHaveText(name);
});

for (const motion of ['no-preference', 'reduce'] as const) {
  test(`設備と文化掲示は5 viewportで警告・操作と共存する ${motion} @pixi`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: motion });
    const seed = 'ri141-review-pressure-0';
    await page.goto(`/?renderer=pixi&seed=${seed}`);
    await expect(page.getByTestId('title')).toBeVisible();
    const imported = await page.evaluate(async (runSeed) => {
      const game = window.game!;
      game.startRun('hard', [], runSeed);
      const raw = game.exportRunSaveText();
      if (!raw) throw new Error('準備状態を保存できませんでした');
      const save: RunSave = JSON.parse(raw);
      save.state.evolution.unlocked['review-1'] = true;
      save.state.relics = ['small-pr'];
      return (await game.importRunSaveText(JSON.stringify(save))).ok && !!game.resumeRun();
    }, seed);
    expect(imported).toBe(true);
    await beginBoard(page);
    const marker = page.getByTestId('office-review-station');
    const board = page.getByTestId('board');
    await advanceCurrentSprintToReviewQueue(page, 12);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await expect
        .poll(async () => {
          const bounds = await board.boundingBox();
          return (
            bounds !== null &&
            bounds.width >= 240 &&
            bounds.height >= 96 &&
            Math.abs(bounds.width / bounds.height / (1404 / 573) - 1) < 0.01
          );
        })
        .toBe(true);
      await expect(marker).toBeVisible();
      await expect(page.getByTestId('office-culture-marker')).toBeVisible();
      await expect(board).toHaveAttribute('data-review-hell', 'true');
      await expect(page.getByTestId('jam-alert')).toBeVisible();
      expect(await marker.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe(
        'none',
      );
      const overlapsSummary = await marker.evaluate((element) => {
        const station = element.getBoundingClientRect();
        const summary = document
          .querySelector('[data-testid="board-flow-summary"]')!
          .getBoundingClientRect();
        return (
          station.left < summary.right &&
          station.right > summary.left &&
          station.top < summary.bottom &&
          station.bottom > summary.top
        );
      });
      expect(overlapsSummary).toBe(false);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await testInfo.attach(`board-${viewport.width}`, {
        body: await board.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      });
      const summary = await openReviewDetails(page);
      await expect(summary).toBeFocused();
      await expect(page.getByTestId('office-review-effects')).toContainText('レビュー容量 x1.20');
      await testInfo.attach(`details-${viewport.width}`, {
        body: await page.getByTestId('runbar').screenshot({
          animations: 'disabled',
        }),
        contentType: 'image/png',
      });
      await page.keyboard.press('Space');
      await expect(page.getByTestId('office-review-description')).toBeHidden();
      await page.getByTestId('runbar-details-toggle').click();
    }
  });
}

test('リプレイは選択したフレームの解放状態を使い、記録のない効果を表示しない', async ({ page }) => {
  await page.goto('/?seed=office-review-replay');
  await expect(page.getByTestId('title')).toBeVisible();
  const save = await page.evaluate(() => {
    const game = window.game!;
    game.startRun('easy', [], 'office-review-replay');
    const raw = game.exportRunSaveText();
    if (!raw) throw new Error('準備状態を保存できませんでした');
    return JSON.parse(raw) as RunSave;
  });
  const owned = structuredClone(save.state);
  owned.evolution.unlocked['review-1'] = true;
  const keyframes: ReplayBlob['keyframes'] = [
    { phase: 'setup', frame: save.state },
    { phase: 'setup', frame: owned },
  ];
  const replay: ReplayBlob = {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    id: 'office-review-replay',
    seed: save.summary.seed,
    difficulty: save.summary.difficulty,
    trials: save.summary.trials,
    finishedAt: 1,
    outcome: { status: 'won', diagnosis: owned.diagnosis, score: 0 },
    keyframes,
    ruleset: save.ruleset,
    contentSnapshot: snapshotReplayContent(keyframes),
  };
  expect(
    await page.evaluate((blob) => window.game!.importReplayText(JSON.stringify(blob)), replay),
  ).toMatchObject({ ok: true });
  await page.evaluate((id) => window.game!.openReplay(id, 0), replay.id);
  await expect(page.getByTestId('office-review-details')).toHaveCount(0);
  await page.evaluate((id) => window.game!.openReplay(id, 1), replay.id);
  await openReviewDetails(page);
  await expect(page.getByTestId('office-review-description')).toHaveText(
    '記録時の進化効果の説明はありません。',
  );
  await expect(page.getByTestId('office-review-effects')).toHaveCount(0);
  await expect(page.getByTestId('office-review-station')).toHaveCount(0);
});

import type { Page } from '@playwright/test';
import { ACTION_DEFS } from '../../src/data/actions';
import { ANDON_STABILITY_REVIEW_MIN } from '../../src/sim/actions';
import {
  advanceCurrentSprintToReviewQueue,
  beginPublicSprint,
  expect,
  test,
  type PublicGameWindow,
} from './fixtures';

const SEED = 'ri141-review-pressure-0';
const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

async function beginReviewCommandSprint(page: Page) {
  await page.goto(`/?rd=review-command&seed=${SEED}`);
  await expect(page.getByTestId('title')).toBeVisible();
  await page.evaluate((seed) => {
    const game = (window as PublicGameWindow).game!;
    game.startRun('hard', [], seed);
    game.pause();
    game.beginSetupSprint();
    game.pause();
  }, SEED);
  await expect(page.getByTestId('board')).toHaveAttribute('data-effect-renderer', 'pixi', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('webgl-status')).toHaveCount(0);
}

async function readSprint(page: Page) {
  return page.evaluate(() => {
    const state = (window as PublicGameWindow).game!.getState();
    const sprint = state.sprint!;
    return {
      tick: state.sprintTick,
      queue: sprint.tasks.filter((task) => task.lane === 'review').length,
      incidents: sprint.tasks.filter((task) => task.lane === 'rework' && task.incident).length,
      focusSpent: sprint.metrics.focusSpent,
      actionCounts: sprint.metrics.actionCounts,
      interventionEvents: sprint.interventionEvents.length,
      lastIntervention: sprint.interventionEvents.at(-1)?.effect,
      andonUntilTick: sprint.modifiers.andonUntilTick,
    };
  });
}

test('通常のランでは8介入の固定順と即時操作を保つ', async ({ page }) => {
  await beginPublicSprint(page, { seed: SEED, difficulty: 'hard' });
  await expect(page.getByTestId('review-command-trigger')).toHaveCount(0);
  await expect(page.getByTestId('review-command-panel')).toHaveCount(0);
  await expect
    .poll(() =>
      page
        .locator('.actions .action')
        .evaluateAll((items) => items.map((item) => item.getAttribute('data-testid'))),
    )
    .toEqual(ACTION_DEFS.map(({ id }) => `action-${id}`));
  const before = await readSprint(page);
  await page.getByTestId('action-overtime').click();
  const after = await readSprint(page);
  expect(after.actionCounts.overtime).toBe((before.actionCounts.overtime ?? 0) + 1);
});

test('工程選択と確認をキーボードで取り消せる。空のレビューと一時停止を説明する', async ({
  page,
}) => {
  await beginReviewCommandSprint(page);
  const before = await readSprint(page);
  expect(before.queue).toBe(0);
  const trigger = page.getByTestId('review-command-trigger');
  const confirm = page.getByTestId('review-command-confirm');
  const interrupt = page.getByTestId('review-command-interruptReview');
  const pair = page.getByTestId('review-command-pairReview');
  const panel = page.getByTestId('review-command-panel');
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(interrupt).toBeFocused();
  await page.keyboard.press('Space');
  await expect(interrupt).toHaveAttribute('aria-pressed', 'true');
  await expect(confirm).toBeDisabled();
  await expect(panel.getByRole('status')).toHaveText('レビュー待ちなし');
  await page.keyboard.press('Tab');
  await expect(pair).toBeFocused();
  await page.keyboard.press('Space');
  await expect(panel).toContainText('レビュー処理なし');
  await expect(confirm).toBeEnabled();
  await page.keyboard.press('Shift+Tab');
  await expect(interrupt).toBeFocused();

  await page.getByTestId('speed-pause').click();
  await expect(panel.getByRole('status')).toHaveText('一時停止中');
  await expect(confirm).toBeDisabled();
  await pair.focus();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(await readSprint(page)).toEqual(before);
});

test('アンドンの代償変更を再確認し、実行結果とクールダウンを既存盤面に返す', async ({ page }) => {
  await beginReviewCommandSprint(page);
  await page.getByTestId('review-command-trigger').click();
  await page.getByTestId('review-command-andon').click();
  const panel = page.getByTestId('review-command-panel');
  const confirm = page.getByTestId('review-command-confirm');
  await expect(panel).toContainText('シニアHP');
  await expect(page.locator('.board-flow-list [data-lane="backlog"]')).toHaveAttribute(
    'data-action-target',
    'true',
  );

  await advanceCurrentSprintToReviewQueue(page, ANDON_STABILITY_REVIEW_MIN);
  const before = await readSprint(page);
  await expect(panel).not.toContainText('シニアHP');
  await expect(confirm).toHaveText('変更を確認');
  await confirm.click();
  expect(await readSprint(page)).toEqual(before);
  await expect(confirm).toHaveText('実行する');
  await confirm.click();

  const after = await readSprint(page);
  expect(after.actionCounts.andon).toBe((before.actionCounts.andon ?? 0) + 1);
  expect(after.interventionEvents).toBe(before.interventionEvents + 1);
  expect(after.focusSpent).toBeGreaterThan(before.focusSpent);
  expect(after.andonUntilTick).toBeGreaterThan(after.tick);
  expect(after.lastIntervention?.moraleCost).toBeGreaterThan(0);
  expect(after.lastIntervention?.hpCost).toBeUndefined();
  await expect(page.getByTestId('board-pixi-mount')).toHaveAttribute('data-board-auras', '1');
  await expect(page.getByTestId('event-ticker')).toContainText('アンドン');
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId('review-command-trigger')).toBeFocused();
  await page.getByTestId('review-command-trigger').click();
  await page.getByTestId('review-command-andon').click();
  await expect(panel.getByRole('status')).toContainText('クールダウン中');
  await expect(confirm).toBeDisabled();
});

test('ペアレビューの対象が消えると、習熟だけの介入へ切り替わる前に再確認する', async ({ page }) => {
  await beginReviewCommandSprint(page);
  await advanceCurrentSprintToReviewQueue(page, 1, 1);
  await page.getByTestId('review-command-trigger').click();
  await page.getByTestId('review-command-pairReview').click();
  await expect(page.getByTestId('review-command-facts')).toContainText('現在 1件');
  await page.evaluate(() => (window as PublicGameWindow).game!.dispatch('interruptReview'));
  const before = await readSprint(page);
  expect(before.queue).toBe(0);

  const confirm = page.getByTestId('review-command-confirm');
  await expect(page.getByTestId('review-command-facts')).toContainText('レビュー処理なし');
  await expect(confirm).toHaveText('変更を確認');
  await confirm.press('Enter');
  expect(await readSprint(page)).toEqual(before);
  await confirm.press('Enter');
  const after = await readSprint(page);
  expect(after.actionCounts.pairReview).toBe((before.actionCounts.pairReview ?? 0) + 1);
  expect(after.lastIntervention?.reviewedCount).toBe(0);
  expect(after.lastIntervention?.literacyGain).toBeGreaterThan(0);
  await expect(page.getByTestId('review-command-panel')).toHaveCount(0);

  await page.evaluate(() => {
    const game = (window as PublicGameWindow).game!;
    game.dispatch('overtime');
    game.dispatch('aiThrottle');
  });
  await page.getByTestId('review-command-trigger').click();
  await page.getByTestId('review-command-andon').click();
  await expect(page.getByTestId('review-command-panel').getByRole('status')).toHaveText(
    '集中力不足',
  );
  await expect(confirm).toBeDisabled();
});

test('炎上中の盤面・警告と操作欄は主要5 viewportで重ならない', async ({ page }) => {
  await beginReviewCommandSprint(page);
  await advanceCurrentSprintToReviewQueue(page, 12);
  const burning = await page.evaluate(() => {
    const game = (window as PublicGameWindow).game!;
    for (let i = 0; i < 250; i += 1) {
      const state = game.getState();
      if (state.phase !== 'sprint') return false;
      if (state.sprint?.tasks.some((task) => task.lane === 'rework' && task.incident)) return true;
      game.step(100);
    }
    return false;
  });
  expect(burning).toBe(true);

  const trigger = page.getByTestId('review-command-trigger');
  await trigger.click();
  await page.getByTestId('review-command-interruptReview').click();
  const panel = page.getByTestId('review-command-panel');
  const canvas = page.getByTestId('board');
  const warning = page.getByTestId('fire-count');
  const flow = page.getByTestId('board-flow-summary');
  const ticker = page.getByTestId('event-ticker');
  const cancel = panel.getByRole('button', { name: '取消' });
  for (const [index, viewport] of VIEWPORTS.entries()) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: index % 2 === 0 ? 'reduce' : 'no-preference' });
    await cancel.scrollIntoViewIfNeeded();
    await expect(cancel).toBeInViewport({ ratio: 1 });
    await expect(warning).toContainText('炎上');
    await expect(canvas).toHaveAttribute('data-effect-renderer', 'pixi');
    const boardBox = await canvas.boundingBox();
    const panelBox = await panel.boundingBox();
    const alertBox = await warning.boundingBox();
    expect(boardBox?.height).toBeGreaterThanOrEqual(97);
    expect(panelBox?.y).toBeGreaterThanOrEqual(boardBox!.y + boardBox!.height);
    expect(panelBox?.y).toBeGreaterThanOrEqual(alertBox!.y + alertBox!.height);
    expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(viewport.width);
    if (viewport.width >= 1024) {
      const flowBox = await flow.boundingBox();
      const tickerBox = await ticker.boundingBox();
      expect(flowBox!.x + flowBox!.width).toBeLessThanOrEqual(tickerBox!.x);
    }
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  }
  await cancel.click();
  await expect(panel).toHaveCount(0);
});

test.describe('320×568のタッチ操作', () => {
  test.use({ hasTouch: true, viewport: { width: 320, height: 568 }, reducedMotion: 'reduce' });

  test('工程から割り込みレビューを明示確定し、結果を盤面へ反映する', async ({ page }) => {
    await beginReviewCommandSprint(page);
    await advanceCurrentSprintToReviewQueue(page, 8, 11);
    const before = await readSprint(page);
    const trigger = page.getByTestId('review-command-trigger');
    const board = page.getByTestId('board');
    const priorEffect = Number(await board.getAttribute('data-effect-sequence'));
    await trigger.tap();
    await page.getByTestId('review-command-interruptReview').tap();
    await expect(page.getByTestId('review-command-facts')).toContainText('集中力');
    await expect(page.getByTestId('review-command-facts')).toContainText('シニアHP');
    expect(await readSprint(page)).toEqual(before);
    await page.getByTestId('review-command-confirm').tap();

    const after = await readSprint(page);
    expect(after.actionCounts.interruptReview).toBe((before.actionCounts.interruptReview ?? 0) + 1);
    expect(after.queue).toBeLessThan(before.queue);
    expect(after.lastIntervention?.reviewedCount).toBeGreaterThan(0);
    await expect
      .poll(async () => Number(await board.getAttribute('data-effect-sequence')))
      .toBeGreaterThan(priorEffect);
    await expect(page.getByTestId('event-ticker')).toBeVisible();
    await expect(page.getByTestId('event-ticker')).toContainText('割り込みレビュー');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});

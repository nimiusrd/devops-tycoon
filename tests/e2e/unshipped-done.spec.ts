import { advanceCurrentSprintToResult, expect, test } from './fixtures';
import type { PublicGameWindow } from './fixtures';

/**
 * Issue #939: コーダー不在で出荷 0 のとき、未出荷を Done の山へ入れない。
 * Easy の通常タスク床は 58。以前は打ち切りで Done 58 / +44 になっていた。
 */
test('レビューだけの編成では出荷 0 でも Done は 0 で +N が出ない', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?renderer=pixi&tutorial=off&seed=devops-tycoon');
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  await expect(page.getByTestId('setup')).toBeVisible();

  const memberIds = await page.evaluate(() => {
    const game = (window as PublicGameWindow).game;
    if (!game) throw new Error('window.game が公開されていない');
    game.pause();
    return game.getState().roster.members.map((member) => member.id);
  });
  expect(memberIds.length).toBeGreaterThan(0);
  for (const id of memberIds) {
    await page.getByTestId(`assign-${id}-review`).click();
    await expect(page.getByTestId(`assign-${id}-review`)).toHaveClass(/active/);
  }

  await page.getByTestId('begin-sprint').click();
  await expect(page.getByTestId('setup-no-coder-confirm')).toBeVisible();
  await page.getByTestId('setup-no-coder-begin').click();
  await expect(page.getByTestId('board')).toHaveAttribute('data-effect-renderer', 'pixi');
  await expect(page.getByTestId('webgl-status')).toHaveCount(0);

  const mid = await page.evaluate(() => {
    const game = (window as PublicGameWindow).game;
    if (!game) throw new Error('window.game が公開されていない');
    game.pause();
    for (let i = 0; i < 8; i += 1) game.step(100);
    const state = game.getState();
    const tasks = state.sprint?.tasks ?? [];
    return {
      codingSlots: state.sprint?.config.codingSlots ?? -1,
      doneLane: tasks.filter((task) => task.lane === 'done').length,
      backlog: tasks.filter((task) => task.lane === 'backlog').length,
      doneCount: state.sprint?.metrics.doneCount ?? -1,
      delivered: state.sprint?.metrics.delivered ?? -1,
    };
  });
  expect(mid.codingSlots).toBe(0);
  expect(mid.doneLane).toBe(0);
  expect(mid.backlog).toBe(58);
  expect(mid.doneCount).toBe(0);
  expect(mid.delivered).toBe(0);

  await expect(page.getByTestId('count-done')).toHaveText('0');
  await expect(page.getByTestId('overflow-done')).toHaveCount(0);
  await expect(page.getByTestId('count-backlog')).toHaveText('58');
  await page.screenshot({
    path: testInfo.outputPath('sprint-zero-ship-board.png'),
    fullPage: false,
  });

  const finished = await advanceCurrentSprintToResult(page);
  expect(finished.lastResult?.done).toBe(0);
  expect(finished.lastResult?.delivered).toBe(0);
  const highlights = page.locator('.result-highlights .result-row');
  await expect(highlights.filter({ hasText: '完了' }).locator('dd')).toHaveText('0件');
  await expect(highlights.filter({ hasText: '出荷' }).locator('dd')).toHaveText('0pt');
  await page.screenshot({
    path: testInfo.outputPath('sprint-zero-ship-result.png'),
    fullPage: false,
  });
});

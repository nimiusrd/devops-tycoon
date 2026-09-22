/**
 * RI-146: タスク差配・PR分割を HTML 対象選択で完了できる。
 */
import { beginPublicSprint, expect, test } from './fixtures';
import type { ActionTarget, InterventionOutcome } from '../../src/sim/types';
import type { RunState } from '../../src/sim/run/types';

type GameWindow = Window & {
  game?: {
    pause(): void;
    getState(): RunState;
    step(ms: number): RunState;
    dispatch(id: string, target?: ActionTarget): InterventionOutcome;
  };
};

async function waitForBoardReady(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.getByTestId('board')).toHaveAttribute('data-effect-renderer', 'pixi');
  await expect(page.getByTestId('webgl-status')).toHaveCount(0);
}

async function advanceUntil(
  page: import('@playwright/test').Page,
  predicate: () => number | null,
  message: string,
): Promise<number> {
  const taskId = await page.evaluate((label) => {
    const g = (window as GameWindow).game!;
    g.pause();
    let guard = 0;
    let state = g.getState();
    while (guard < 4000) {
      const sprint = state.sprint;
      if (sprint && !sprint.complete) {
        const coding = sprint.tasks.filter((t) => t.lane === 'coding');
        const splitCandidates = sprint.tasks.filter(
          (t) => (t.lane === 'review' || t.lane === 'coding') && !t.split,
        );
        if (label === 'coding' && coding.length > 0 && sprint.focus >= 2) {
          return coding[0]!.id;
        }
        if (label === 'split' && splitCandidates.length > 0 && sprint.focus >= 2) {
          return splitCandidates[0]!.id;
        }
      }
      state = g.step(100);
      g.pause();
      guard += 1;
    }
    throw new Error(`${label} 候補を用意できませんでした`);
  }, message);
  return taskId;
}

test('タスク差配を HTML 対象選択で完了できる（RI-146）', async ({ page }) => {
  await beginPublicSprint(page, { seed: 'ri146-assign-picker' });
  await waitForBoardReady(page);
  const taskId = await advanceUntil(page, () => null, 'coding');

  const assign = page.getByTestId('action-assignTask');
  await expect(assign).toBeEnabled();

  const before = await page.evaluate((id) => {
    const g = (window as GameWindow).game!;
    const task = g.getState().sprint!.tasks.find((t) => t.id === id)!;
    return { progress: task.progress, focus: g.getState().sprint!.focus };
  }, taskId);

  await assign.click();
  await expect(assign).toHaveAttribute('data-armed', 'true');
  const picker = page.getByTestId('action-target-picker');
  await expect(picker).toBeVisible();
  await expect(picker).toHaveAttribute('data-armed', 'assignTask');

  await page.getByTestId(`action-target-option-${taskId}`).click();
  await expect(assign).not.toHaveAttribute('data-armed', 'true');
  await expect(picker).toHaveCount(0);

  const after = await page.evaluate((id) => {
    const g = (window as GameWindow).game!;
    const task = g.getState().sprint!.tasks.find((t) => t.id === id)!;
    return { progress: task.progress, focus: g.getState().sprint!.focus };
  }, taskId);
  expect(after.progress).toBeGreaterThan(before.progress);
  expect(after.focus).toBeLessThan(before.focus);
});

test('PR分割をキーボード相当操作（Tab/Enter）で完了できる（RI-146）', async ({ page }) => {
  await beginPublicSprint(page, { seed: 'ri146-split-keyboard' });
  await waitForBoardReady(page);
  const taskId = await advanceUntil(page, () => null, 'split');

  const split = page.getByTestId('action-splitPr');
  await expect(split).toBeEnabled();
  await split.click();
  await expect(split).toHaveAttribute('data-armed', 'true');
  await expect(page.getByTestId('action-target-picker')).toBeVisible();

  const option = page.getByTestId(`action-target-option-${taskId}`);
  await expect(option).toBeFocused();
  const beforeFocus = await page.evaluate(
    () => (window as GameWindow).game!.getState().sprint!.focus,
  );
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('action-target-picker')).toHaveCount(0);

  const after = await page.evaluate((id) => {
    const g = (window as GameWindow).game!;
    const task = g.getState().sprint!.tasks.find((t) => t.id === id);
    return { split: task?.split === true, focus: g.getState().sprint!.focus };
  }, taskId);
  expect(after.split).toBe(true);
  expect(after.focus).toBeLessThan(beforeFocus);
});

test('武装中 Escape で取消し、起点の介入ボタンへフォーカスが戻る（RI-146）', async ({ page }) => {
  await beginPublicSprint(page, { seed: 'ri146-escape-cancel' });
  await waitForBoardReady(page);
  await advanceUntil(page, () => null, 'coding');

  const assign = page.getByTestId('action-assignTask');
  await assign.click();
  await expect(page.getByTestId('action-target-picker')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('action-target-picker')).toHaveCount(0);
  await expect(assign).toBeFocused();
  await expect(assign).not.toHaveAttribute('data-armed', 'true');
});

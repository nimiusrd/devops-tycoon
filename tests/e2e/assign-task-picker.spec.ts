/**
 * RI-146: タスク差配・PR分割を HTML 対象選択で完了できる。
 */
import { expect, test } from './fixtures';
import type { ActionTarget, InterventionOutcome } from '../../src/sim/types';
import type { RunState } from '../../src/sim/run/types';

type GameWindow = Window & {
  game?: {
    pause(): void;
    getState(): RunState;
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
    beginSetupSprint(): RunState;
    step(ms: number): RunState;
    dispatch(id: string, target?: ActionTarget): InterventionOutcome;
  };
};

async function prepareSprintWithCoding(
  page: import('@playwright/test').Page,
  seed: string,
): Promise<number> {
  await page.goto(`/?seed=${seed}`);
  return page.evaluate((s) => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('normal', [], s);
    g.beginSetupSprint();
    let guard = 0;
    let state = g.getState();
    while (guard < 3000) {
      const coding = state.sprint?.tasks.filter((t) => t.lane === 'coding') ?? [];
      if (coding.length > 0 && (state.sprint?.focus ?? 0) >= 2) {
        return coding[0]!.id;
      }
      state = g.step(100);
      guard += 1;
    }
    throw new Error('coding タスクを用意できませんでした');
  }, seed);
}

async function prepareSprintWithSplitCandidate(
  page: import('@playwright/test').Page,
  seed: string,
): Promise<number> {
  await page.goto(`/?seed=${seed}`);
  return page.evaluate((s) => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('normal', [], s);
    g.beginSetupSprint();
    let guard = 0;
    let state = g.getState();
    while (guard < 4000) {
      const candidates =
        state.sprint?.tasks.filter(
          (t) => (t.lane === 'review' || t.lane === 'coding') && !t.split,
        ) ?? [];
      if (candidates.length > 0 && (state.sprint?.focus ?? 0) >= 2) {
        return candidates[0]!.id;
      }
      state = g.step(100);
      guard += 1;
    }
    throw new Error('PR分割候補を用意できませんでした');
  }, seed);
}

test('タスク差配を HTML 対象選択で完了できる（RI-146）', async ({ page }) => {
  const taskId = await prepareSprintWithCoding(page, 'ri146-assign-picker');
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
  const taskId = await prepareSprintWithSplitCandidate(page, 'ri146-split-keyboard');
  const split = page.getByTestId('action-splitPr');
  await expect(split).toBeEnabled();
  await split.focus();
  await page.keyboard.press('Enter');
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
  await prepareSprintWithCoding(page, 'ri146-escape-cancel');
  const assign = page.getByTestId('action-assignTask');
  await assign.click();
  await expect(page.getByTestId('action-target-picker')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('action-target-picker')).toHaveCount(0);
  await expect(assign).toBeFocused();
  await expect(assign).not.toHaveAttribute('data-armed', 'true');
});

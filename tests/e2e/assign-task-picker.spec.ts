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

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  for (const action of ['assignTask', 'splitPr'] as const) {
    test(`${viewport.width}px: ${action} の構えと担当は一時停止・再開後も残る`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await beginPublicSprint(page, { seed: 'ri146-pause-armed', renderer: 'pixi' });
      await waitForBoardReady(page);
      const taskId = await advanceUntil(
        page,
        () => null,
        action === 'assignTask' ? 'coding' : 'split',
      );
      const button = page.getByTestId(`action-${action}`);
      await button.click();
      if (action === 'assignTask') await page.getByTestId('assign-assignee-senior').click();
      const picker = page.getByTestId('action-target-picker');
      const option = page.getByTestId(`action-target-option-${taskId}`);
      await expect(option).toBeEnabled();
      const snapshot = () =>
        page.evaluate((id) => {
          const sprint = (window as GameWindow).game!.getState().sprint!;
          const task = sprint.tasks.find((candidate) => candidate.id === id)!;
          return { focus: sprint.focus, progress: task.progress, split: task.split };
        }, taskId);
      const beforePause = await snapshot();

      await page.getByTestId('speed-pause').click();
      await expect(button).toHaveAttribute('data-armed', 'true');
      await expect(button).toBeDisabled();
      await expect(button).toHaveAccessibleName(/武装中。一時停止中は対象を選べません/);
      await expect(page.getByTestId(`action-armed-${action}`)).toHaveText('武装中（停止中）');
      await expect(page.getByTestId('board')).toHaveAttribute('data-armed', action);
      await expect(picker).toHaveAttribute('data-armed', action);
      await expect(option).toBeDisabled();
      await expect(option).toContainText('一時停止中');
      await expect(option).toHaveCSS('opacity', '1');
      if (action === 'assignTask') {
        await expect(page.getByTestId('assign-assignee-senior')).toHaveClass(/\bon\b/);
        await expect(page.getByTestId('assign-assignee-senior')).toBeDisabled();
      }
      // native disabled を外されても、一時停止中は発動も資源消費も起こさない。
      await option.evaluate((element) => {
        (element as HTMLButtonElement).disabled = false;
        (element as HTMLButtonElement).click();
      });
      expect(await snapshot()).toEqual(beforePause);
      await button.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath('構えを保持した一時停止.png'),
        fullPage: true,
      });

      await page.getByTestId('speed-1x').click();
      await expect(button).toHaveAttribute('data-armed', 'true');
      await expect(option).toBeEnabled();
      await option.click();
      await expect(picker).toHaveCount(0);
      await expect(button).not.toHaveAttribute('data-armed', 'true');
      const after = await snapshot();
      expect(after.focus).toBeLessThan(beforePause.focus);
      if (action === 'splitPr') expect(after.split).toBe(true);
      else expect(after.progress).toBeGreaterThan(beforePause.progress);
    });
  }
}

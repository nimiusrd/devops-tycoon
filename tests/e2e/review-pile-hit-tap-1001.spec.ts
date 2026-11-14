/**
 * Review に積んだ山の全粒を実タップし、当たり判定と確定対象が一致する（#978 / #1001）。
 * 隠れ粒のスキップは行わない（#995 と同方針）。
 */
import type { Page } from '@playwright/test';
import {
  advanceCurrentSprintToReviewQueue,
  beginPublicSprint,
  expandSprintInterventionsIfCollapsed,
  expect,
  test,
} from './fixtures';
import { designToClient, readBoardCanvasFrame } from './boardCanvasPoint';
import { planBoardScene } from '../../src/render/boardScene';
import { presentBoardDots } from '../../src/render/boardPixiView';
import { splitPrCandidates } from '../../src/sim/assignTask';
import { splitPrConfirmDurationMs } from '../../src/render/splitPrConfirmView';

test.use({ hasTouch: true });

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 1024, height: 768 },
] as const;

function isBoardPointUncovered(page: Page, point: { x: number; y: number }): Promise<boolean> {
  return page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    return (
      !!element?.closest('[data-testid="board"]') &&
      !element.closest(
        '.st-label, .bubble, .board-legend, .pile-overflow, [data-testid="action-target-picker"]',
      )
    );
  }, point);
}

async function readReviewTapTargets(page: Page): Promise<{ id: number; x: number; y: number }[]> {
  const sprint = await page.evaluate(() => window.game!.getState().sprint);
  const frame = await readBoardCanvasFrame(page);
  if (!sprint) throw new Error('スプリントがない');
  const candidates = new Set(splitPrCandidates(sprint).map((task) => task.id));
  const presented = presentBoardDots(planBoardScene(sprint.tasks).dots, frame.fit.scale);
  return presented
    .filter((dot) => dot.lane === 'review' && !dot.motion && candidates.has(dot.id))
    .map((dot) => ({ id: dot.id, ...designToClient(frame, dot) }));
}

async function openReviewPileSprint(page: Page, viewportWidth: number): Promise<void> {
  await beginPublicSprint(page, { seed: 'qa-seed-1030', renderer: 'pixi' });
  await advanceCurrentSprintToReviewQueue(page, 10);
  await page.evaluate(() => {
    const layout = document.querySelector('[data-testid="sprint-layout"]');
    if (layout instanceof HTMLElement) layout.scrollTop = 0;
    window.scrollTo(0, 0);
  });
  if (viewportWidth === 320) await expandSprintInterventionsIfCollapsed(page);
  await page.getByTestId('action-splitPr').click();
  const board = page.getByTestId('board');
  await expect(board).toHaveAttribute('data-armed', 'splitPr');
  await board.scrollIntoViewIfNeeded();
  await expect(page.getByTestId('board-pixi-mount')).toHaveAttribute('data-board-assets', '5');
}

async function tapBoardPoint(
  page: Page,
  point: { x: number; y: number },
  width: number,
  browserName: string,
): Promise<void> {
  if (browserName === 'chromium' && width <= 390) {
    await page.touchscreen.tap(point.x, point.y);
    return;
  }
  await page.mouse.click(point.x, point.y);
}

async function expectSplitOnTask(page: Page, taskId: number, before: number): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => window.game!.getState().sprint?.metrics.actionCounts.splitPr ?? 0),
    )
    .toBe(before + 1);
  const after = await page.evaluate(() => window.game!.getState().sprint);
  const event = after?.events.findLast((entry) => entry.kind === 'intervention');
  if (event?.kind !== 'intervention') throw new Error('介入結果が記録されていない');
  expect(event.effect.affectedTaskIds).toEqual([taskId]);
  await page.waitForTimeout(splitPrConfirmDurationMs() + 40);
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.width}px: Review 山の全粒をタップするとその粒が選ばれる（#1001） @pixi`, async ({
    page,
    browserName,
  }) => {
    test.setTimeout(240_000);
    test.info().annotations.push({ type: 'browser', description: browserName });
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openReviewPileSprint(page, viewport.width);

    const targetIds = (await readReviewTapTargets(page)).map((dot) => dot.id);
    expect(targetIds.length).toBeGreaterThanOrEqual(10);

    const board = page.getByTestId('board');
    for (const taskId of targetIds) {
      await openReviewPileSprint(page, viewport.width);
      const target = (await readReviewTapTargets(page)).find((dot) => dot.id === taskId);
      if (!target) throw new Error(`Review #${taskId} が候補にない`);
      expect(
        await isBoardPointUncovered(page, target),
        `Review #${taskId} の中心が操作できない`,
      ).toBe(true);
      await page.mouse.move(target.x, target.y);
      await expect(board).toHaveAttribute('data-preview-task-id', String(taskId));
      await tapBoardPoint(page, target, viewport.width, browserName);
      await expectSplitOnTask(page, taskId, 0);
    }
  });
}

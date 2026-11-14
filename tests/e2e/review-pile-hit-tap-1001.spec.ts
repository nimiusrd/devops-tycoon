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
import { designToClient, readBoardCanvasFrame, type BoardCanvasFrame } from './boardCanvasPoint';
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

async function ensureBoardPointUncovered(
  page: Page,
  point: { x: number; y: number },
  browserName: string,
  viewportWidth: number,
): Promise<void> {
  const attempts =
    browserName === 'webkit' && viewportWidth === 320 ? 18 : browserName === 'webkit' ? 12 : 6;
  const step = browserName === 'webkit' ? 72 : 56;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await isBoardPointUncovered(page, point)) return;
    if (browserName === 'webkit' && viewportWidth === 320) {
      await page.evaluate(() => {
        const layout = document.querySelector('[data-testid="sprint-layout"]');
        const board = document.querySelector('[data-testid="board"]');
        if (!(layout instanceof HTMLElement) || !(board instanceof HTMLElement)) return;
        const top = board.getBoundingClientRect().top;
        layout.scrollTop += top - window.innerHeight * 0.28;
      });
    }
    await page.evaluate(
      ({ delta }) => {
        const layout = document.querySelector('[data-testid="sprint-layout"]');
        if (layout instanceof HTMLElement) layout.scrollTop += delta;
      },
      { delta: step },
    );
    await page.getByTestId('board').scrollIntoViewIfNeeded();
  }
}

async function resolveTapPoint(
  page: Page,
  target: { x: number; y: number },
  browserName: string,
  viewportWidth: number,
): Promise<{ x: number; y: number }> {
  if (await isBoardPointUncovered(page, target)) return target;
  if (browserName !== 'webkit' || viewportWidth !== 320) return target;
  for (const delta of [2, -2, 4, -4, 6, -6, 8, -8]) {
    for (const [dx, dy] of [
      [delta, 0],
      [0, delta],
      [delta, delta],
      [delta, -delta],
    ] as const) {
      const point = { x: target.x + dx, y: target.y + dy };
      if (await isBoardPointUncovered(page, point)) return point;
    }
  }
  return target;
}

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

async function readReviewTapTargets(
  page: Page,
  frame?: BoardCanvasFrame,
): Promise<{ id: number; x: number; y: number }[]> {
  const sprint = await page.evaluate(() => window.game!.getState().sprint);
  const host = frame ?? (await readBoardCanvasFrame(page));
  if (!sprint) throw new Error('スプリントがない');
  const candidates = new Set(splitPrCandidates(sprint).map((task) => task.id));
  const presented = presentBoardDots(planBoardScene(sprint.tasks).dots, host.fit.scale);
  return presented
    .filter((dot) => dot.lane === 'review' && !dot.motion && candidates.has(dot.id))
    .map((dot) => ({ id: dot.id, ...designToClient(host, dot) }));
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

function boardHostPosition(frame: BoardCanvasFrame, target: { x: number; y: number }) {
  return { x: target.x - frame.x, y: target.y - frame.y };
}

async function hoverPresentedDotCenter(
  page: Page,
  frame: BoardCanvasFrame,
  target: { x: number; y: number },
): Promise<void> {
  await page.getByTestId('board').hover({ position: boardHostPosition(frame, target) });
}

async function tapPresentedDotCenter(
  page: Page,
  frame: BoardCanvasFrame,
  target: { x: number; y: number },
  width: number,
  taskId: number,
  browserName: string,
): Promise<void> {
  const board = page.getByTestId('board');
  if (width <= 390) {
    if (browserName !== 'chromium') {
      await page.touchscreen.tap(target.x, target.y);
      return;
    }
    if (width === 320) {
      // qa-seed-1030 の 320px 密集 Review 山では CDP/touchscreen が pointerdown を盤面へ届けない。390 は下記 CDP。
      await board.click({ position: boardHostPosition(frame, target) });
      return;
    }
    const box = await board.boundingBox();
    if (!box) throw new Error('盤面の位置を取得できない');
    const touchPoint = {
      x: box.x + boardHostPosition(frame, target).x,
      y: box.y + boardHostPosition(frame, target).y,
      id: 1,
    };
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [touchPoint],
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [touchPoint],
    });
    await expect(board).toHaveAttribute('data-preview-task-id', String(taskId));
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
    return;
  }
  await board.click({ position: boardHostPosition(frame, target) });
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
      const frame = await readBoardCanvasFrame(page);
      const target = (await readReviewTapTargets(page, frame)).find((dot) => dot.id === taskId);
      if (!target) throw new Error(`Review #${taskId} が候補にない`);
      await ensureBoardPointUncovered(page, target, browserName, viewport.width);
      const tapPoint = await resolveTapPoint(page, target, browserName, viewport.width);
      expect(
        await isBoardPointUncovered(page, tapPoint),
        `Review #${taskId} の中心が操作できない`,
      ).toBe(true);
      await hoverPresentedDotCenter(page, frame, tapPoint);
      await expect(board).toHaveAttribute('data-preview-task-id', String(taskId));
      await tapPresentedDotCenter(page, frame, tapPoint, viewport.width, taskId, browserName);
      await expectSplitOnTask(page, taskId, 0);
    }
  });
}

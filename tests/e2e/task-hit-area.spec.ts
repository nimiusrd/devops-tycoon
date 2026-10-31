import { advanceCurrentSprintToReviewQueue, beginPublicSprint, expect, test } from './fixtures';
import { designToClient, readBoardCanvasFrame } from './boardCanvasPoint';
import { BOARD_STATION_CENTERS, planBoardScene } from '../../src/render/boardScene';
import { boardDotReadabilityMagnification, presentBoardDots } from '../../src/render/boardPixiView';
import { TASK_DIAMETER } from '../../src/render/taskView';
import { assignableTasks, splitPrCandidates } from '../../src/sim/assignTask';

test.use({ hasTouch: true });

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  for (const viewport of [
    { width: 320, height: 568, frontId: 6, behindId: 5 },
    { width: 1280, height: 800, frontId: 6, behindId: 5 },
  ]) {
    test(`${viewport.width}px・${reducedMotion}: 近い小粒より見えている手前の粒を選ぶ（#913） @pixi`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.emulateMedia({ reducedMotion });
      await beginPublicSprint(page, { seed: 'devops-tycoon' });
      await page.evaluate(() => window.game!.step(300));
      await page.getByTestId('action-splitPr').click();
      const board = page.getByTestId('board');
      await expect(board).toHaveAttribute('data-armed', 'splitPr');
      await board.scrollIntoViewIfNeeded();
      await page.evaluate(() => {
        if (!window.__boardPixiTest) throw new Error('Pixi のテストフックがない');
        window.__boardPixiTest.freezeForScreenshot();
      });

      const sprint = await page.evaluate(() => window.game!.getState().sprint);
      const frame = await readBoardCanvasFrame(page);
      if (!sprint) throw new Error('盤面の状態を取得できない');
      const candidates = new Set(splitPrCandidates(sprint).map((task) => task.id));
      const cssScale = frame.fit.scale;
      const magnification = boardDotReadabilityMagnification(cssScale);
      const dots = presentBoardDots(planBoardScene(sprint.tasks).dots, cssScale).filter((dot) =>
        candidates.has(dot.id),
      );
      const front = dots.find((dot) => dot.id === viewport.frontId)!;
      const behind = dots.find((dot) => dot.id === viewport.behindId)!;
      expect(front).toBeDefined();
      expect(behind).toBeDefined();
      expect(behind.size).toBe('small');
      // 密集部の実体内で、中心距離だけなら奥の小粒が選ばれてしまう位置。
      const point = {
        x: front.x + (behind.x - front.x) * 0.51,
        y: front.y + (behind.y - front.y) * 0.51,
      };
      expect(Math.hypot(point.x - front.x, point.y - front.y)).toBeLessThan(
        (TASK_DIAMETER[front.size] / 2) * magnification,
      );
      expect(Math.hypot(point.x - behind.x, point.y - behind.y)).toBeLessThan(
        Math.hypot(point.x - front.x, point.y - front.y),
      );
      expect(
        dots.findLast(
          (dot) =>
            Math.hypot(point.x - dot.x, point.y - dot.y) <=
            (TASK_DIAMETER[dot.size] / 2) * magnification,
        )?.id,
      ).toBe(front.id);
      const { x, y } = designToClient(frame, point);
      if (viewport.width === 320) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      await expect
        .poll(() =>
          page.evaluate(() => window.game!.getState().sprint?.metrics.actionCounts.splitPr ?? 0),
        )
        .toBe((sprint.metrics.actionCounts.splitPr ?? 0) + 1);
      const after = await page.evaluate(() => window.game!.getState().sprint);
      const event = after?.events.findLast((event) => event.kind === 'intervention');
      if (event?.kind !== 'intervention') throw new Error('介入結果が記録されていない');
      expect(event.effect.affectedTaskIds).toEqual([front.id]);
      expect(after?.focus).toBe(sprint.focus - event.effect.focusCost);
    });
  }

  for (const action of ['splitPr', 'assignTask'] as const) {
    test(`320px・${reducedMotion}: 粒から11px離れた位置で${action}が対象へ一度だけ発動する（#903） @pixi`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 568 });
      await page.emulateMedia({ reducedMotion });
      await beginPublicSprint(page, { seed: 'devops-tycoon' });
      await page.evaluate(() => window.game!.step(300));
      await page.getByTestId(`action-${action}`).click();
      const board = page.getByTestId('board');
      await expect(board).toHaveAttribute('data-armed', action);
      await board.scrollIntoViewIfNeeded();

      const sprint = await page.evaluate(() => window.game!.getState().sprint);
      const frame = await readBoardCanvasFrame(page);
      if (!sprint) throw new Error('盤面の状態を取得できない');
      const candidates = new Set(
        (action === 'splitPr' ? splitPrCandidates(sprint) : assignableTasks(sprint)).map(
          (task) => task.id,
        ),
      );
      const dots = presentBoardDots(planBoardScene(sprint.tasks).dots, frame.fit.scale)
        .filter((dot) => candidates.has(dot.id))
        .map((dot) => ({ id: dot.id, ...designToClient(frame, dot) }));
      let from: { id: number; x: number; y: number } | undefined;
      for (const dot of dots) {
        for (const [dx, dy] of [
          [0, -11],
          [0, 11],
          [-11, 0],
          [11, 0],
        ]) {
          const point = { id: dot.id, x: dot.x + dx, y: dot.y + dy };
          // 他の粒の方が近い位置は使わず、対象IDを画面上の距離で独立に決める。
          if (
            dots.some(
              (other) =>
                other.id !== dot.id && Math.hypot(other.x - point.x, other.y - point.y) <= 11,
            )
          )
            continue;
          const uncovered = await page.evaluate(({ x, y }) => {
            const element = document.elementFromPoint(x, y);
            return (
              !!element?.closest('[data-testid="board"]') &&
              !element.closest('.st-label, .bubble, .board-legend, .pile-overflow')
            );
          }, point);
          if (uncovered) {
            from = point;
            break;
          }
        }
        if (from) break;
      }
      if (!from) throw new Error('中心から11px離れた操作位置を取得できない');

      if (action === 'splitPr') {
        await page.touchscreen.tap(from.x, from.y);
      } else {
        const target = BOARD_STATION_CENTERS.coding;
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        const drop = designToClient(frame, target);
        await page.mouse.move(drop.x, drop.y, { steps: 8 });
        await page.mouse.up();
      }
      await expect
        .poll(() =>
          page.evaluate(
            (id) => window.game!.getState().sprint?.metrics.actionCounts[id] ?? 0,
            action,
          ),
        )
        .toBe((sprint.metrics.actionCounts[action] ?? 0) + 1);
      const after = await page.evaluate(() => window.game!.getState().sprint);
      const event = after?.events.findLast((event) => event.kind === 'intervention');
      expect(event?.kind).toBe('intervention');
      if (event?.kind !== 'intervention') throw new Error('介入結果が記録されていない');
      expect(event.effect.affectedTaskIds).toEqual([from.id]);
      expect(after?.focus).toBe(sprint.focus - event.effect.focusCost);
    });
  }
}

test('320px: Review に 10 個以上積んだ山の中心をタップするとその粒が選ばれる（#978） @pixi', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await beginPublicSprint(page, { seed: 'qa-seed-1030' });
  await advanceCurrentSprintToReviewQueue(page, 10);
  await page.getByTestId('action-splitPr').click();
  const board = page.getByTestId('board');
  await expect(board).toHaveAttribute('data-armed', 'splitPr');
  await board.scrollIntoViewIfNeeded();
  await expect(page.getByTestId('board-pixi-mount')).toHaveAttribute('data-board-assets', '5');
  await page.evaluate(() => {
    if (!window.__boardPixiTest) throw new Error('Pixi のテストフックがない');
    window.__boardPixiTest.freezeForScreenshot();
  });

  const sprint = await page.evaluate(() => window.game!.getState().sprint);
  const frame = await readBoardCanvasFrame(page);
  if (!sprint) throw new Error('スプリントがない');
  const candidates = new Set(splitPrCandidates(sprint).map((task) => task.id));
  const presented = presentBoardDots(planBoardScene(sprint.tasks).dots, frame.fit.scale);
  const review = presented.filter(
    (dot) => dot.lane === 'review' && !dot.motion && candidates.has(dot.id),
  );
  expect(review.length).toBeGreaterThanOrEqual(10);
  const coding = presented.find(
    (dot) => dot.lane === 'coding' && !dot.motion && candidates.has(dot.id),
  );

  const uncovered = (point: { x: number; y: number }) =>
    page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return (
        !!element?.closest('[data-testid="board"]') &&
        !element.closest(
          '.st-label, .bubble, .board-legend, .pile-overflow, [data-testid="action-target-picker"]',
        )
      );
    }, point);

  let tapped: { id: number; x: number; y: number } | undefined;
  for (const dot of review) {
    const point = designToClient(frame, dot);
    expect(await uncovered(point), `Review #${dot.id} の中心が操作できない`).toBe(true);
    await page.mouse.move(point.x, point.y);
    await expect(board).toHaveAttribute('data-preview-task-id', String(dot.id));
    tapped = { id: dot.id, ...point };
  }
  if (coding) {
    const point = designToClient(frame, coding);
    if (await uncovered(point)) {
      await page.mouse.move(point.x, point.y);
      await expect(board).toHaveAttribute('data-preview-task-id', String(coding.id));
    }
  }
  if (!tapped) throw new Error('タップする Review の粒がない');
  const before = sprint.metrics.actionCounts.splitPr ?? 0;
  await page.touchscreen.tap(tapped.x, tapped.y);
  await expect
    .poll(() =>
      page.evaluate(() => window.game!.getState().sprint?.metrics.actionCounts.splitPr ?? 0),
    )
    .toBe(before + 1);
  const after = await page.evaluate(() => window.game!.getState().sprint);
  const event = after?.events.findLast((entry) => entry.kind === 'intervention');
  if (event?.kind !== 'intervention') throw new Error('介入結果が記録されていない');
  expect(event.effect.affectedTaskIds).toEqual([tapped.id]);
});

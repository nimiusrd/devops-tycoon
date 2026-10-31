import { beginPublicSprint, expect, test } from './fixtures';
import { BOARD_STATION_CENTERS, BOARD_VIEW, planBoardScene } from '../../src/render/boardScene';
import { boardDotReadabilityMagnification, presentBoardDot } from '../../src/render/boardPixiView';
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
      const box = await board.boundingBox();
      if (!sprint || !box) throw new Error('盤面の状態と位置を取得できない');
      const candidates = new Set(splitPrCandidates(sprint).map((task) => task.id));
      const cssScale = Math.min(box.width / BOARD_VIEW.w, box.height / BOARD_VIEW.h);
      const magnification = boardDotReadabilityMagnification(cssScale);
      const dots = planBoardScene(sprint.tasks)
        .dots.filter((dot) => candidates.has(dot.id))
        .map((dot) => presentBoardDot(dot, cssScale));
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
      const x = box.x + (point.x / BOARD_VIEW.w) * box.width;
      const y = box.y + (point.y / BOARD_VIEW.h) * box.height;
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
      const box = await board.boundingBox();
      if (!sprint || !box) throw new Error('盤面の状態と位置を取得できない');
      const candidates = new Set(
        (action === 'splitPr' ? splitPrCandidates(sprint) : assignableTasks(sprint)).map(
          (task) => task.id,
        ),
      );
      const cssScale = Math.min(box.width / BOARD_VIEW.w, box.height / BOARD_VIEW.h);
      const dots = planBoardScene(sprint.tasks)
        .dots.filter((dot) => candidates.has(dot.id))
        .map((dot) => presentBoardDot(dot, cssScale))
        .map((dot) => ({
          id: dot.id,
          x: box.x + (dot.x / BOARD_VIEW.w) * box.width,
          y: box.y + (dot.y / BOARD_VIEW.h) * box.height,
        }));
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
        await page.mouse.move(
          box.x + (target.x / BOARD_VIEW.w) * box.width,
          box.y + (target.y / BOARD_VIEW.h) * box.height,
          { steps: 8 },
        );
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

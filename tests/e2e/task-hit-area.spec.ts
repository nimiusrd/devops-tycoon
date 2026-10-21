import { beginPublicSprint, expect, test } from './fixtures';
import { BOARD_STATION_CENTERS, BOARD_VIEW, planBoardScene } from '../../src/render/boardScene';
import { assignableTasks, splitPrCandidates } from '../../src/sim/assignTask';

test.use({ hasTouch: true });

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
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
      const dots = planBoardScene(sprint.tasks)
        .dots.filter((dot) => candidates.has(dot.id))
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

/** 武装中の強調対象と、mouse / touch で確定する対象を一致させる（#917）。 */
import type { Page } from '@playwright/test';
import { beginPublicSprint, expect, test } from './fixtures';
import { BOARD_VIEW, planBoardScene, type BoardDotPlan } from '../../src/render/boardScene';
import { TASK_DIAMETER } from '../../src/render/taskView';
import { splitPrCandidates } from '../../src/sim/assignTask';

test.use({ hasTouch: true });

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
] as const;

type TargetPoint = { x: number; y: number; id: number };

async function expectPreview(page: Page, id: number | null): Promise<void> {
  for (const testId of ['board', 'board-pixi-mount']) {
    const element = page.getByTestId(testId);
    if (id === null) await expect(element).not.toHaveAttribute('data-preview-task-id');
    else await expect(element).toHaveAttribute('data-preview-task-id', String(id));
  }
}

async function readSplitCount(page: Page): Promise<number> {
  return page.evaluate(() => window.game!.getState().sprint?.metrics.actionCounts.splitPr ?? 0);
}

async function openDenseSprint(page: Page): Promise<void> {
  // 既存の #913 fixture。公開操作だけで Review の粒 #5 / #6 が重なる状態を作る。
  await beginPublicSprint(page, { seed: 'devops-tycoon', renderer: 'pixi' });
  await page.evaluate(() => window.game!.step(300));
  await expect(page.getByTestId('board')).toHaveAttribute('data-effect-renderer', 'pixi');
}

async function readTargetPoints(page: Page): Promise<{
  overlap: TargetPoint;
  alternative: TargetPoint;
  outside: { x: number; y: number };
}> {
  const board = page.getByTestId('board');
  await board.scrollIntoViewIfNeeded();
  await expect(page.getByTestId('board-pixi-mount')).toHaveAttribute('data-board-assets', '5');
  await page.evaluate(() => document.fonts.ready);
  // 出荷直後の一時的な得点ポップは対象強調の画像へ含めない。
  await expect(page.locator('.point-pop')).toHaveCount(0);
  await page.evaluate(() => {
    if (!window.__boardPixiTest) throw new Error('Pixi のテストフックがない');
    window.__boardPixiTest.freezeForScreenshot();
  });
  const sprint = await page.evaluate(() => window.game!.getState().sprint);
  const box = await board.boundingBox();
  if (!sprint || !box) throw new Error('盤面の状態と位置を取得できない');
  const candidates = new Set(splitPrCandidates(sprint).map((task) => task.id));
  const dots = planBoardScene(sprint.tasks).dots.filter((dot) => candidates.has(dot.id));
  const front = dots.find((dot) => dot.id === 6);
  const behind = dots.find((dot) => dot.id === 5);
  if (!front || !behind) throw new Error('重なった Review の粒がない');
  const point = {
    x: front.x + (behind.x - front.x) * 0.51,
    y: front.y + (behind.y - front.y) * 0.51,
  };
  expect(Math.hypot(point.x - behind.x, point.y - behind.y)).toBeLessThan(
    Math.hypot(point.x - front.x, point.y - front.y),
  );
  // 中心が近い奥の小粒より、実体が重なる手前の粒が選ばれる位置を独立に確かめる。
  const frontmost = (at: { x: number; y: number }): BoardDotPlan | undefined =>
    dots.findLast((dot) => Math.hypot(at.x - dot.x, at.y - dot.y) <= TASK_DIAMETER[dot.size] / 2);
  expect(frontmost(point)?.id).toBe(front.id);
  const toClient = (at: { x: number; y: number }, id: number): TargetPoint => ({
    x: box.x + (at.x / BOARD_VIEW.w) * box.width,
    y: box.y + (at.y / BOARD_VIEW.h) * box.height,
    id,
  });
  const overlap = toClient(point, front.id);
  const uncovered = (at: { x: number; y: number }): Promise<boolean> =>
    page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return (
        !!element?.closest('[data-testid="board"]') &&
        !element.closest('.st-label, .bubble, .board-legend, .pile-overflow')
      );
    }, at);
  expect(await uncovered(overlap), '密集した操作点が HTML ラベルに覆われている').toBe(true);

  let alternative: TargetPoint | undefined;
  for (const dot of [...dots].reverse()) {
    const visible = frontmost(dot);
    if (!visible || visible.id === front.id) continue;
    const next = toClient(dot, visible.id);
    if (await uncovered(next)) {
      alternative = next;
      break;
    }
  }
  if (!alternative) throw new Error('指をずらして選び直す別の粒がない');
  return { overlap, alternative, outside: { x: box.x - 2, y: overlap.y } };
}

async function expectSplitResult(page: Page, before: number, expectedId: number): Promise<void> {
  await expect.poll(() => readSplitCount(page)).toBe(before + 1);
  const after = await page.evaluate(() => window.game!.getState().sprint);
  const event = after?.events.findLast((event) => event.kind === 'intervention');
  if (event?.kind !== 'intervention') throw new Error('介入結果が記録されていない');
  expect(event.effect.affectedTaskIds).toEqual([expectedId]);
  await expectPreview(page, null);
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px・${reducedMotion}: hover で強調した密集粒を mouse で確定する（#917） @pixi`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion });
      await openDenseSprint(page);
      const unarmed = await readTargetPoints(page);
      await page.mouse.move(unarmed.overlap.x, unarmed.overlap.y);
      await expectPreview(page, null);

      await page.getByTestId('action-splitPr').click();
      await expect(page.getByTestId('board')).toHaveAttribute('data-armed', 'splitPr');
      const { overlap, outside } = await readTargetPoints(page);
      const before = await readSplitCount(page);
      await page.getByTestId('board').screenshot({ path: testInfo.outputPath('対象強調前.png') });
      await page.mouse.move(overlap.x, overlap.y);
      await expectPreview(page, overlap.id);
      expect(await readSplitCount(page)).toBe(before);
      await page.screenshot({ path: testInfo.outputPath('hover中の対象.png') });
      if (reducedMotion === 'reduce' && viewport.width !== 390) {
        await expect(page.getByTestId('board')).toHaveScreenshot(
          `target-preview-${viewport.width}.png`,
        );
      }
      await page.mouse.move(outside.x, outside.y);
      await expectPreview(page, null);
      await page.mouse.move(overlap.x, overlap.y);
      await expectPreview(page, overlap.id);
      await page.mouse.down();
      expect(await readSplitCount(page)).toBe(before);
      await page.mouse.up();
      await expectSplitResult(page, before, overlap.id);
    });

    test(`${viewport.width}px・${reducedMotion}: touch の取消と選び直しは離すまで発動しない（#917） @pixi`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion });
      await openDenseSprint(page);
      await page.getByTestId('action-splitPr').click();
      await expect(page.getByTestId('board')).toHaveAttribute('data-armed', 'splitPr');
      const { overlap, alternative, outside } = await readTargetPoints(page);
      const before = await readSplitCount(page);
      const session = await page.context().newCDPSession(page);
      const touch = (type: 'touchStart' | 'touchMove', point: { x: number; y: number }) =>
        session.send('Input.dispatchTouchEvent', {
          type,
          touchPoints: [{ x: point.x, y: point.y, id: 1 }],
        });

      // 盤面外へ指を逃がして離しても、集中力と実行回数は変わらない。
      await touch('touchStart', overlap);
      await expectPreview(page, overlap.id);
      expect(await readSplitCount(page)).toBe(before);
      await touch('touchMove', outside);
      await expectPreview(page, null);
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      expect(await readSplitCount(page)).toBe(before);
      await expect(page.getByTestId('board')).toHaveAttribute('data-armed', 'splitPr');

      // ブラウザが gesture を取り消したときも、その後の指へ対象を持ち越さない。
      await touch('touchStart', overlap);
      await expectPreview(page, overlap.id);
      await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      await expectPreview(page, null);
      expect(await readSplitCount(page)).toBe(before);

      await touch('touchStart', overlap);
      await expectPreview(page, overlap.id);
      await touch('touchMove', alternative);
      await expectPreview(page, alternative.id);
      expect(await readSplitCount(page)).toBe(before);
      await page.screenshot({ path: testInfo.outputPath('指をずらして選び直した対象.png') });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expectSplitResult(page, before, alternative.id);
      await session.detach();
    });
  }
}

/**
 * RI-69: デスクトップ幅でスプリント上部操作バーと盤面が重ならないことを検証する。
 */
import { expect, test } from './fixtures';

type Box = { x: number; y: number; width: number; height: number };

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

test('デスクトップ幅で sprint-subbar と board が重ならない', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?renderer=dom&seed=sprint-layout-ri69');
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  await page.getByTestId('begin-sprint').click();

  const subbar = page.getByTestId('sprint-subbar');
  const board = page.getByTestId('board');
  const actionBar = page.getByTestId('action-bar');

  await expect(subbar).toBeVisible();
  await expect(board).toBeVisible();
  await expect(actionBar).toBeVisible();

  const subbarBox = await subbar.boundingBox();
  const boardBox = await board.boundingBox();
  const actionBox = await actionBar.boundingBox();
  if (!subbarBox || !boardBox || !actionBox) {
    throw new Error('sprint-subbar / board / action-bar の bounding box が取得できない');
  }

  expect(overlaps(subbarBox, boardBox), 'sprint-subbar と board が重なっている').toBe(false);
  expect(subbarBox.y + subbarBox.height).toBeLessThanOrEqual(boardBox.y);

  expect(overlaps(boardBox, actionBox), 'board と action-bar が重なっている').toBe(false);
  expect(boardBox.y + boardBox.height).toBeLessThanOrEqual(actionBox.y);
});

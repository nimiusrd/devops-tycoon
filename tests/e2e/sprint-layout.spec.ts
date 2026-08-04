/**
 * RI-69: デスクトップ幅でスプリント上部操作バーと盤面が重ならないことを検証する。
 * RI-70: 狭幅では KPI 折り畳み後に盤面と介入バーが viewport 内へ到達できることを検証する。
 */
import { expect, test } from './fixtures';

type Box = { x: number; y: number; width: number; height: number };

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

async function beginSprint(page: import('@playwright/test').Page, seed: string) {
  await page.goto(`/?renderer=dom&seed=${seed}`);
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  await page.getByTestId('begin-sprint').click();
}

test('デスクトップ幅で sprint-subbar と board が重ならない', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await beginSprint(page, 'sprint-layout-ri69');

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

test('狭幅390pxでKPI折り畳み後に介入バーへ到達できる', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await beginSprint(page, 'sprint-layout-ri70');

  const hud = page.getByTestId('hud');
  const compact = page.getByTestId('hud-compact');
  const toggle = page.getByTestId('hud-toggle');
  const board = page.getByTestId('board');
  const actionBar = page.getByTestId('action-bar');

  await expect(hud).toHaveAttribute('data-compact', 'true');
  await expect(compact).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(board).toBeVisible();
  await expect(actionBar).toBeVisible();

  const boardBox = await board.boundingBox();
  const actionBox = await actionBar.boundingBox();
  if (!boardBox || !actionBox) {
    throw new Error('board / action-bar の bounding box が取得できない');
  }

  const viewportHeight = 844;
  expect(boardBox.y).toBeGreaterThanOrEqual(0);
  expect(boardBox.y + boardBox.height).toBeLessThanOrEqual(viewportHeight);
  expect(actionBox.y).toBeGreaterThanOrEqual(0);
  expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(viewportHeight);

  const noHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  expect(noHorizontalOverflow, '横スクロールが発生している').toBe(true);

  await toggle.click();
  await expect(hud).toHaveAttribute('data-compact', 'false');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(actionBar).toBeVisible();
  await actionBar.scrollIntoViewIfNeeded();
  await expect(actionBar).toBeInViewport();
});

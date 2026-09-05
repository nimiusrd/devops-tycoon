import { expect, test } from './fixtures';
import type { GameHandle } from '../../src/game';

type GameWindow = Window & {
  game: GameHandle;
  __forceBoardPixiInitFailure?: { delayMs: number };
  __delayBoardPixiInit?: { delayMs: number };
};

async function start(page: import('@playwright/test').Page) {
  // 廃止したクエリがブックマークに残っていてもGPUで起動する。
  await page.goto('/?renderer=dom&seed=webgl-required');
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  await page.getByTestId('begin-sprint').click();
}
async function tick(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as GameWindow).game.getState().sprintTick);
}

test('GPU初期化に失敗すると進行を止め、キーボードで再試行して同じランを再開できる', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as GameWindow).__forceBoardPixiInitFailure = { delayMs: 50 };
  });
  await start(page);
  const dialog = page.getByRole('dialog', { name: '盤面を表示できませんでした' });
  await expect(dialog).toBeVisible();
  const before = await tick(page);
  expect(before).toBeGreaterThanOrEqual(0);
  await page.waitForTimeout(500);
  expect(await tick(page)).toBe(before);
  await expect(
    page.locator('.task-dot, .station-actor, .fire-effects, .intervention-effects'),
  ).toHaveCount(0);
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(dialog).toBeInViewport();
    await expect(page.getByTestId('webgl-retry')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('webgl-retry')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('webgl-retry')).toBeFocused();
  await page.evaluate(() => {
    delete (window as GameWindow).__forceBoardPixiInitFailure;
  });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('webgl-status')).toHaveCount(0);
  await expect(page.getByTestId('board')).toHaveAttribute('data-effect-renderer', 'pixi');
  await expect.poll(() => tick(page)).toBeGreaterThan(before ?? 0);
});

test('GPU準備中は進行と操作を停止し、準備後に自動進行する', async ({ page }) => {
  await page.addInitScript(() => {
    (window as GameWindow).__delayBoardPixiInit = { delayMs: 1500 };
  });
  await start(page);
  await expect(page.getByRole('dialog', { name: 'オフィスを準備しています' })).toBeVisible();
  const before = await tick(page);
  expect(before).toBeGreaterThanOrEqual(0);
  await page.waitForTimeout(400);
  expect(await tick(page)).toBe(before);
  await expect(page.getByTestId('webgl-status')).toHaveCount(0);
  await expect(page.getByTestId('board')).toHaveAttribute('data-effect-renderer', 'pixi');
  await expect.poll(() => tick(page)).toBeGreaterThan(before ?? 0);
});

import { expect, test } from './fixtures';
import type { BoardRenderMetrics } from '../../src/render/adapters/pixiBoardRenderer';

type GameWindow = Window & {
  game: { pause(): void; zoomTo(level: string): unknown; focusDept(id: string): unknown };
  __boardPixiTest?: { getMetrics(): { base: BoardRenderMetrics } };
};

async function startSprint(page: import('@playwright/test').Page, seed: string) {
  await page.goto(`/?seed=${seed}`);
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  await page.getByTestId('begin-sprint').click();
  await expect(page.getByTestId('board')).toHaveAttribute('data-effect-renderer', 'pixi');
  await page.evaluate(() => (window as GameWindow).game.pause());
  await expect
    .poll(() =>
      page.evaluate(() => (window as GameWindow).__boardPixiTest?.getMetrics().base.assets),
    )
    .toBe(5);
  await expect
    .poll(() =>
      page.evaluate(() => (window as GameWindow).__boardPixiTest?.getMetrics().base.actors),
    )
    .toBe(5);
}

test('スプリントの人物アセットを読み込み、全社・部署もGPUで描画する', async ({ page }) => {
  await startSprint(page, 'ri92-assets');
  await page.evaluate(() => (window as GameWindow).game.zoomTo('company'));
  await expect(page.getByTestId('org-pixi-mount').locator('canvas')).toBeVisible();
  await page.evaluate(() => (window as GameWindow).game.focusDept('platform'));
  await expect(page.getByTestId('dept-pixi-mount').locator('canvas')).toBeVisible();
  await expect(page.getByTestId('webgl-status')).toHaveCount(0);
});

test('人物SVGの取得失敗時もGPUの図形で人物を描画する', async ({ page }) => {
  await page.route('**/assets/game/*.svg', (route) => route.abort());
  await startSprint(page, 'ri92-assets-fallback');
  await expect(page.getByTestId('webgl-status')).toHaveCount(0);
  await expect(page.locator('.station-actor')).toHaveCount(0);
});

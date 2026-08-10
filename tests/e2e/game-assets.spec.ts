import { expect, test } from './fixtures';

type GameWindow = Window & {
  game?: {
    startRun(difficulty?: string, trials?: string[], seed?: string): unknown;
    beginSetupSprint(): unknown;
    zoomTo(level: string): unknown;
    focusDept(id: string): unknown;
  };
};

async function startSprint(page: import('@playwright/test').Page, seed: string) {
  await page.goto(`/?renderer=dom&seed=${seed}`);
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  await page.getByTestId('begin-sprint').click();
  await expect(page.getByTestId('board')).toBeVisible();
}

test('DOMの盤面・組織図・部門表示で共通アセット割当を使う', async ({ page }) => {
  await startSprint(page, 'ri92-assets');

  await expect(page.locator('[data-asset-id="product-oracle"]')).toHaveCount(1);
  await expect(page.locator('[data-asset-id="platform-architect"]')).toHaveCount(1);
  await expect(page.locator('[data-asset-id="qa-alchemist"]')).toHaveCount(1);
  await expect(page.locator('[data-asset-id="incident-commander"]')).toHaveCount(1);
  await expect(page.locator('[data-asset-id="release-captain"]')).toHaveCount(1);

  await page.evaluate(() => (window as GameWindow).game!.zoomTo('company'));
  await expect(page.getByTestId('org-board')).toBeVisible();
  const orgAssetIds = await page
    .locator('.org-game-asset')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-asset-id')));
  expect(orgAssetIds.length).toBeGreaterThan(0);
  expect(orgAssetIds).toContain('product-oracle');
  expect(orgAssetIds).toContain('platform-architect');
  expect(orgAssetIds).toContain('qa-alchemist');
  expect(orgAssetIds).toContain('sre-ranger');

  await page.evaluate(() => (window as GameWindow).game!.focusDept('platform'));
  await expect(page.getByTestId('dept-board')).toBeVisible();
  await expect(page.locator('.dept-game-asset')).toHaveCount(6);
  await expect(page.locator('.dept-game-asset[data-asset-id="platform-architect"]')).toHaveCount(3);
  await expect(page.locator('.dept-game-asset[data-asset-id="qa-alchemist"]')).toHaveCount(3);
});

test('人物SVGの取得失敗時も既存のDOM人物へフォールバックする', async ({ page }) => {
  await page.route('**/assets/game/*.svg', (route) => route.abort());
  await startSprint(page, 'ri92-assets-fallback');

  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.locator('.station-actor')).toHaveCount(5);
  await expect(page.locator('.station-actor g.cbob')).toHaveCount(5);
});

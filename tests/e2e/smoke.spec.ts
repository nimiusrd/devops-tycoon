import { expect, test } from '@playwright/test';

interface GameState {
  seed: string;
  scenario: string;
  tick: number;
}

type GameWindow = Window & {
  game?: {
    getState(): GameState;
    step(ms: number): GameState;
  };
};

test('トップページが表示される', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app-title')).toHaveText('DevOps Tycoon');
  await expect(page.getByText('Foundation Ready')).toBeVisible();
});

test('?seed= が UI と window.game に反映される（決定論フック）', async ({ page }) => {
  await page.goto('/?seed=playwright-smoke');
  await expect(page.getByTestId('seed')).toHaveText('playwright-smoke');

  const seed = await page.evaluate(() => (window as GameWindow).game?.getState().seed);
  expect(seed).toBe('playwright-smoke');
});

test('window.game.step で決定論的に状態が進む', async ({ page }) => {
  await page.goto('/?seed=deterministic');
  const tick = await page.evaluate(() => (window as GameWindow).game?.step(1000).tick);
  expect(tick).toBe(10); // 1000ms / 100ms(固定ステップ) = 10 tick
});

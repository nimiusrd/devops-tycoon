import { expect, test } from '@playwright/test';

test('Phase 0 shell exposes deterministic game hook', async ({ page }) => {
  await page.goto('/?seed=e2e-smoke');

  await expect(page.getByRole('heading', { name: 'DevOps Tycoon' })).toBeVisible();
  await expect(page.getByText('Foundation Ready')).toBeVisible();
  await expect(page.getByText('e2e-smoke')).toBeVisible();

  const state = await page.evaluate(() => {
    window.game.loadState('e2e-smoke', 'default');
    window.game.step(32);
    window.game.pause();
    return window.game.getState();
  });

  expect(state).toEqual({
    seed: 'e2e-smoke',
    scenario: 'default',
    elapsedMs: 32,
    paused: true,
  });
});

import { expect, test } from './fixtures';
import { dailySeed } from '../../src/state/meta';

test('タイトルからデイリーランを開始できる', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=daily-e2e');

  await expect(page.getByTestId('daily-run-section')).toBeVisible();
  await page.getByTestId('start-daily-run').click();

  await expect(page.getByTestId('setup')).toBeVisible({ timeout: 5000 });

  const info = await page.evaluate(() => {
    const g = window.game!;
    const s = g.getState();
    return { runKind: s.runKind, dailyDate: s.dailyDate, seed: s.seed, phase: s.phase };
  });

  expect(info.phase).toBe('setup');
  expect(info.runKind).toBe('daily');
  expect(info.dailyDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(info.seed).toBe(dailySeed(info.dailyDate!));
});

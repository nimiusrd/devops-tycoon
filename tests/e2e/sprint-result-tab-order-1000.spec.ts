/**
 * #1000: 結果画面を開いたあと Tab 1回で続行ボタンへ届く。
 */
import { expect, test } from './fixtures';
import { advanceCurrentSprintToResult, beginPublicSprint } from './fixtures';

test('結果ダイアログ上で Tab 1回目が result-continue へ届く（#1000）', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await beginPublicSprint(page, { seed: 'issue-1000-result-tab-0' });
  await advanceCurrentSprintToResult(page);

  const overlay = page.getByTestId('sprint-result');
  await expect(overlay).toBeVisible();
  await expect.poll(() => overlay.evaluate((el) => el === document.activeElement)).toBe(true);

  await page.keyboard.press('Tab');
  const firstTab = await page.evaluate(() => {
    const active = document.activeElement;
    return active instanceof HTMLElement ? (active.dataset.testid ?? active.tagName) : '';
  });
  expect(firstTab, 'Tab 1回目が続行ボタンでない').toBe('result-continue');
});

/**
 * R&D 盤面 A/B。同じ固定場面で iso / lane を切り替え、信号とヒット円があることだけを見る。
 * 視覚回帰ベースラインは増やさない。
 */
import { expect, test } from './fixtures';

test('同じ stress 場面で A iso と B lane を切り替えられる', async ({ page }) => {
  await page.goto('/?rd=iso&rdScene=stress&tutorial=off');
  const board = page.getByTestId('board');
  await expect(board).toBeVisible({ timeout: 30_000 });
  await expect(board).toHaveAttribute('data-rd-layout', 'iso');
  await expect(page.getByTestId('rd-signal-fire')).toBeVisible();
  await expect(page.getByTestId('rd-signal-congestion')).toBeVisible();
  await expect(page.getByTestId('rd-signal-spread')).toBeVisible();
  await expect(page.getByTestId('rd-hit-9001')).toBeVisible();

  await page.getByTestId('rd-layout-lane').click();
  await expect(board).toHaveAttribute('data-rd-layout', 'lane');
  await expect(page.getByTestId('rd-lane-room')).toBeVisible();
  await expect(page.getByTestId('rd-signal-fire')).toBeVisible();
  await expect(page.getByTestId('rd-signal-congestion')).toBeVisible();
  await expect(page.getByTestId('rd-signal-spread')).toBeVisible();
});

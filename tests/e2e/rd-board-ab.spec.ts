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

test('測定モードは 375 幅でティッカーとピッカーを隠し、ヒット円を覆わない', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/?rd=lane&rdScene=stress&tutorial=off&rdMeasure=1');
  const board = page.getByTestId('board');
  await expect(board).toBeVisible({ timeout: 30_000 });
  await expect(board).toHaveAttribute('data-rd-layout', 'lane');
  await expect(board).toHaveAttribute('data-rd-measure', 'true');
  await expect(page.getByTestId('event-ticker')).toHaveCount(0);
  await expect(page.getByTestId('rd-layout-picker')).toHaveCount(0);
  await expect(page.getByTestId('rd-hit-9001')).toBeVisible();
  await expect(page.getByTestId('rd-hit-9002')).toBeVisible();
  await expect(page.getByTestId('rd-signal-fire')).toBeVisible();

  const uncovered = await page.evaluate(() => {
    const ids = ['rd-hit-9001', 'rd-hit-9002'];
    const reviewHits = [...document.querySelectorAll<HTMLElement>('[data-testid^="rd-hit-"]')]
      .map((el) => el.dataset.testid ?? '')
      .filter((id) => id !== 'rd-hit-9001' && id !== 'rd-hit-9002')
      .slice(0, 3);
    const blocked = [...ids, ...reviewHits].filter((id) => {
      const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
      if (!el) return true;
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      if (!hit) return true;
      return Boolean(hit.closest('.event-ticker, .rd-board-picker'));
    });
    return { blocked };
  });
  expect(uncovered.blocked).toEqual([]);

  await page.goto('/?rd=iso&rdScene=stress&tutorial=off&rdMeasure=1');
  await expect(page.getByTestId('board')).toHaveAttribute('data-rd-layout', 'iso');
  await expect(page.getByTestId('event-ticker')).toHaveCount(0);
  await expect(page.getByTestId('rd-layout-picker')).toHaveCount(0);
});

/**
 * タイトル meta（seed / 難易度 / 試練）は非操作キャプションであり、ピルやボタンに見えない（#472）。
 */
import { expect, test } from './fixtures';

test('title-meta は枠なしキャプションでキーボードフォーカスしない', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?seed=title-meta-caption');
  await expect(page.getByTestId('title')).toBeVisible();

  const items = page.locator('.title-meta-item');
  await expect(items).toHaveCount(3);
  await expect(page.locator('.title-meta .pill')).toHaveCount(0);
  await expect(items.nth(0)).toHaveAttribute('data-testid', 'seed');
  await expect(items.nth(0)).toContainText('title-meta-caption');
  await expect(items.nth(1)).toContainText('難易度');
  await expect(items.nth(2)).toContainText('試練');

  for (const item of await items.all()) {
    await expect(item).toHaveCSS('cursor', 'default');
    await expect(item).toHaveCSS('border-top-width', '0px');
    await expect(item).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const tag = await item.evaluate((el) => el.tagName);
    expect(tag).toBe('SPAN');
    const tabIndex = await item.evaluate((el) => (el as HTMLElement).tabIndex);
    expect(tabIndex, 'meta がタブ順序に入っている').toBeLessThan(0);
  }

  await page.getByTestId('start-run').focus();
  for (let step = 0; step < 24; step += 1) {
    await page.keyboard.press('Tab');
    const focusedMeta = await page.evaluate(() =>
      document.activeElement?.classList.contains('title-meta-item')
        ? document.activeElement.textContent
        : null,
    );
    expect(focusedMeta, `Tab ${step + 1} 回目が title-meta に止まっている`).toBeNull();
  }
});

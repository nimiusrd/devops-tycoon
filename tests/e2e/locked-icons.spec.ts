import type { Locator } from '@playwright/test';
import { defaultMeta } from '../../src/state/meta';
import { expect, test } from './fixtures';
import { seedMeta } from './seedMeta';

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

async function expectLockIcon(container: Locator) {
  const icon = container.locator('[data-icon="locked"]');
  await expect(icon).toHaveCount(1);
  await expect(icon).toBeVisible();
  await expect(icon).toHaveAttribute('aria-hidden', 'true');
  expect(await icon.evaluate((element) => getComputedStyle(element).maskImage)).toContain(
    'assets/icons/security.svg',
  );
  await expect(container).not.toContainText('🔒');
}

for (const viewport of VIEWPORTS) {
  test(`未取得表示は共通の鍵SVGと読み上げ用の条件を保つ（${viewport.width}）`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await seedMeta(page, { ...defaultMeta(), seenTutorial: true });
    await page.goto('/?renderer=pixi&seed=locked-icons');
    await expect(page.getByTestId('title')).toBeVisible();

    const difficulty = page.getByTestId('difficulty-hard');
    await expect(difficulty).toBeDisabled();
    await expectLockIcon(difficulty);
    await expect(difficulty).toHaveAccessibleName(/未解放（下位難易度をクリアで解放）/);
    await expect(page.getByTestId('difficulty-easy').locator('[data-icon="locked"]')).toHaveCount(
      0,
    );

    await page.getByTestId('open-meta-shop').click();
    const gatedUnlock = page.getByTestId('meta-unlock-unlock-devin');
    await expectLockIcon(gatedUnlock);
    await expect(gatedUnlock).toBeDisabled();
    await expect(gatedUnlock).toHaveAccessibleName(/実績「超過達成クリア」が必要/);
    await page.getByTestId('meta-shop-close').click();

    await page.getByTestId('open-achievements').click();
    for (const id of [
      'achievement-no-damage',
      'win-title-noDamage',
      'failure-entry-reworkSpiral',
    ]) {
      const item = page.getByTestId(id);
      await expectLockIcon(item);
      await expect(item.getByRole('img', { name: '未取得' })).toBeVisible();
    }
    await page.getByTestId('achievement-collection-close').click();

    await page.getByTestId('open-card-collection').click();
    const card = page.getByTestId('card-collection-item-devin');
    await expectLockIcon(card);
    await expect(card.locator('.card-collection-lock-icon')).toHaveAttribute('aria-hidden', 'true');
    await expect(card).toHaveAccessibleName(/Devin導入\s*レジェンダリ/);
    await card.click();
    const detail = page.getByTestId('card-collection-detail');
    await expectLockIcon(detail);
    await expect(detail.locator('.card-collection-lock-icon')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    await expect(page.getByTestId('card-collection-unlock-condition')).toContainText(
      '実績「超過達成クリア」が必要',
    );
    await page.getByTestId('card-collection-close').click();

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
  });
}

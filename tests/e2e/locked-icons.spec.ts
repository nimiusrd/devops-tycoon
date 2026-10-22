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

/** 同じ幅・同じ文字の鍵なしコピーと行高を比べ、隣接文字との上下位置も測る。 */
async function expectInlineLockGeometry(line: Locator) {
  const geometry = await line.evaluate((element) => {
    const icon = element.querySelector<HTMLElement>('[data-icon="locked"]')!;
    const iconBounds = icon.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let followingText: Text | undefined;
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (
        node.textContent?.trim() &&
        icon.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING
      ) {
        followingText = node;
        break;
      }
    }
    if (!followingText) throw new Error('鍵に続く説明文字がない');
    const offset = followingText.textContent!.search(/\S/);
    const textRange = document.createRange();
    textRange.setStart(followingText, offset);
    textRange.setEnd(followingText, offset + 1);
    const textBounds = textRange.getBoundingClientRect();

    const clone = element.cloneNode(true) as HTMLElement;
    clone.querySelector('[data-icon="locked"]')!.remove();
    clone.setAttribute('aria-hidden', 'true');
    Object.assign(clone.style, {
      position: 'absolute',
      left: '-10000px',
      top: '0',
      width: `${bounds.width}px`,
      visibility: 'hidden',
    });
    element.parentElement!.append(clone);
    const heightWithoutIcon = clone.getBoundingClientRect().height;
    clone.remove();
    return {
      height: bounds.height,
      heightWithoutIcon,
      iconWidth: iconBounds.width,
      iconHeight: iconBounds.height,
      fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
      centerOffset: (iconBounds.top + iconBounds.bottom - textBounds.top - textBounds.bottom) / 2,
    };
  });
  expect(geometry.height).toBeCloseTo(geometry.heightWithoutIcon, 2);
  expect(geometry.iconWidth).toBeCloseTo(geometry.iconHeight, 2);
  expect(geometry.iconWidth / geometry.fontSize).toBeCloseTo(1.15, 2);
  expect(Math.abs(geometry.centerOffset)).toBeLessThanOrEqual(1);
  return geometry;
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 1280, height: 800 },
]) {
  test(`文中の鍵は正方形を保ち、行高と文字の上下位置を変えない（${viewport.width}）`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await seedMeta(page, { ...defaultMeta(), seenTutorial: true });
    await page.goto('/?renderer=pixi&seed=inline-locked-icons');
    await expect(page.getByTestId('title')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const title = await expectInlineLockGeometry(
      page.getByTestId('difficulty-hard').locator('.difficulty-desc'),
    );
    await page.getByTestId('open-meta-shop').click();
    const shop = await expectInlineLockGeometry(
      page.getByTestId('meta-unlock-unlock-devin').locator('.meta-shop-status'),
    );
    await testInfo.attach('文中の鍵の行高と文字位置', {
      body: JSON.stringify({ title, shop }, null, 2),
      contentType: 'application/json',
    });
    await page.screenshot({ path: testInfo.outputPath('文中の鍵を文字サイズへ揃えた状態.png') });
  });
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

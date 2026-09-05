import { expect, test, type Page } from './fixtures';

const PHONE_VIEWPORT = { width: 390, height: 844 } as const;

async function openFooterDialogFromScrolledTitle(
  page: Page,
  options: {
    openTestId: string;
    dialogTestId: string;
    closeTestId: string;
  },
): Promise<void> {
  await expect(page.getByTestId('title')).toBeVisible();
  const openButton = page.getByTestId(options.openTestId);
  await openButton.scrollIntoViewIfNeeded();
  const titleScrollTop = await page.getByTestId('title-scroll').evaluate((element) => {
    return (element as HTMLElement).scrollTop;
  });
  expect(titleScrollTop).toBeGreaterThan(50);

  await openButton.click();
  const dialog = page.getByTestId(options.dialogTestId);
  await expect(dialog).toBeVisible();

  const viewport = page.viewportSize() ?? PHONE_VIEWPORT;
  const metrics = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top,
      height: rect.height,
      position: getComputedStyle(element).position,
      parent: element.parentElement?.tagName ?? '',
    };
  });
  expect(metrics.position).toBe('fixed');
  expect(metrics.parent).toBe('BODY');
  expect(metrics.top).toBeGreaterThanOrEqual(-1);
  expect(metrics.top).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.height - viewport.height)).toBeLessThanOrEqual(2);

  const close = page.getByTestId(options.closeTestId);
  await expect(dialog.locator('.result-overlay-body')).toHaveAttribute('tabindex', '0');
  const closeBox = await close.boundingBox();
  expect(closeBox).not.toBeNull();
  expect(closeBox!.y).toBeGreaterThanOrEqual(0);
  expect(closeBox!.y + closeBox!.height).toBeLessThanOrEqual(viewport.height + 1);
}

test.describe('タイトルフッターのモーダルはビューポートに固定する', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('末尾スクロールから遊び方が画面内に開く', async ({ page }) => {
    await page.goto('/?seed=howto-viewport');
    await openFooterDialogFromScrolledTitle(page, {
      openTestId: 'open-help',
      dialogTestId: 'how-to-play',
      closeTestId: 'how-to-play-close',
    });

    const heading = page.getByTestId('how-to-play').getByRole('heading', { name: '遊び方' });
    const headingBox = await heading.boundingBox();
    expect(headingBox).not.toBeNull();
    expect(headingBox!.y).toBeGreaterThanOrEqual(0);
    expect(headingBox!.y).toBeLessThan(PHONE_VIEWPORT.height);

    await page.getByTestId('how-to-play-close').click();
    await expect(page.getByTestId('how-to-play')).not.toBeVisible();
  });

  test('末尾スクロールからメタショップが画面内に開く', async ({ page }) => {
    await page.goto('/?seed=meta-shop-viewport');
    await openFooterDialogFromScrolledTitle(page, {
      openTestId: 'open-meta-shop',
      dialogTestId: 'meta-shop',
      closeTestId: 'meta-shop-close',
    });
  });

  test('末尾スクロールからカードコレクションが画面内に開く', async ({ page }) => {
    await page.goto('/?seed=card-collection-viewport');
    await openFooterDialogFromScrolledTitle(page, {
      openTestId: 'open-card-collection',
      dialogTestId: 'card-collection',
      closeTestId: 'card-collection-close',
    });
  });

  test('末尾スクロールから実績コレクションが画面内に開く', async ({ page }) => {
    await page.goto('/?seed=achievement-viewport');
    await openFooterDialogFromScrolledTitle(page, {
      openTestId: 'open-achievements',
      dialogTestId: 'achievement-collection',
      closeTestId: 'achievement-collection-close',
    });
  });
});

test('研修方針・実績・リプレイは Escape で閉じ、起点へフォーカスを戻す', async ({ page }) => {
  await page.goto('/?seed=title-modal-escape');
  await expect(page.getByTestId('title')).toBeVisible();

  const dialogs = [
    { open: 'open-deck-policy', dialog: 'deck-policy' },
    { open: 'open-achievements', dialog: 'achievement-collection' },
    { open: 'open-replays', dialog: 'replay-list' },
  ] as const;

  for (const target of dialogs) {
    const openButton = page.getByTestId(target.open);
    await openButton.scrollIntoViewIfNeeded();
    await openButton.click();
    await expect(page.getByTestId(target.dialog)).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.getByTestId(target.dialog)).toHaveCount(0);
    await expect(openButton).toBeFocused();
  }
});

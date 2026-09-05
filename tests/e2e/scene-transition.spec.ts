/**
 * シーン遷移のスクロール着地と白フラッシュ防止（#368）。
 *
 * タイトル／編成のスクロール領域を遷移 CTA の末尾まで動かした状態で次画面へ進み、
 * 着地が上端であることと html 下地が白でないことを見る。
 */
import { expect, test, type Page } from './fixtures';

const PHONE = { width: 390, height: 667 };

async function windowScrollY(page: Page): Promise<number> {
  return page.evaluate(() => window.scrollY);
}

async function htmlBackgroundColor(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
}

/** Playwright の click は要素を可視位置へスクロールするので、着地再現には使わない。 */
async function clickWithoutScrolling(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).evaluate((element: HTMLElement) => {
    element.click();
  });
}

test.describe('シーン遷移のスクロールと下地', () => {
  test.use({ viewport: PHONE });

  test('html のページ下地は盤面トークンの暗い色であり白ではない', async ({ page }) => {
    await page.goto('/?seed=scene-scroll');
    await expect(page.getByTestId('title')).toBeVisible();

    // #1c1438 = board.backgroundBottom
    expect(await htmlBackgroundColor(page)).toBe('rgb(28, 20, 56)');
  });

  test('デイリー開始後の編成はビューポート上端から開き、スクロールを引き継がない', async ({
    page,
  }) => {
    await page.goto('/?seed=scene-scroll-daily');
    await expect(page.getByTestId('title')).toBeVisible();
    await expect(page.getByTestId('start-daily-run')).toBeVisible();

    await page.getByTestId('title-scroll').evaluate((element) => {
      const scroll = element as HTMLElement;
      scroll.scrollTop = scroll.scrollHeight - scroll.clientHeight;
    });
    const titleScrollY = await page.getByTestId('title-scroll').evaluate((element) => {
      return (element as HTMLElement).scrollTop;
    });
    expect(titleScrollY).toBeGreaterThan(40);

    await clickWithoutScrolling(page, 'start-daily-run');
    await expect(page.getByTestId('setup')).toBeVisible({ timeout: 5000 });

    expect(await windowScrollY(page)).toBeLessThanOrEqual(1);
    await expect(page.getByTestId('setup')).toBeInViewport();
    // 390×667 では編成の「スプリント開始」は折りたたみ下（#358）。着地は上端と setup の可視で見る。
    await expect(page.getByTestId('begin-sprint')).toBeVisible();
    expect(await htmlBackgroundColor(page)).toBe('rgb(28, 20, 56)');
  });

  test('スプリント開始後の盤面はビューポート上端から開き、スクロールを引き継がない', async ({
    page,
  }) => {
    await page.goto('/?seed=scene-scroll-sprint');
    await expect(page.getByTestId('title')).toBeVisible();
    await page.getByTestId('difficulty-easy').click();
    await page.getByTestId('start-run').evaluate((element) => {
      element.scrollIntoView({ block: 'end', inline: 'nearest' });
    });
    await clickWithoutScrolling(page, 'start-run');
    await expect(page.getByTestId('setup')).toBeVisible({ timeout: 5000 });

    await page.evaluate(() => {
      const overflowing = document.documentElement.scrollHeight > window.innerHeight + 8;
      if (!overflowing) {
        const setup = document.querySelector('[data-testid="setup"]');
        if (setup instanceof HTMLElement) {
          setup.style.minHeight = `${window.innerHeight + 900}px`;
        }
      }
      window.scrollTo(0, Math.max(0, document.documentElement.scrollHeight - window.innerHeight));
    });
    const setupScrollY = await windowScrollY(page);
    expect(setupScrollY).toBeGreaterThan(0);

    await clickWithoutScrolling(page, 'begin-sprint');
    const board = page.getByTestId('board');
    await expect(board).toBeVisible({ timeout: 5000 });

    expect(await windowScrollY(page)).toBeLessThanOrEqual(1);
    await expect(board).toBeInViewport();
    await expect(page.getByTestId('hud')).toBeInViewport();
    expect(await htmlBackgroundColor(page)).toBe('rgb(28, 20, 56)');
  });
});

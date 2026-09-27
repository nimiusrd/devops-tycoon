/**
 * 自動保存の失敗案内（RI-145）。
 * IndexedDB の起動失敗を注入し、狭幅でも再試行へ到達できることを確認する。
 */
import { expect, test } from './fixtures';

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

async function failIndexedDbOnBoot(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    const original = indexedDB.open.bind(indexedDB);
    let fail = true;
    (window as unknown as { __setIdbFail?: (next: boolean) => void }).__setIdbFail = (
      next: boolean,
    ) => {
      fail = next;
    };
    indexedDB.open = function (name: string, version?: number) {
      if (!fail) return original(name, version);
      const listeners = new Map<string, Array<(event: Event) => void>>();
      const request = {
        result: null,
        error: new DOMException('blocked', 'UnknownError'),
        addEventListener(type: string, listener: (event: Event) => void) {
          const list = listeners.get(type) ?? [];
          list.push(listener);
          listeners.set(type, list);
        },
        removeEventListener(type: string, listener: (event: Event) => void) {
          const list = (listeners.get(type) ?? []).filter((item) => item !== listener);
          listeners.set(type, list);
        },
      };
      queueMicrotask(() => {
        for (const listener of listeners.get('error') ?? []) listener(new Event('error'));
      });
      return request as unknown as IDBOpenDBRequest;
    };
  });
}

test('通常起動では保存失敗の常駐案内を出さない', async ({ page }) => {
  await page.goto('/?seed=ri145-ok');
  await expect(page.getByTestId('title')).toBeVisible();
  await expect(page.getByTestId('persistence-notice')).toHaveCount(0);
});

test('起動時に保存先を読めないときはセッション限りを表示し、再読込で案内を更新する', async ({
  page,
}) => {
  await failIndexedDbOnBoot(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?seed=ri145-session');
  const notice = page.getByTestId('persistence-notice');
  await expect(notice).toHaveAttribute('data-state', 'session');
  await expect(notice).toHaveAttribute('data-persistent', 'true');
  const layered = await notice.evaluate((element) => {
    const style = getComputedStyle(element);
    return { zIndex: style.zIndex, position: style.position };
  });
  expect(Number(layered.zIndex)).toBeGreaterThan(30);
  expect(layered.position).toBe('sticky');
  await expect(notice).toContainText('このセッション限り');
  await expect(notice).toContainText('書き戻しません');

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    const retry = page.getByTestId('persistence-retry');
    await expect(retry).toBeVisible();
    const box = await retry.boundingBox();
    expect(box, `${viewport.width}x${viewport.height}`).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    );
    expect(fits, `${viewport.width}x${viewport.height} で横スクロール`).toBe(true);
    const dock = page.getByTestId('title-launch-dock');
    await expect(dock).toBeVisible();
    const dockBox = await dock.boundingBox();
    expect(dockBox, `${viewport.width}x${viewport.height} の開始ドック`).not.toBeNull();
    expect(dockBox!.y).toBeGreaterThanOrEqual(0);
    expect(dockBox!.y + dockBox!.height).toBeLessThanOrEqual(viewport.height + 1);
  }

  await page.evaluate(() => {
    (window as unknown as { __setIdbFail: (next: boolean) => void }).__setIdbFail(false);
  });
  await page.getByTestId('persistence-retry').click();
  await expect(notice).not.toHaveAttribute('data-state', 'session');
  await expect(page.getByTestId('persistence-live')).toContainText('読み直せました');
});

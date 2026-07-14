import { expect, test } from '@playwright/test';
import type { MetaState } from '../../src/state/meta';

type MetaGameWindow = Window & {
  game?: {
    getMeta(): MetaState;
    purchaseMetaUnlock(unlockId: string): { ok: boolean; reason?: string };
  };
};

const LEGACY_KEY = 'devops-tycoon:meta:v1';

async function storedMeta(page: import('@playwright/test').Page): Promise<MetaState | null> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('devops-tycoon');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const value = await new Promise<MetaState | undefined>((resolve, reject) => {
      const request = db.transaction('meta', 'readonly').objectStore('meta').get('current');
      request.onsuccess = () => resolve(request.result as MetaState | undefined);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return value ?? null;
  });
}

test('旧 localStorage を IndexedDB へ移行し、購入後も再読み込みで復元する', async ({ page }) => {
  await page.addInitScript(({ key, meta }) => localStorage.setItem(key, JSON.stringify(meta)), {
    key: LEGACY_KEY,
    meta: {
      points: 100,
      unlockedDifficulties: ['easy', 'normal'],
      defeatedBosses: [],
      achievements: [],
      bestScore: 0,
      unlockedCards: [],
      unlockedRelics: [],
      unlockedPresets: [],
    },
  });

  await page.goto('/?renderer=dom&seed=meta-persistence-e2e');
  await expect(page.getByTestId('title')).toBeVisible();

  expect(await page.evaluate((key) => localStorage.getItem(key), LEGACY_KEY)).toBeNull();
  await expect
    .poll(() => storedMeta(page))
    .toMatchObject({
      points: 100,
      collectedWinTypes: [],
      dailyRuns: {},
    });

  expect(
    await page.evaluate(() => (window as MetaGameWindow).game?.purchaseMetaUnlock('unlock-devin')),
  ).toEqual({ ok: true });
  await expect
    .poll(() => storedMeta(page))
    .toMatchObject({
      points: 50,
      unlockedCards: ['devin'],
    });

  await page.reload();
  await expect(page.getByTestId('title')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as MetaGameWindow).game?.getMeta()))
    .toMatchObject({
      points: 50,
      unlockedCards: ['devin'],
    });
  expect(await page.evaluate((key) => localStorage.getItem(key), LEGACY_KEY)).toBeNull();
});

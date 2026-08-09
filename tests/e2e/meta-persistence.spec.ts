import { expect, test } from './fixtures';
import type { MetaState } from '../../src/state/meta';
import { seedMeta } from './seedMeta';

type MetaGameWindow = Window & {
  game?: {
    getMeta(): MetaState;
    purchaseMetaUnlock(unlockId: string): { ok: boolean; reason?: string };
  };
};

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

test('IndexedDB の保存済みメタを読み、購入後も再読み込みで復元する', async ({ page }) => {
  await seedMeta(page, {
    points: 100,
    unlockedDifficulties: ['easy', 'normal'],
    defeatedBosses: [],
    achievements: ['review-exceeded'],
    bestScore: 0,
    unlockedCards: [],
    unlockedRelics: [],
  });

  await page.goto('/?renderer=dom&seed=meta-persistence-e2e');
  await expect(page.getByTestId('title')).toBeVisible();

  await expect
    .poll(() => page.evaluate(() => (window as MetaGameWindow).game?.getMeta()))
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
});

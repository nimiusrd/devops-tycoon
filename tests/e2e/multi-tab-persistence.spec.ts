import { expect, type Page } from '@playwright/test';
import type { MetaState } from '../../src/state/meta';
import type { RunSaveSummary } from '../../src/state/runPersistence';
import { test } from './fixtures';
import { seedMeta } from './seedMeta';

type TabGameWindow = Window & {
  game?: {
    getMeta(): MetaState;
    purchaseMetaUnlock(unlockId: string): { ok: boolean; reason?: string };
    setSoundMuted(muted: boolean): void;
    hasTabConflict(): boolean;
    startRun(difficulty?: string, trials?: string[], seed?: string): unknown;
    clearRunSave(): void;
  };
};

async function storedMeta(page: Page): Promise<MetaState | null> {
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

async function storedRunSummary(page: Page): Promise<RunSaveSummary | null> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('devops-tycoon');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (![...db.objectStoreNames].includes('runSave')) {
      db.close();
      return null;
    }
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction('runSave', 'readonly').objectStore('runSave').get('current');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (!value || typeof value !== 'object') return null;
    const summary = (value as { summary?: RunSaveSummary }).summary;
    return summary ?? null;
  });
}

test('古いタブの音切替では購入を巻き戻さず、競合を案内する', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const other = await page.context().newPage();
  await other.setViewportSize({ width: 320, height: 568 });
  const initial = {
    points: 100,
    unlockedDifficulties: ['easy', 'normal'],
    defeatedBosses: [],
    achievements: ['review-exceeded'],
    bestScore: 0,
    unlockedCards: [],
    unlockedRelics: [],
  };
  await seedMeta(page, initial);
  await seedMeta(other, initial);
  await page.goto('/?seed=multi-tab-meta-a');
  await other.goto('/?tutorial=off&seed=multi-tab-meta-b');
  await expect(page.getByTestId('title')).toBeVisible();
  await expect(other.getByTestId('title')).toBeVisible();

  expect(
    await page.evaluate(() => (window as TabGameWindow).game?.purchaseMetaUnlock('unlock-devin')),
  ).toEqual({ ok: true });
  await expect
    .poll(() => storedMeta(page))
    .toMatchObject({
      points: 50,
      unlockedCards: ['devin'],
    });

  await other.evaluate(() => (window as TabGameWindow).game?.setSoundMuted(false));
  await expect(other.getByTestId('tab-conflict-notice')).toBeVisible();
  await expect(other.getByTestId('tab-conflict-reload')).toBeVisible();
  const reload = await other.getByTestId('tab-conflict-reload').boundingBox();
  expect(reload).not.toBeNull();
  expect(reload!.width).toBeGreaterThanOrEqual(44);
  expect(reload!.height).toBeGreaterThanOrEqual(44);
  expect(reload!.x).toBeGreaterThanOrEqual(0);
  expect(reload!.x + reload!.width).toBeLessThanOrEqual(320);
  await expect
    .poll(() => storedMeta(other))
    .toMatchObject({
      points: 50,
      unlockedCards: ['devin'],
      soundMuted: true,
    });
  await other.screenshot({
    path: '/opt/cursor/artifacts/tab-conflict-phone.png',
    fullPage: true,
  });
});

test('古いタブは途中セーブを破棄できず、閉じたあとに引き継げる', async ({ page }) => {
  const other = await page.context().newPage();
  await page.goto('/?seed=multi-tab-run-a');
  await other.goto('/?tutorial=off&seed=multi-tab-run-b');
  await expect(page.getByTestId('title')).toBeVisible();
  await expect(other.getByTestId('title')).toBeVisible();

  await page.evaluate(() => (window as TabGameWindow).game?.startRun('easy', [], 'multi-tab-run'));
  await expect.poll(() => storedRunSummary(page)).toMatchObject({ seed: 'multi-tab-run' });

  await other.evaluate(() => (window as TabGameWindow).game?.clearRunSave());
  await expect(other.getByTestId('tab-conflict-notice')).toBeVisible();
  await expect.poll(() => storedRunSummary(page)).toMatchObject({ seed: 'multi-tab-run' });

  await page.close();
  await other.getByTestId('tab-conflict-reload').click();
  await expect(other.getByTestId('title')).toBeVisible();
  await expect
    .poll(() => other.evaluate(() => (window as TabGameWindow).game?.hasTabConflict() ?? true))
    .toBe(false);
  await other.evaluate(() => (window as TabGameWindow).game?.clearRunSave());
  await expect.poll(() => storedRunSummary(other)).toBeNull();
});

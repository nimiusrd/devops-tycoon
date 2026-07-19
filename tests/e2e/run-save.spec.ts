import { expect, test } from '@playwright/test';
import type { RunState } from '../../src/sim/run/types';
import type { RunSaveBlob } from '../../src/state/runSave';

type SaveGameWindow = Window & {
  game?: {
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
    phase(): string;
    getState(): RunState;
    hasRunSave(): boolean;
    continueRun(): RunState | null;
  };
};

async function storedRunSave(page: import('@playwright/test').Page): Promise<RunSaveBlob | null> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('devops-tycoon');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!db.objectStoreNames.contains('runSave')) {
      db.close();
      return null;
    }
    const value = await new Promise<RunSaveBlob | undefined>((resolve, reject) => {
      const request = db.transaction('runSave', 'readonly').objectStore('runSave').get('current');
      request.onsuccess = () => resolve(request.result as RunSaveBlob | undefined);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return value ?? null;
  });
}

test('setup まで進めたランをリロード後に続きから復帰できる', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=run-save-e2e');
  await expect(page.getByTestId('title')).toBeVisible();

  await page.evaluate(() => {
    const game = (window as SaveGameWindow).game;
    game?.startRun('easy', [], 'run-save-e2e');
  });

  await expect
    .poll(() => page.evaluate(() => (window as SaveGameWindow).game?.phase()))
    .toBe('setup');
  await expect
    .poll(async () => {
      const save = await storedRunSave(page);
      return save?.state.seed ?? null;
    })
    .toBe('run-save-e2e');

  await page.reload();
  await expect(page.getByTestId('title')).toBeVisible();
  await expect(page.getByTestId('continue-run')).toBeVisible();

  await page.getByTestId('continue-run').click();
  await expect
    .poll(() => page.evaluate(() => (window as SaveGameWindow).game?.phase()))
    .toBe('setup');
  await expect
    .poll(() => page.evaluate(() => (window as SaveGameWindow).game?.getState().seed))
    .toBe('run-save-e2e');
});

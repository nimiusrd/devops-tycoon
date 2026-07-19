import { expect, test } from '@playwright/test';
import type { RunState } from '../../src/sim/run/types';
import type { RunSaveSummary } from '../../src/state/runPersistence';

type RunGameWindow = Window & {
  game?: {
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
    beginSetupSprint(): RunState;
    step(ms: number): RunState;
    phase(): string;
    isSprintRunning(): boolean;
    getState(): RunState;
    resumeRun(): RunState | null;
    hasResumableRun(): boolean;
    getRunSaveSummary(): RunSaveSummary | null;
    newRun(seed?: string): RunState;
  };
};

async function storedRunSummary(
  page: import('@playwright/test').Page,
): Promise<RunSaveSummary | null> {
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

async function advanceToResult(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const game = (window as RunGameWindow).game;
    if (!game) throw new Error('game missing');
    game.startRun('easy', [], 'ri58-e2e');
    game.beginSetupSprint();
    let guard = 0;
    while (game.isSprintRunning() && guard++ < 20_000) game.step(100);
  });
}

test('ラン途中セーブをリロード後に続きから復元できる', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=ri58-e2e');
  await expect(page.getByTestId('title')).toBeVisible();

  await advanceToResult(page);
  await expect
    .poll(async () => page.evaluate(() => (window as RunGameWindow).game?.phase()))
    .toBe('result');
  await expect
    .poll(() => storedRunSummary(page))
    .toMatchObject({
      seed: 'ri58-e2e',
      phase: 'result',
      sprintsPlayed: 1,
    });

  await page.reload();
  await expect(page.getByTestId('title')).toBeVisible();
  await expect(page.getByTestId('resume-run')).toBeVisible();
  await expect
    .poll(() => storedRunSummary(page))
    .toMatchObject({
      seed: 'ri58-e2e',
      phase: 'result',
    });

  await page.getByTestId('resume-run').click();
  await expect
    .poll(async () => page.evaluate(() => (window as RunGameWindow).game?.phase()))
    .toBe('result');
  await expect
    .poll(async () => page.evaluate(() => (window as RunGameWindow).game?.getState()))
    .toMatchObject({
      seed: 'ri58-e2e',
      phase: 'result',
      sprintsPlayed: 1,
    });
});

test('新ラン開始で旧セーブが上書きされ、タイトル復帰で消える', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=ri58-e2e-clear');
  await expect(page.getByTestId('title')).toBeVisible();

  await page.evaluate(() => {
    (window as RunGameWindow).game?.startRun('easy', [], 'ri58-old');
  });
  await expect
    .poll(() => storedRunSummary(page))
    .toMatchObject({ seed: 'ri58-old', phase: 'setup' });

  await page.evaluate(() => {
    (window as RunGameWindow).game?.startRun('normal', [], 'ri58-new');
  });
  await expect
    .poll(() => storedRunSummary(page))
    .toMatchObject({ seed: 'ri58-new', phase: 'setup' });

  await page.evaluate(() => {
    (window as RunGameWindow).game?.newRun('ri58-title');
  });
  await expect(page.getByTestId('title')).toBeVisible();
  await expect.poll(() => storedRunSummary(page)).toBeNull();
  await expect(page.getByTestId('resume-run')).toHaveCount(0);
});

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

async function updateStoredRun(
  page: import('@playwright/test').Page,
  mode: 'missing-ruleset' | 'mismatched-ruleset',
): Promise<void> {
  await page.evaluate(async (updateMode) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('devops-tycoon');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction('runSave', 'readonly').objectStore('runSave').get('current');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      db.close();
      throw new Error('run save missing');
    }
    const updated = { ...(value as Record<string, unknown>) };
    if (updateMode === 'missing-ruleset') {
      delete updated.ruleset;
    } else {
      updated.ruleset = { version: 999, fingerprint: 'different-ruleset' };
    }
    await new Promise<void>((resolve, reject) => {
      const request = db
        .transaction('runSave', 'readwrite')
        .objectStore('runSave')
        .put(updated, 'current');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    db.close();
  }, mode);
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

test('ルールセット情報のない旧セーブは理由を表示し、明示破棄まで保持する', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=ri117-unknown-e2e');
  await expect(page.getByTestId('title')).toBeVisible();

  await advanceToResult(page);
  await expect.poll(() => storedRunSummary(page)).toMatchObject({ seed: 'ri58-e2e' });
  await updateStoredRun(page, 'missing-ruleset');

  await page.reload();
  await expect(page.getByTestId('title')).toBeVisible();
  await expect(page.getByTestId('incompatible-run-save')).toBeVisible();
  await expect(page.getByTestId('run-save-issue')).toContainText('ルールセット情報がない旧セーブ');
  await expect(page.getByTestId('resume-run')).toHaveCount(0);
  await expect.poll(() => storedRunSummary(page)).toMatchObject({ seed: 'ri58-e2e' });

  await page.getByTestId('discard-run-save').click();
  await expect(page.getByTestId('incompatible-run-save')).toHaveCount(0);
  await expect.poll(() => storedRunSummary(page)).toBeNull();
});

test('ルールセット不一致セーブは保存時と現在の識別子を表示する', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=ri117-mismatch-e2e');
  await expect(page.getByTestId('title')).toBeVisible();

  await advanceToResult(page);
  await expect.poll(() => storedRunSummary(page)).toMatchObject({ seed: 'ri58-e2e' });
  await updateStoredRun(page, 'mismatched-ruleset');

  await page.reload();
  await expect(page.getByTestId('title')).toBeVisible();
  await expect(page.getByTestId('incompatible-run-save')).toBeVisible();
  await expect(page.getByTestId('run-save-issue')).toContainText(
    '保存時と現在のルールセットが一致しない',
  );
  await expect(page.getByTestId('incompatible-run-save')).toContainText('v999');
  await expect(page.getByTestId('resume-run')).toHaveCount(0);

  await page.getByTestId('discard-run-save').click();
  await expect.poll(() => storedRunSummary(page)).toBeNull();
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

test('通常セーブ再開後の新しいランは保存済み seed を維持する', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=fresh');
  await expect(page.getByTestId('title')).toBeVisible();
  await expect(page.getByTestId('seed')).toContainText('fresh');

  await page.evaluate(() => {
    (window as RunGameWindow).game?.startRun('easy', [], 'ri58-game');
  });
  await expect
    .poll(() => storedRunSummary(page))
    .toMatchObject({ seed: 'ri58-game', phase: 'setup' });

  await page.reload();
  await expect(page.getByTestId('title')).toBeVisible();
  await expect(page.getByTestId('seed')).toContainText('fresh');
  await page.getByTestId('resume-run').click();
  await expect
    .poll(async () => page.evaluate(() => (window as RunGameWindow).game?.phase()))
    .toBe('setup');

  await page.evaluate(() => {
    (window as RunGameWindow).game?.newRun();
  });
  await expect(page.getByTestId('title')).toBeVisible();
  await expect(page.getByTestId('seed')).toContainText('ri58-game');

  await page.getByTestId('start-run').click();
  await expect(page.getByTestId('setup')).toBeVisible();
  const started = await page.evaluate(() => (window as RunGameWindow).game?.getState().seed);
  expect(started).toBe('ri58-game');
});

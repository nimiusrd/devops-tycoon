import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { dailySeed } from '../../src/state/meta';
import type { RunSaveSummary } from '../../src/state/runPersistence';

type DailyGameWindow = Window & {
  game?: {
    startRun(difficulty?: string, trials?: string[], seed?: string): unknown;
    getRunSaveSummary(): RunSaveSummary | null;
    getState(): {
      runKind: string;
      dailyDate?: string;
      seed: string;
      phase: string;
    };
    getDiagnosticInfo(): unknown;
    phase(): string;
  };
};

async function storedRunSeed(page: Page): Promise<string | null> {
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
    const summary = (value as { summary?: { seed?: string } }).summary;
    return summary?.seed ?? null;
  });
}

async function openTitleWithInterruptedRun(page: Page, seed: string): Promise<void> {
  await page.goto(`/?renderer=dom&seed=${seed}`);
  await expect(page.getByTestId('title')).toBeVisible();
  await page.evaluate((runSeed) => {
    const game = (window as DailyGameWindow).game;
    if (!game) throw new Error('game missing');
    game.startRun('easy', [], runSeed);
  }, seed);
  await expect.poll(() => storedRunSeed(page)).toBe(seed);
  await page.reload();
  await expect(page.getByTestId('title')).toBeVisible();
  await expect(page.getByTestId('resume-run')).toBeVisible();
}

test('タイトルからデイリーランを開始できる', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=daily-e2e');

  await expect(page.getByTestId('daily-run-section')).toBeVisible();
  await page.getByTestId('start-daily-run').click();
  await expect(page.getByTestId('start-daily-confirm')).toHaveCount(0);

  await expect(page.getByTestId('setup')).toBeVisible({ timeout: 5000 });

  const info = await page.evaluate(() => {
    const g = (window as DailyGameWindow).game!;
    const s = g.getState();
    return {
      runKind: s.runKind,
      dailyDate: s.dailyDate,
      seed: s.seed,
      phase: s.phase,
      diagnostic: g.getDiagnosticInfo(),
    };
  });

  expect(info.phase).toBe('setup');
  expect(info.runKind).toBe('daily');
  expect(info.dailyDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(info.seed).toBe(dailySeed(info.dailyDate!));
  expect(info.diagnostic).toMatchObject({
    schemaVersion: 1,
    seed: info.seed,
    runKind: 'daily',
    dailyDate: info.dailyDate,
    ruleset: {
      version: expect.any(Number),
      fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    },
  });
});

test('中断ランがあるときデイリー開始は確認し、戻るとセーブを残す', async ({ page }) => {
  await openTitleWithInterruptedRun(page, 'ri367-keep');

  await page.getByTestId('start-daily-run').click();
  const dialog = page.getByTestId('start-daily-confirm');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('中断中のランがあります');
  await expect(dialog).toContainText('先に再開するか');
  await expect(dialog).toContainText('Easy / Q1 編成');
  await expect(page.getByTestId('start-daily-confirm-resume')).toBeVisible();

  await page.getByTestId('start-daily-confirm-cancel').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('title')).toBeVisible();
  await expect(page.getByTestId('resume-run')).toBeVisible();
  await expect.poll(() => storedRunSeed(page)).toBe('ri367-keep');
});

test('確認ダイアログで中断ランを捨てるとデイリーが始まる', async ({ page }) => {
  await openTitleWithInterruptedRun(page, 'ri367-discard');

  await page.getByTestId('start-daily-run').click();
  await page.getByTestId('start-daily-confirm-discard').click();

  await expect(page.getByTestId('setup')).toBeVisible({ timeout: 5000 });
  const started = await page.evaluate(() => {
    const state = (window as DailyGameWindow).game!.getState();
    return { runKind: state.runKind, seed: state.seed, phase: state.phase };
  });
  expect(started.phase).toBe('setup');
  expect(started.runKind).toBe('daily');
  expect(started.seed).not.toBe('ri367-discard');
  await expect.poll(() => storedRunSeed(page)).not.toBe('ri367-discard');
});

test('確認ダイアログから続きを再開できる', async ({ page }) => {
  await openTitleWithInterruptedRun(page, 'ri367-resume');

  await page.getByTestId('start-daily-run').click();
  await page.getByTestId('start-daily-confirm-resume').click();

  await expect(page.getByTestId('setup')).toBeVisible({ timeout: 5000 });
  const resumed = await page.evaluate(() => {
    const state = (window as DailyGameWindow).game!.getState();
    return { runKind: state.runKind, seed: state.seed, phase: state.phase };
  });
  expect(resumed).toMatchObject({
    phase: 'setup',
    runKind: 'normal',
    seed: 'ri367-resume',
  });
});

test('確認ダイアログは Escape で閉じ、Tab がダイアログ内に留まる', async ({ page }) => {
  await openTitleWithInterruptedRun(page, 'ri367-keyboard');

  const startDaily = page.getByTestId('start-daily-run');
  await startDaily.click();
  const dialog = page.getByTestId('start-daily-confirm');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('start-daily-confirm-resume')).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(page.getByTestId('start-daily-confirm-discard')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('start-daily-confirm-cancel')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('start-daily-confirm-resume')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('start-daily-confirm-cancel')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(startDaily).toBeFocused();
  await expect.poll(() => storedRunSeed(page)).toBe('ri367-keyboard');
});

test('確認ダイアログは狭い画面でも操作できる', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openTitleWithInterruptedRun(page, 'ri367-phone');

  await page.getByTestId('start-daily-run').click();
  const dialog = page.getByTestId('start-daily-confirm');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('start-daily-confirm-resume')).toBeVisible();
  await expect(page.getByTestId('start-daily-confirm-discard')).toBeVisible();
  await expect(page.getByTestId('start-daily-confirm-cancel')).toBeVisible();

  const overflowX = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflowX).toBeLessThanOrEqual(1);
});

test('再開できないセーブでは再開を案内せず破棄と戻るだけを出す', async ({ page }) => {
  const seed = 'ri367-incompatible';
  await openTitleWithInterruptedRun(page, seed);
  await page.evaluate(async () => {
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
    const updated = {
      ...(value as Record<string, unknown>),
      ruleset: { version: 999, fingerprint: 'different-ruleset' },
    };
    await new Promise<void>((resolve, reject) => {
      const request = db
        .transaction('runSave', 'readwrite')
        .objectStore('runSave')
        .put(updated, 'current');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    db.close();
  });
  await page.reload();
  await expect(page.getByTestId('title')).toBeVisible();
  await expect(page.getByTestId('incompatible-run-save')).toBeVisible();
  await expect(page.getByTestId('resume-run')).toHaveCount(0);

  await page.getByTestId('start-daily-run').click();
  const dialog = page.getByTestId('start-daily-confirm');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('再開できないセーブがあります');
  await expect(dialog).not.toContainText('先に再開するか');
  await expect(dialog).toContainText('戻るか、中断ランを捨ててデイリーを始めるか');
  await expect(page.getByTestId('start-daily-confirm-resume')).toHaveCount(0);
  await expect(page.getByTestId('start-daily-confirm-cancel')).toBeFocused();
  await expect(page.getByTestId('start-daily-confirm-discard')).toBeVisible();

  await page.getByTestId('start-daily-confirm-cancel').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('incompatible-run-save')).toBeVisible();
  await expect.poll(() => storedRunSeed(page)).toBe(seed);
});

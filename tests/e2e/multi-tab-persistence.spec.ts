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
    beginSetupSprint(): unknown;
    pause(): void;
    clearRunSave(): void;
    getPersistenceStatus(): unknown;
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

/** 句点で区切った語が、行をまたいで割れていないこと。 */
async function wordsBrokenAcrossLines(page: Page, testId: string): Promise<string[]> {
  return page.evaluate((id) => {
    const root = document.querySelector(`[data-testid="${id}"]`);
    if (!(root instanceof HTMLElement)) return ['missing'];
    const broken: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current) {
      const text = current.textContent ?? '';
      const parts = text.split(/[。、！？\s]+/).filter((part) => part.length >= 2);
      for (const part of parts) {
        const start = text.indexOf(part);
        if (start < 0) continue;
        const range = document.createRange();
        range.setStart(current, start);
        range.setEnd(current, start + part.length);
        const tops = new Set(
          [...range.getClientRects()]
            .filter((rect) => rect.width > 0 && rect.height > 0)
            .map((rect) => Math.round(rect.top)),
        );
        if (tops.size > 1) broken.push(part);
      }
      current = walker.nextNode();
    }
    return broken;
  }, testId);
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
  const banner = other.getByTestId('tab-conflict-notice');
  const bannerBox = await banner.boundingBox();
  expect(bannerBox).not.toBeNull();
  expect(bannerBox!.height).toBeLessThanOrEqual(136);
  await expect(banner).not.toHaveAttribute('role', 'alert');
  expect(await banner.getAttribute('aria-live')).toBeNull();
  const liveCount = await other.evaluate(() => {
    return [...document.querySelectorAll('[aria-live]')].filter((element) =>
      (element.textContent ?? '').includes('別のタブが記録を更新しました'),
    ).length;
  });
  expect(liveCount).toBe(1);
  const fontSize = await other.evaluate(() => {
    const headline = document.querySelector('.persistence-notice-headline');
    const detail = document.querySelector('.persistence-notice-detail');
    if (!(headline instanceof HTMLElement) || !(detail instanceof HTMLElement)) return null;
    return {
      headline: Number.parseFloat(getComputedStyle(headline).fontSize),
      detail: Number.parseFloat(getComputedStyle(detail).fontSize),
    };
  });
  expect(fontSize).not.toBeNull();
  expect(fontSize!.headline).toBeGreaterThanOrEqual(11);
  expect(fontSize!.detail).toBeGreaterThanOrEqual(11);
  expect(await wordsBrokenAcrossLines(other, 'tab-conflict-notice')).toEqual([]);
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

async function sprintBoardBox(target: Page) {
  return target.evaluate(() => {
    const board = document.querySelector('[data-testid="board"]');
    const stage = document.querySelector('[data-testid="sprint-slot-stage"]');
    if (!(board instanceof HTMLElement) || !(stage instanceof HTMLElement)) return null;
    const boardRect = board.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    return {
      boardY: boardRect.y,
      boardHeight: boardRect.height,
      stageY: stageRect.y,
      stageHeight: stageRect.height,
    };
  });
}

test('320px の競合案内は盤面を動かさず、書き出しと再読込を一段に置く', async ({ page }) => {
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
  await page.goto('/?seed=multi-tab-layout-a');
  await other.goto('/?tutorial=off&seed=multi-tab-layout-b');
  await expect(other.getByTestId('title')).toBeVisible();
  await other.evaluate(() => {
    const game = (window as TabGameWindow).game;
    if (!game) throw new Error('game missing');
    game.startRun('easy', [], 'multi-tab-layout');
    game.beginSetupSprint();
    game.pause();
  });
  await expect(other.getByTestId('board')).toHaveAttribute('data-effect-renderer', 'pixi');
  await expect(other.getByTestId('webgl-status')).toHaveCount(0);
  await expect
    .poll(async () => (await sprintBoardBox(other))?.boardHeight ?? 0)
    .toBeGreaterThan(40);

  const before = await sprintBoardBox(other);
  expect(before).not.toBeNull();

  expect(
    await page.evaluate(() => (window as TabGameWindow).game?.purchaseMetaUnlock('unlock-devin')),
  ).toEqual({ ok: true });
  await expect.poll(() => storedMeta(page)).toMatchObject({ points: 50 });
  await other.evaluate(() => (window as TabGameWindow).game?.setSoundMuted(false));
  const banner = other.getByTestId('tab-conflict-notice');
  await expect(banner).toBeVisible();
  await expect(other.getByTestId('tab-conflict-export')).toBeVisible();
  await expect(other.getByTestId('tab-conflict-reload')).toBeVisible();

  const after = await sprintBoardBox(other);
  expect(after).not.toBeNull();
  expect(Math.abs(after!.boardY - before!.boardY)).toBeLessThan(0.5);
  expect(Math.abs(after!.boardHeight - before!.boardHeight)).toBeLessThan(0.5);
  expect(Math.abs(after!.stageY - before!.stageY)).toBeLessThan(0.5);
  expect(Math.abs(after!.stageHeight - before!.stageHeight)).toBeLessThan(0.5);

  const reserved = await other.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue('--persistence-banner-height')
      .trim(),
  );
  expect(reserved === '' || reserved === '0px').toBe(true);

  const bannerBox = await banner.boundingBox();
  expect(bannerBox).not.toBeNull();
  expect(bannerBox!.height).toBeLessThanOrEqual(136);
  await other.screenshot({
    path: '/opt/cursor/artifacts/tab-conflict-board-320.png',
    fullPage: true,
  });
  await other.evaluate(() => {
    const copy = document.querySelector(
      '[data-testid="tab-conflict-notice"] .persistence-notice-copy',
    );
    const error = document.createElement('p');
    error.className = 'persistence-notice-detail';
    error.dataset.testid = 'tab-conflict-export-error';
    error.textContent = '途中セーブをファイルに保存できませんでした。';
    copy?.appendChild(error);
  });
  const withError = await banner.boundingBox();
  expect(withError).not.toBeNull();
  expect(withError!.height).toBeLessThanOrEqual(136);
  const afterError = await sprintBoardBox(other);
  expect(Math.abs(afterError!.boardY - before!.boardY)).toBeLessThan(0.5);
  expect(Math.abs(afterError!.stageHeight - before!.stageHeight)).toBeLessThan(0.5);
  await expect(banner).not.toHaveAttribute('role', 'alert');
  expect(await banner.getAttribute('aria-live')).toBeNull();

  const exportBox = await other.getByTestId('tab-conflict-export').boundingBox();
  const reloadBox = await other.getByTestId('tab-conflict-reload').boundingBox();
  expect(exportBox).not.toBeNull();
  expect(reloadBox).not.toBeNull();
  expect(exportBox!.height).toBeGreaterThanOrEqual(44);
  expect(reloadBox!.height).toBeGreaterThanOrEqual(44);
  expect(Math.abs(exportBox!.y - reloadBox!.y)).toBeLessThan(1);
  expect(exportBox!.x + exportBox!.width).toBeLessThanOrEqual(reloadBox!.x + 1);
  expect(reloadBox!.x + reloadBox!.width).toBeLessThanOrEqual(320);

  const fontSize = await other.evaluate(() => {
    const headline = document.querySelector(
      '[data-testid="tab-conflict-notice"] .persistence-notice-headline',
    );
    const detail = document.querySelector(
      '[data-testid="tab-conflict-notice"] .persistence-notice-detail',
    );
    const button = document.querySelector('[data-testid="tab-conflict-reload"]');
    if (
      !(headline instanceof HTMLElement) ||
      !(detail instanceof HTMLElement) ||
      !(button instanceof HTMLElement)
    ) {
      return null;
    }
    return {
      headline: Number.parseFloat(getComputedStyle(headline).fontSize),
      detail: Number.parseFloat(getComputedStyle(detail).fontSize),
      button: Number.parseFloat(getComputedStyle(button).fontSize),
    };
  });
  expect(fontSize).not.toBeNull();
  expect(fontSize!.headline).toBeGreaterThanOrEqual(11);
  expect(fontSize!.detail).toBeGreaterThanOrEqual(11);
  expect(fontSize!.button).toBeGreaterThanOrEqual(11);
  expect(await wordsBrokenAcrossLines(other, 'tab-conflict-notice')).toEqual([]);
  const liveCount = await other.evaluate(
    () =>
      [...document.querySelectorAll('[aria-live]')].filter((element) =>
        (element.textContent ?? '').includes('別のタブが記録を更新しました'),
      ).length,
  );
  expect(liveCount).toBe(1);
  const fits = await other.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );
  expect(fits).toBe(true);
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

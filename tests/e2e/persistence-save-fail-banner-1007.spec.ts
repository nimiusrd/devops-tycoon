/**
 * 保存失敗バナーの折り返しとスプリント盤面の安定（#1007）。
 */
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

const CHECK_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
] as const;

type GameWindow = Window & {
  game?: {
    beginSetupSprint(): unknown;
    pause(): void;
  };
  __setRunSaveFail?: (next: boolean) => void;
};

async function failRunSaveOnPut(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let fail = false;
    (window as GameWindow).__setRunSaveFail = (next: boolean) => {
      fail = next;
    };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args) {
      if (fail && this.name === 'runSave') {
        throw new DOMException('quota', 'QuotaExceededError');
      }
      return put.apply(this, args);
    };
  });
}

async function boardY(page: Page): Promise<number> {
  return page.evaluate(() => {
    const board = document.querySelector('[data-testid="board"]');
    if (!(board instanceof HTMLElement)) throw new Error('board が無い');
    return board.getBoundingClientRect().y;
  });
}

async function enterPausedSprint(page: Page): Promise<void> {
  await page.getByTestId('start-run').click();
  await expect(page.getByTestId('hud')).toBeVisible();
  await page.evaluate(() => {
    const game = (window as GameWindow).game;
    game?.beginSetupSprint();
    game?.pause();
  });
  await expect(page.getByTestId('sprint-layout')).toBeVisible();
  await expect(page.getByTestId('board')).toHaveAttribute('data-effect-renderer', 'pixi');
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

test('320 で保存失敗バナーは語の途中で折り返さず、盤面を動かさない', async ({ page }) => {
  await failRunSaveOnPut(page);

  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?seed=issue-1007-save-fail-ok&tutorial=off');
  await expect(page.getByTestId('title')).toBeVisible();
  await enterPausedSprint(page);
  const baseline = await boardY(page);
  await page.evaluate((y) => sessionStorage.setItem('issue-1007-board-y', String(y)), baseline);

  await page.goto('/?seed=issue-1007-save-fail&tutorial=off');
  await expect(page.getByTestId('title')).toBeVisible();
  await page.evaluate(() => (window as GameWindow).__setRunSaveFail?.(true));
  await enterPausedSprint(page);

  const notice = page.getByTestId('persistence-notice');
  await expect(notice).toHaveAttribute('data-state', 'failed');
  await expect(notice).toHaveAttribute('data-layout', 'overlay');

  const baselineFromOk = Number.parseFloat(
    (await page.evaluate(() => sessionStorage.getItem('issue-1007-board-y'))) ?? 'NaN',
  );
  const withBanner = await boardY(page);
  expect(Math.abs(withBanner - baselineFromOk)).toBeLessThan(0.5);

  for (const viewport of CHECK_VIEWPORTS) {
    await page.setViewportSize(viewport);
    const box = await notice.boundingBox();
    expect(box, `${viewport.width}x${viewport.height} のバナー`).not.toBeNull();
    if (viewport.width === 320) {
      expect(box!.y + box!.height).toBeLessThanOrEqual(136);
    }
    expect(await wordsBrokenAcrossLines(page, 'persistence-notice')).toEqual([]);
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    );
    expect(fits, `${viewport.width} で横はみ出し`).toBe(true);
    const retry = page.getByTestId('persistence-retry');
    const exportBtn = page.getByTestId('persistence-export');
    await expect(retry).toBeVisible();
    await expect(exportBtn).toBeVisible();
    const retryBox = await retry.boundingBox();
    const exportBox = await exportBtn.boundingBox();
    expect(retryBox).not.toBeNull();
    expect(exportBox).not.toBeNull();
    expect(Math.abs(retryBox!.y - exportBox!.y)).toBeLessThan(1);
    expect(retryBox!.height).toBeGreaterThanOrEqual(44);
    expect(exportBox!.height).toBeGreaterThanOrEqual(44);
  }

  const bannerBox = await notice.boundingBox();
  expect(bannerBox).not.toBeNull();
  const hudTop = await page.evaluate(() => {
    const hud = document.querySelector('[data-testid="hud"]');
    const toggle = document.querySelector('[data-testid="hud-toggle"]');
    if (!(hud instanceof HTMLElement) || !(toggle instanceof HTMLElement)) return null;
    const hudBox = hud.getBoundingClientRect();
    const toggleBox = toggle.getBoundingClientRect();
    return { hudY: hudBox.y, toggleY: toggleBox.y };
  });
  expect(hudTop).not.toBeNull();
  expect(hudTop!.hudY).toBeGreaterThanOrEqual(bannerBox!.y + bannerBox!.height - 1);
  expect(hudTop!.toggleY).toBeGreaterThanOrEqual(bannerBox!.y + bannerBox!.height - 1);
});

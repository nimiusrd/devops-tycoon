/**
 * 結果画面直後の「保存中」が KPI チップと結果本文を隠さないこと（#998）。
 */
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { advanceCurrentSprintToResult, beginCurrentSetupSprint } from './fixtures';

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
] as const;

type GameWindow = Window & {
  game?: {
    pause(): void;
  };
};

async function delayRunSaveCommit(page: Page, delayMs: number): Promise<void> {
  await page.addInitScript((delay) => {
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (
      this: IDBDatabase,
      storeNames: string | string[],
      mode?: IDBTransactionMode,
      options?: IDBTransactionOptions,
    ) {
      const tx = transaction.call(this, storeNames, mode, options);
      if (
        delay <= 0 ||
        mode !== 'readwrite' ||
        ![...(Array.isArray(storeNames) ? storeNames : [storeNames])].includes('runSave')
      ) {
        return tx;
      }
      const add = tx.addEventListener.bind(tx);
      tx.addEventListener = function (type, listener, opts) {
        if (type === 'complete' && typeof listener === 'function') {
          return add(
            type,
            (event: Event) => {
              window.setTimeout(() => listener.call(tx, event), delay);
            },
            opts,
          );
        }
        return add(type, listener, opts);
      };
      let oncomplete: ((this: IDBTransaction, ev: Event) => unknown) | null = null;
      Object.defineProperty(tx, 'oncomplete', {
        configurable: true,
        get: () => oncomplete,
        set: (handler) => {
          oncomplete = handler
            ? function (this: IDBTransaction, ev: Event) {
                window.setTimeout(() => handler.call(this, ev), delay);
              }
            : null;
        },
      });
      return tx;
    };
  }, delayMs);
}

async function overlapProbe(page: Page) {
  return page.evaluate(() => {
    const hits = (a: DOMRect, b: DOMRect) =>
      a.left < b.right - 0.5 &&
      a.right > b.left + 0.5 &&
      a.top < b.bottom - 0.5 &&
      a.bottom > b.top + 0.5;
    const noticeEl = document.querySelector(
      '[data-testid="persistence-notice"][data-state="saving"]',
    );
    const hudEl = document.querySelector('[data-testid="hud"]');
    const toggleEl = document.querySelector('[data-testid="hud-toggle"]');
    const contentEls = [
      ...document.querySelectorAll(
        '[data-testid="result-grade"], [data-testid="result-highlights"], [data-testid="result-title"]',
      ),
    ];
    const chipEls = [...document.querySelectorAll('[data-testid^="hud-compact-"], #hud-seniorHp')];
    const runbarEl = document.querySelector('[data-testid="runbar"]');
    const chipElsRunbar = runbarEl ? [...runbarEl.querySelectorAll('span, button, .pill')] : [];
    if (!(noticeEl instanceof HTMLElement) || !(hudEl instanceof HTMLElement)) {
      return { ready: false as const };
    }
    const noticeBox = noticeEl.getBoundingClientRect();
    const hudBox = hudEl.getBoundingClientRect();
    const runbarBox = runbarEl instanceof HTMLElement ? runbarEl.getBoundingClientRect() : null;
    const hit = (target: Element) => hits(noticeBox, target.getBoundingClientRect());
    const detail = noticeEl.querySelector('[data-testid="persistence-notice-detail"]');
    return {
      ready: true as const,
      parent: noticeEl.parentElement?.getAttribute('data-testid') ?? '',
      quietPlacement: noticeEl.getAttribute('data-quiet-placement'),
      overlapsHud: hit(hudEl),
      overlapsToggle: toggleEl instanceof HTMLElement ? hit(toggleEl) : false,
      overlapsChips: chipEls.some((chip) => hit(chip)),
      overlapsResult: contentEls.some((element) => hit(element)),
      overlapsRunbar:
        (runbarEl instanceof HTMLElement && hit(runbarEl)) ||
        chipElsRunbar.some((element) => hit(element)),
      belowHud: noticeBox.top >= hudBox.bottom - 1,
      inPortal: noticeEl.parentElement === document.body,
      runbarY: runbarBox?.y ?? null,
      detailHidden: !(detail instanceof HTMLElement) || getComputedStyle(detail).display === 'none',
      narrow: document.documentElement.dataset.responsiveWidth === 'narrow',
    };
  });
}

test('結果画面で保存中が KPI チップ・RunBar・結果を隠さず、KPI 位置を動かさない', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await delayRunSaveCommit(page, 2_000);

  for (const viewport of VIEWPORTS) {
    await test.step(`${viewport.width}×${viewport.height}`, async () => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/?seed=qa-seed-1031&tutorial=off');
      await page.getByTestId('start-run').click();
      await expect(page.getByTestId('hud')).toBeVisible();
      await beginCurrentSetupSprint(page);
      const compactChips = page.locator('[data-testid^="hud-compact-"]');
      const chipYBefore = await compactChips.first().evaluate((el) => el.getBoundingClientRect().y);
      await advanceCurrentSprintToResult(page);
      await page.evaluate(() => (window as GameWindow).game?.pause());
      await expect
        .poll(async () => (await overlapProbe(page)).ready, {
          timeout: 10_000,
          message: '保存中の案内が出ない',
        })
        .toBe(true);

      const placement = await overlapProbe(page);
      expect(placement.parent, 'portal ではなく HUD 横の静かな案内').toBe('persistence-quiet-slot');
      expect(placement.quietPlacement).toBe('inline');
      expect(placement.inPortal, 'body 直下の固定案内ではない').toBe(false);
      expect(placement.overlapsHud, `${viewport.width} で HUD と重なる`).toBe(false);
      expect(placement.overlapsToggle, `${viewport.width} で KPI 詳細と重なる`).toBe(false);
      expect(placement.overlapsChips, `${viewport.width} で KPI チップと重なる`).toBe(false);
      expect(placement.overlapsResult, `${viewport.width} で結果と重なる`).toBe(false);
      expect(placement.overlapsRunbar, `${viewport.width} で RunBar と重なる`).toBe(false);
      expect(placement.belowHud, `${viewport.width} で HUD の下にない`).toBe(true);
      if (placement.narrow) {
        expect(placement.detailHidden, `${viewport.width} で詳細を隠す`).toBe(true);
      }

      const chipYDuring = await compactChips.first().evaluate((el) => el.getBoundingClientRect().y);
      expect(Math.abs(chipYDuring - chipYBefore)).toBeLessThan(0.5);
    });
  }
});

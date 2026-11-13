import { expect, type Page } from '@playwright/test';
import type { MetaState } from '../../src/state/meta';
import { test } from './fixtures';
import { seedMeta } from './seedMeta';

type TabGameWindow = Window & {
  game?: {
    purchaseMetaUnlock(unlockId: string): { ok: boolean };
    setSoundMuted(muted: boolean): void;
    acknowledgeTabConflict(): void;
  };
};

const initialMeta: MetaState = {
  points: 100,
  unlockedDifficulties: ['easy', 'normal'],
  defeatedBosses: [],
  achievements: ['review-exceeded'],
  bestScore: 0,
  unlockedCards: [],
  unlockedRelics: [],
};

async function seedBoth(page: Page, other: Page, initial: MetaState) {
  await seedMeta(page, initial);
  await seedMeta(other, initial);
}

async function triggerMetaConflict(other: Page, page: Page) {
  expect(
    await page.evaluate(() => (window as TabGameWindow).game?.purchaseMetaUnlock('unlock-devin')),
  ).toEqual({ ok: true });
  await other.evaluate(() => (window as TabGameWindow).game?.setSoundMuted(false));
}

async function assertFocusStaysInHowToPlay(page: Page, label: string) {
  for (let i = 0; i < 12; i += 1) {
    const focused = await page.evaluate(() => {
      const overlayEl = document.querySelector('[data-testid="how-to-play"]');
      const active = document.activeElement;
      const testId = active instanceof HTMLElement ? (active.dataset.testid ?? active.tagName) : '';
      const inside =
        overlayEl instanceof HTMLElement && (active === overlayEl || overlayEl.contains(active));
      return { testId, inside };
    });
    expect(
      focused.inside,
      `${label}: Tab ${i} でフォーカスが遊び方の外へ抜けた (${focused.testId})`,
    ).toBe(true);
    expect(focused.testId).not.toBe('tab-conflict-continue');
    expect(focused.testId).not.toBe('tab-conflict-reload');
    expect(focused.testId).not.toBe('tab-conflict-export');
    await page.keyboard.press('Tab');
  }
}

for (const width of [320, 1280] as const) {
  test(`${width}px: 遊び方は aria-modal で Tab を閉じ込め、閉じたあと起点へ戻す`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 568 });
    await page.goto(`/?seed=howto-modal-focus-${width}`);
    await expect(page.getByTestId('title')).toBeVisible();

    await page.getByTestId('open-help').click();
    const overlay = page.getByTestId('how-to-play');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute('aria-modal', 'true');

    await assertFocusStaysInHowToPlay(page, `${width}px`);

    await page.keyboard.press('Shift+Tab');
    const afterShiftTab = await page.evaluate(() => {
      const overlayEl = document.querySelector('[data-testid="how-to-play"]');
      const active = document.activeElement;
      const testId = active instanceof HTMLElement ? (active.dataset.testid ?? active.tagName) : '';
      const inside =
        overlayEl instanceof HTMLElement && (active === overlayEl || overlayEl.contains(active));
      return { testId, inside };
    });
    expect(
      afterShiftTab.inside,
      `${width}px: Shift+Tab で遊び方の外へ抜けた (${afterShiftTab.testId})`,
    ).toBe(true);

    await page.keyboard.press('Escape');
    await expect(overlay).not.toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid')))
      .toBe('open-help');
  });

  test(`${width}px: 競合チップが出ていても遊び方の Tab は外へ抜けない`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 568 });
    const other = await page.context().newPage();
    await other.setViewportSize({ width, height: width === 1280 ? 720 : 568 });

    await seedBoth(page, other, initialMeta);
    const seedSuffix = `howto-modal-conflict-chip-${width}`;
    await page.goto(`/?seed=${seedSuffix}-a`);
    await other.goto(`/?seed=${seedSuffix}-b`);
    await expect(page.getByTestId('title')).toBeVisible();

    await triggerMetaConflict(page, other);
    await expect(page.getByTestId('tab-conflict-overlay')).toBeVisible();
    await page.getByTestId('tab-conflict-continue').click();
    await expect(page.getByTestId('tab-conflict-overlay')).toHaveCount(0);
    await expect(page.getByTestId('tab-conflict-quiet')).toBeVisible();

    await page.getByTestId('open-help').click();
    const overlay = page.getByTestId('how-to-play');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute('aria-modal', 'true');
    await assertFocusStaysInHowToPlay(page, `${width}px + quiet chip`);

    await page.keyboard.press('Escape');
    await expect(overlay).not.toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid')))
      .toBe('open-help');
  });

  test(`${width}px: 遊び方表示中の競合は前面モーダルが優先され、閉じたあと戻る`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 568 });
    const other = await page.context().newPage();
    await other.setViewportSize({ width, height: width === 1280 ? 720 : 568 });

    await seedBoth(page, other, initialMeta);
    const seedSuffix = `howto-modal-conflict-stack-${width}`;
    await page.goto(`/?seed=${seedSuffix}-a`);
    await other.goto(`/?seed=${seedSuffix}-b`);
    await expect(page.getByTestId('title')).toBeVisible();

    await page.getByTestId('open-help').click();
    await expect(page.getByTestId('how-to-play')).toBeVisible();

    await triggerMetaConflict(page, other);
    await expect(page.getByTestId('tab-conflict-overlay')).toBeVisible();
    await expect(page.getByTestId('how-to-play')).toBeVisible();

    await page.getByTestId('tab-conflict-continue').click();
    await expect(page.getByTestId('tab-conflict-overlay')).toHaveCount(0);
    await expect(page.getByTestId('how-to-play')).toBeVisible();

    const restored = await page.evaluate(() => {
      const overlayEl = document.querySelector('[data-testid="how-to-play"]');
      const active = document.activeElement;
      const testId = active instanceof HTMLElement ? (active.dataset.testid ?? active.tagName) : '';
      const inside =
        overlayEl instanceof HTMLElement && (active === overlayEl || overlayEl.contains(active));
      return { testId, inside };
    });
    expect(restored.inside, '競合モーダル後に遊び方へフォーカスが戻らない').toBe(true);
  });
}

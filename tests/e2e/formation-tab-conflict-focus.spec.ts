import { expect, type Page } from '@playwright/test';
import type { MetaState } from '../../src/state/meta';
import { test } from './fixtures';
import { seedMeta } from './seedMeta';

type TabGameWindow = Window & {
  game?: {
    purchaseMetaUnlock(unlockId: string): { ok: boolean };
    setSoundMuted(muted: boolean): void;
    startRun(difficulty?: string, trials?: string[], seed?: string): unknown;
    beginSetupSprint(): unknown;
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

async function triggerMetaConflict(page: Page, other: Page) {
  expect(
    await page.evaluate(() => (window as TabGameWindow).game?.purchaseMetaUnlock('unlock-devin')),
  ).toEqual({ ok: true });
  await other.evaluate(() => (window as TabGameWindow).game?.setSoundMuted(false));
}

async function startSetupRun(page: Page, seed: string) {
  await page.goto(`/?tutorial=off&seed=${seed}`);
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  await expect(page.getByTestId('begin-sprint')).toBeVisible();
}

for (const width of [320, 1280] as const) {
  test(`${width}px: 編成表示中の競合モーダル後に、直前の操作へフォーカスが戻る（#968）`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 568 });
    const other = await page.context().newPage();
    await other.setViewportSize({ width, height: width === 1280 ? 720 : 568 });

    await seedBoth(page, other, initialMeta);
    const seedSuffix = `formation-conflict-focus-${width}`;
    await page.goto(`/?seed=${seedSuffix}-a`);
    await other.goto(`/?seed=${seedSuffix}-b`);

    await startSetupRun(other, `${seedSuffix}-run`);
    await other.getByTestId('open-formation').click();
    await expect(other.getByTestId('formation')).toBeVisible();

    const dialog = other.getByTestId('formation');
    const focused = dialog.getByTestId('assign-m1-review');
    await focused.focus();
    await expect(focused).toBeFocused();

    await triggerMetaConflict(page, other);
    await expect(other.getByTestId('tab-conflict-overlay')).toBeVisible();
    await expect(other.getByTestId('formation')).toBeVisible();
    await expect(other.locator('#root')).toHaveJSProperty('inert', true);

    for (let i = 0; i < 8; i += 1) {
      const focused = await other.evaluate(() => {
        const overlay = document.querySelector('[data-testid="tab-conflict-overlay"]');
        const active = document.activeElement;
        const testId =
          active instanceof HTMLElement ? (active.dataset.testid ?? active.tagName) : '';
        const inside =
          overlay instanceof HTMLElement && (active === overlay || overlay.contains(active));
        return { testId, inside };
      });
      expect(focused.inside, `Tab ${i} で競合モーダル外へ抜けた (${focused.testId})`).toBe(true);
      await other.keyboard.press('Tab');
    }

    await other.getByTestId('tab-conflict-continue').click();
    await expect(other.getByTestId('tab-conflict-overlay')).toHaveCount(0);
    await expect(other.getByTestId('formation')).toBeVisible();

    await expect(focused).toBeFocused();
  });
}

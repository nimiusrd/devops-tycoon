import { expect, type Page } from '@playwright/test';
import type { MetaState } from '../../src/state/meta';
import { test } from './fixtures';
import { seedMeta } from './seedMeta';

type TabGameWindow = Window & {
  game?: {
    getState(): { sprintTick?: number };
    isPaused(): boolean;
    hasTabConflict(): boolean;
    hasTabConflictModalOpen(): boolean;
    acknowledgeTabConflict(): void;
    purchaseMetaUnlock(unlockId: string): { ok: boolean };
    setSoundMuted(muted: boolean): void;
    startRun(difficulty?: string, trials?: string[], seed?: string): unknown;
    beginSetupSprint(): unknown;
    pause(): void;
    resume(): void;
    step(ms: number): void;
  };
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

async function elementAtTapTarget(page: Page, testId: string) {
  return page.evaluate((id) => {
    const target = document.querySelector(`[data-testid="${id}"]`);
    if (!(target instanceof HTMLElement)) return null;
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const top = document.elementFromPoint(x, y);
    if (!(top instanceof HTMLElement)) return null;
    const tagged = top.closest('[data-testid]');
    return tagged instanceof HTMLElement ? (tagged.dataset.testid ?? null) : null;
  }, testId);
}

const initialMeta: MetaState = {
  points: 100,
  unlockedDifficulties: ['easy', 'normal'],
  defeatedBosses: [],
  achievements: ['review-exceeded'],
  bestScore: 0,
  unlockedCards: [],
  unlockedRelics: [],
};

for (const width of [320, 390, 1280] as const) {
  test(`${width}px: 競合モーダルは進行を止め、閉じたあと HUD とメニューが使える`, async ({
    page,
  }, testInfo) => {
    const titleOnly = testInfo.project.name.startsWith('webkit');
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 568 });
    const other = await page.context().newPage();
    await other.setViewportSize({ width, height: width === 1280 ? 720 : 568 });

    await seedBoth(page, other, initialMeta);
    const seedSuffix = `tab-conflict-modal-${width}`;
    await page.goto(`/?seed=${seedSuffix}-a`);
    await other.goto(`/?tutorial=off&seed=${seedSuffix}-b`);
    await expect(other.getByTestId('title')).toBeVisible();

    if (!titleOnly) {
      const runSeed = `tab-conflict-modal-${width}`;
      await other.evaluate((seed) => {
        const game = (window as TabGameWindow).game;
        if (!game) throw new Error('game missing');
        game.startRun('easy', [], seed);
        game.beginSetupSprint();
        game.resume();
      }, runSeed);
      await expect(other.getByTestId('board')).toHaveAttribute('data-effect-renderer', 'pixi');
    }

    await triggerMetaConflict(other, page);
    if (titleOnly) await page.close();
    await expect(other.getByTestId('tab-conflict-overlay')).toBeVisible();
    await expect(other.getByTestId('tab-conflict-continue')).toBeVisible();
    await expect(other.locator('#root')).toHaveJSProperty('inert', true);
    await expect
      .poll(() => other.evaluate(() => (window as TabGameWindow).game?.isPaused() ?? false))
      .toBe(true);

    if (!titleOnly) {
      const tickWhilePaused = await other.evaluate(() => {
        const game = (window as TabGameWindow).game;
        if (!game) return -1;
        return game.getState().sprintTick ?? -1;
      });
      expect(tickWhilePaused).toBeGreaterThanOrEqual(0);
      await other.waitForTimeout(1_500);
      const tickAfterWait = await other.evaluate(() => {
        const game = (window as TabGameWindow).game;
        if (!game) return -1;
        return game.getState().sprintTick ?? -1;
      });
      expect(tickAfterWait).toBe(tickWhilePaused);
    }

    const continueBox = await other.getByTestId('tab-conflict-continue').boundingBox();
    expect(continueBox).not.toBeNull();
    expect(continueBox!.width).toBeLessThanOrEqual(320);

    const hudTestId = titleOnly
      ? 'difficulty-normal'
      : width >= 1280
        ? 'run-menu'
        : 'hud-compact-delivery';
    const beforeAck = await elementAtTapTarget(other, hudTestId);
    if (beforeAck !== null) {
      expect(beforeAck).not.toBe(hudTestId);
    }

    if (titleOnly) {
      await other.evaluate(() => (window as TabGameWindow).game?.acknowledgeTabConflict());
    } else {
      await other.getByTestId('tab-conflict-continue').click();
    }
    await expect(other.getByTestId('tab-conflict-overlay')).toHaveCount(0);
    await expect(other.getByTestId('tab-conflict-quiet')).toBeVisible();
    await expect(other.locator('#root')).toHaveJSProperty('inert', false);
    await expect
      .poll(() => other.evaluate(() => (window as TabGameWindow).game?.hasTabConflict() ?? false))
      .toBe(true);
    await expect
      .poll(() =>
        other.evaluate(() => (window as TabGameWindow).game?.hasTabConflictModalOpen() ?? true),
      )
      .toBe(false);

    if (titleOnly) {
      const control = other.getByTestId(hudTestId);
      await expect(control).toBeVisible();
      await control.click({ trial: true });
      return;
    }

    const menuOrHud = other.getByTestId(hudTestId);
    await expect(menuOrHud).toBeVisible();
    await menuOrHud.click();
    if (!titleOnly && width >= 1280) {
      await expect(other.getByTestId('run-session-menu-panel')).toBeVisible();
    }

    const afterAck = await elementAtTapTarget(other, hudTestId);
    expect(afterAck).toBe(hudTestId);
  });
}

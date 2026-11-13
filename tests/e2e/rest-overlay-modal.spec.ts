import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

type GameWindow = Window & {
  game?: {
    getState(): { phase: string };
    pause(): void;
    playCard(index: number): unknown;
  };
};

type RunEngineInternals = {
  startRun(difficulty: string, trials: string[], seed: string, options: { kind: string }): void;
  phase: string;
};

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

async function tapAtTestIdCenter(page: Page, testId: string) {
  await page.evaluate((id) => {
    const target = document.querySelector(`[data-testid="${id}"]`);
    if (!(target instanceof HTMLElement)) return;
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const top = document.elementFromPoint(x, y);
    if (!(top instanceof HTMLElement)) return;
    top.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }),
    );
  }, testId);
}

async function openRestScreen(page: Page, seed: string) {
  await page.goto(`/?tutorial=off&seed=${seed}`);
  await page.evaluate((runSeed) => {
    const game = (window as GameWindow).game;
    if (!game) throw new Error('game missing');
    const engine = (game as unknown as { engine: RunEngineInternals }).engine;
    game.pause();
    engine.startRun('easy', [], runSeed, { kind: 'normal' });
    engine.phase = 'rest';
    game.playCard(-1);
    if (game.getState().phase !== 'rest') throw new Error('failed to enter rest');
  }, seed);
  await expect(page.getByTestId('rest')).toBeVisible({ timeout: 10_000 });
}

for (const width of [320, 390, 1280] as const) {
  test(`${width}px: 休息モーダルは HUD とメニューを塞ぎ、選択で先へ進める`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 568 });
    const seed = `rest-overlay-modal-${width}`;
    await openRestScreen(page, seed);

    const barTargets =
      width >= 1280
        ? (['run-menu', 'open-formation', 'open-org'] as const)
        : (['hud-toggle', 'open-formation', 'open-org'] as const);

    for (const testId of barTargets) {
      await expect(page.getByTestId(testId)).toBeVisible();
      const hit = await elementAtTapTarget(page, testId);
      expect(hit).not.toBe(testId);
    }

    const hudExpandedBefore = await page.getByTestId('hud-toggle').getAttribute('aria-expanded');
    for (const testId of barTargets) {
      await tapAtTestIdCenter(page, testId);
    }
    await expect(page.getByTestId('formation')).toHaveCount(0);
    await expect(page.getByTestId('org-screen')).toHaveCount(0);
    await expect(page.getByTestId('run-session-menu-panel')).toHaveCount(0);
    const hudExpandedAfter = await page.getByTestId('hud-toggle').getAttribute('aria-expanded');
    expect(hudExpandedAfter).toBe(hudExpandedBefore);

    await tapAtTestIdCenter(page, 'rest-heal');
    await expect(page.getByTestId('rest')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId('setup')).toBeVisible({ timeout: 10_000 });
  });
}

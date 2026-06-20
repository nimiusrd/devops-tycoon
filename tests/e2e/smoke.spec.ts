import { expect, test } from '@playwright/test';
import type { SimState, SprintResult } from '../../src/sim/types';

type GameWindow = Window & {
  game?: {
    pause(): void;
    getState(): SimState;
    step(ms: number): SimState;
    loadState(seed: string, scenario?: string, aiEnabled?: boolean): SimState;
    setAiEnabled(enabled: boolean): SimState;
    isComplete(): boolean;
    result(): SprintResult;
  };
};

test('メイン画面（HUD と盤面の5レーン）が表示される', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('hud')).toBeVisible();
  await expect(page.getByTestId('board')).toBeVisible();
  for (const lane of ['backlog', 'coding', 'review', 'rework', 'done']) {
    await expect(page.getByTestId(`lane-${lane}`)).toBeVisible();
  }
});

test('?seed= が UI と window.game に反映される（決定論フック）', async ({ page }) => {
  await page.goto('/?seed=playwright-smoke');
  await expect(page.getByTestId('seed')).toContainText('playwright-smoke');

  const seed = await page.evaluate(() => (window as GameWindow).game?.getState().seed);
  expect(seed).toBe('playwright-smoke');
});

test('window.game.step で決定論的に状態が進む', async ({ page }) => {
  await page.goto('/?seed=deterministic');
  const tick = await page.evaluate(() => {
    const game = (window as GameWindow).game!;
    game.pause();
    game.loadState('deterministic');
    return game.step(1000).tick;
  });
  expect(tick).toBe(10); // 1000ms / 100ms(固定ステップ) = 10 tick
});

test('1スプリントが自動進行し、リザルトが表示される', async ({ page }) => {
  await page.goto('/?seed=run');
  const overlay = page.getByTestId('sprint-result');
  await expect(overlay).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('result-grade')).toHaveText(/^[SABCD]$/);
  await expect(page.getByTestId('result-title')).toBeVisible();
});

test('AIあり/なしで結果差が出る（渋滞と手戻り。第2章）', async ({ page }) => {
  await page.goto('/?seed=compare');
  const { off, on } = await page.evaluate(() => {
    const game = (window as GameWindow).game!;
    const runToEnd = (aiEnabled: boolean): SprintResult => {
      game.pause();
      game.loadState('compare', 'default', aiEnabled);
      let guard = 0;
      while (!game.isComplete() && guard < 100000) {
        game.step(1000);
        guard += 1;
      }
      return game.result();
    };
    return { off: runToEnd(false), on: runToEnd(true) };
  });
  expect(on.aiAssistedPct).toBeGreaterThan(0);
  expect(off.aiAssistedPct).toBe(0);
  expect(on.reviewQueueMax).toBeGreaterThan(off.reviewQueueMax);
  expect(on.rework).toBeGreaterThanOrEqual(off.rework);
});

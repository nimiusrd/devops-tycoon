import { expect, test } from '@playwright/test';
import type { RunState } from '../../src/sim/run/types';

type GameWindow = Window & {
  game?: {
    pause(): void;
    getState(): RunState;
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
    enterNode(id: string): RunState;
    step(ms: number): RunState;
  };
};

test('タイトル画面が表示され、難易度を選んでランを開始できる', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('title')).toBeVisible();
  await page.getByTestId('difficulty-normal').click();
  await page.getByTestId('start-run').click();
  await expect(page.getByTestId('run-map')).toBeVisible();
  // 第0層に選べるノードがある。
  await expect(page.locator('.map-node.available').first()).toBeVisible();
});

test('?seed= が UI と window.game に反映される（決定論フック）', async ({ page }) => {
  await page.goto('/?seed=playwright-smoke');
  await expect(page.getByTestId('seed')).toContainText('playwright-smoke');

  const seed = await page.evaluate(() => (window as GameWindow).game?.getState().seed);
  expect(seed).toBe('playwright-smoke');
});

test('ノードに進入するとスプリント盤面（HUD と5レーン）が表示される', async ({ page }) => {
  await page.goto('/?seed=board');
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  await page.locator('.map-node.available').first().click();

  await expect(page.getByTestId('hud')).toBeVisible();
  await expect(page.getByTestId('board')).toBeVisible();
  for (const lane of ['backlog', 'coding', 'review', 'rework', 'done']) {
    await expect(page.getByTestId(`lane-${lane}`)).toBeVisible();
  }
});

test('window.game.step でスプリントが決定論的に進む（同一 seed で再現）', async ({ page }) => {
  await page.goto('/?seed=deterministic');
  const [a, b] = await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    const once = (): number => {
      g.pause();
      const s = g.startRun('normal', [], 'deterministic');
      g.enterNode(s.available[0]);
      const after = g.step(2000);
      return after.sprint ? after.sprint.metrics.doneCount : -1;
    };
    return [once(), once()];
  });
  expect(a).toBe(b);
  expect(a).toBeGreaterThanOrEqual(0);
});

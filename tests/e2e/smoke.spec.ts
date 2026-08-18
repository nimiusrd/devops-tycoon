import { expect, test } from './fixtures';
import type { RunState } from '../../src/sim/run/types';

type GameWindow = Window & {
  game?: {
    pause(): void;
    getState(): RunState;
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
    beginSetupSprint(): RunState;
    step(ms: number): RunState;
  };
};

test('タイトル画面が表示され、難易度を選んでランを開始できる', async ({ page }) => {
  await page.goto('/?renderer=dom');
  await expect(page.getByTestId('title')).toBeVisible();
  await page.getByTestId('difficulty-normal').click();
  await page.getByTestId('start-run').click();
  // ラン開始直後は編成（Setup）。スプリント開始ボタンが出る。
  await expect(page.getByTestId('setup')).toBeVisible();
  await expect(page.getByTestId('setup-okr')).toBeVisible();
  await expect(page.getByTestId('begin-sprint')).toBeVisible();
});

test('フロンティアモデル依存の試練を選択してランを開始できる', async ({ page }) => {
  await page.goto('/?renderer=dom');
  const trial = page.getByTestId('trial-frontier-dependency');
  await expect(trial).toContainText('フロンティアモデル依存');
  await trial.click();
  await expect(trial).toHaveClass(/on/);
  await page.getByTestId('start-run').click();
  await expect(page.getByTestId('setup')).toBeVisible();

  const trials = await page.evaluate(() => (window as GameWindow).game?.getState().trials);
  expect(trials).toEqual(['frontier-dependency']);
});

test('?seed= が UI と window.game に反映される（決定論フック）', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=playwright-smoke');
  await expect(page.getByTestId('seed')).toContainText('playwright-smoke');

  const seed = await page.evaluate(() => (window as GameWindow).game?.getState().seed);
  expect(seed).toBe('playwright-smoke');
});

test('スプリントを開始すると盤面（HUD と5レーン）が表示される', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=board');
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  await page.getByTestId('begin-sprint').click();

  await expect(page.getByTestId('hud')).toBeVisible();
  await expect(page.getByTestId('board')).toBeVisible();
  for (const lane of ['backlog', 'coding', 'review', 'rework', 'done']) {
    await expect(page.getByTestId(`lane-${lane}`)).toBeVisible();
  }
});

test('window.game.step でスプリントが決定論的に進む（同一 seed で再現）', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=deterministic');
  const [a, b] = await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    const once = (): number => {
      g.pause();
      g.startRun('normal', [], 'deterministic');
      g.beginSetupSprint();
      const after = g.step(2000);
      return after.sprint ? after.sprint.metrics.doneCount : -1;
    };
    return [once(), once()];
  });
  expect(a).toBe(b);
  expect(a).toBeGreaterThanOrEqual(0);
});

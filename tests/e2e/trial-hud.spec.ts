import { expect, test } from './fixtures';
import type { RunState } from '../../src/sim/run/types';
import { getDifficulty } from '../../src/data/difficulties';

type GameWindow = Window & {
  game?: {
    getState(): RunState;
  };
};

test.describe('trial HUD (issue #382)', () => {
  test('予算半減オンなら開始予算が半減し、ラン中 HUD に試練が出る', async ({ page }) => {
    const easyBudget = getDifficulty('easy').startBudget;
    const halved = Math.round(easyBudget * 0.5);

    await page.goto('/?renderer=pixi');
    await expect(page.getByTestId('title')).toBeVisible();
    await page.getByTestId('difficulty-easy').click();
    const trial = page.getByTestId('trial-half-budget');
    await expect(trial).toContainText('予算半減');
    await trial.click();
    await expect(trial).toHaveClass(/on/);
    await page.getByTestId('start-run').click();

    await expect(page.getByTestId('setup')).toBeVisible();
    await expect(page.getByTestId('runbar')).toBeVisible();
    await expect(page.getByTestId('budget')).toContainText(String(halved));
    await expect(page.getByTestId('run-trial-half-budget')).toHaveText('予算半減');
    await expect(page.getByTestId('budget')).toHaveAttribute(
      'title',
      /試練「予算半減」で開始予算×0\.5/,
    );

    const state = await page.evaluate(() => (window as GameWindow).game?.getState());
    expect(state?.trials).toEqual(['half-budget']);
    expect(state?.budget).toBe(halved);
    expect(state?.budget).not.toBe(easyBudget);
  });

  test('試練なしの開始では HUD に試練 pill が出ず、Easy 開始予算のまま', async ({ page }) => {
    const easyBudget = getDifficulty('easy').startBudget;

    await page.goto('/?renderer=pixi');
    await expect(page.getByTestId('title')).toBeVisible();
    await page.getByTestId('difficulty-easy').click();
    await page.getByTestId('start-run').click();

    await expect(page.getByTestId('setup')).toBeVisible();
    await expect(page.getByTestId('runbar')).toBeVisible();
    await expect(page.getByTestId('budget')).toContainText(String(easyBudget));
    await expect(page.getByTestId('run-trial-half-budget')).toHaveCount(0);

    const state = await page.evaluate(() => (window as GameWindow).game?.getState());
    expect(state?.trials).toEqual([]);
    expect(state?.budget).toBe(easyBudget);
  });

  test('スプリント中の compact HUD でも予算半減の試練が見える', async ({ page }) => {
    await page.goto('/?seed=trial-hud-sprint');
    await expect(page.getByTestId('title')).toBeVisible();
    await page.getByTestId('difficulty-easy').click();
    await page.getByTestId('trial-half-budget').click();
    await page.getByTestId('start-run').click();
    await expect(page.getByTestId('setup')).toBeVisible();
    await page.getByTestId('begin-sprint').click();

    await expect(page.getByTestId('hud')).toBeVisible();
    await expect(page.getByTestId('runbar')).toBeVisible();
    await expect(page.getByTestId('run-trial-half-budget')).toBeVisible();
    await expect(page.getByTestId('run-trial-half-budget')).toHaveText('予算半減');
  });
});

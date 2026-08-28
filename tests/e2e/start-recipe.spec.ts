import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { serializeStartRecipe, START_RECIPE_REASON_MESSAGE } from '../../src/state/startRecipe';

async function readRecipeJson(page: Page): Promise<{
  trials: string[];
  difficulty: string;
  scenario: string;
}> {
  return JSON.parse(await page.getByTestId('start-recipe-text').inputValue()) as {
    trials: string[];
    difficulty: string;
    scenario: string;
  };
}

test.describe('start recipe share (RI-127)', () => {
  test('pasting a recipe restores title selections without starting', async ({ page }) => {
    const recipe = serializeStartRecipe({
      seed: 'shared-org',
      difficulty: 'easy',
      trials: ['low-focus'],
      scenario: 'copilot',
      preferredCardIds: ['docs'],
    });

    await page.goto('/?renderer=dom&seed=title-default');
    await expect(page.getByTestId('title')).toBeVisible();
    await expect(page.getByTestId('seed')).toContainText('title-default');

    await page.getByTestId('start-recipe-text').fill(recipe);
    await page.getByTestId('start-recipe-apply').click();

    await expect(page.getByTestId('start-recipe-status')).toHaveText('開始条件を読み込みました。');
    await expect(page.getByTestId('title')).toBeVisible();
    await expect(page.getByTestId('seed')).toContainText('shared-org');
    await expect(page.getByTestId('difficulty-easy')).toHaveClass(/selected/);
    await expect(page.getByTestId('trial-low-focus')).toHaveClass(/on/);
    await expect(page.getByTestId('scenario-copilot')).toHaveClass(/on/);
    await expect(page.getByTestId('open-deck-policy')).toContainText('（1）');

    await page.getByTestId('start-run').click();
    await expect(page.getByTestId('setup')).toBeVisible();
    await expect(page.getByTestId('scenario')).toHaveText('Copilot');
  });

  test('locked difficulty stays on title and shows a reason', async ({ page }) => {
    const recipe = serializeStartRecipe({
      seed: 'locked-hard',
      difficulty: 'hard',
      trials: [],
      scenario: 'default',
      preferredCardIds: [],
    });

    await page.goto('/?renderer=dom');
    await expect(page.getByTestId('title')).toBeVisible();

    await page.getByTestId('start-recipe-text').fill(recipe);
    await page.getByTestId('start-recipe-apply').click();

    await expect(page.getByTestId('start-recipe-status')).toHaveText(
      START_RECIPE_REASON_MESSAGE.locked_difficulty,
    );
    await expect(page.getByTestId('title')).toBeVisible();
    await expect(page.getByTestId('setup')).toHaveCount(0);
    await expect(page.getByTestId('difficulty-hard')).toBeDisabled();
  });

  test('ファイルで保存すると開始レシピをダウンロードできる', async ({ page }) => {
    await page.goto('/?renderer=dom&seed=recipe-download');
    await expect(page.getByTestId('title')).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('start-recipe-download').click(),
    ]);
    expect(download.suggestedFilename()).toBe('devops-tycoon-start-recipe.json');
    const recipePath = await download.path();
    expect(recipePath).toBeTruthy();
    await expect(page.getByTestId('start-recipe-status')).toHaveText(
      '開始レシピをファイルに保存しました。',
    );

    await page.getByTestId('start-recipe-file').setInputFiles(recipePath!);
    await expect(page.getByTestId('start-recipe-status')).toHaveText('開始条件を読み込みました。');
    await expect(page.getByTestId('seed')).toContainText('recipe-download');
  });

  test('trial chip selection updates export JSON without 書き出す', async ({ page }) => {
    await page.goto('/?renderer=dom&seed=recipe-trial-sync');
    await expect(page.getByTestId('title')).toBeVisible();

    await expect.poll(async () => (await readRecipeJson(page)).trials).toEqual([]);

    await page.getByTestId('trial-low-focus').click();
    await expect(page.getByTestId('trial-low-focus')).toHaveClass(/on/);
    await expect.poll(async () => (await readRecipeJson(page)).trials).toEqual(['low-focus']);

    await page.getByTestId('trial-half-budget').click();
    await expect
      .poll(async () => (await readRecipeJson(page)).trials)
      .toEqual(['low-focus', 'half-budget']);

    await page.getByTestId('difficulty-normal').click();
    await page.getByTestId('scenario-copilot').click();
    await expect.poll(async () => (await readRecipeJson(page)).difficulty).toBe('normal');
    await expect.poll(async () => (await readRecipeJson(page)).scenario).toBe('copilot');

    await page.getByTestId('trial-low-focus').click();
    await expect(page.getByTestId('trial-low-focus')).not.toHaveClass(/on/);
    await expect.poll(async () => (await readRecipeJson(page)).trials).toEqual(['half-budget']);

    await page.getByTestId('start-recipe-export').click();
    await expect(page.getByTestId('start-recipe-status')).toHaveText(
      '現在の開始条件を書き出しました。',
    );
    await expect.poll(async () => (await readRecipeJson(page)).trials).toEqual(['half-budget']);
  });
});

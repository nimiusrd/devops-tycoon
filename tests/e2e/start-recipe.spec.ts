import { expect, test } from './fixtures';
import { serializeStartRecipe, START_RECIPE_REASON_MESSAGE } from '../../src/state/startRecipe';

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
});

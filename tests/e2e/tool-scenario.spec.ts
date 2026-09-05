import { expect, test } from './fixtures';

test.describe('tool scenarios (RI-103)', () => {
  test('title scenario chips start a Copilot run and show the HUD pill', async ({ page }) => {
    await page.goto('/?renderer=pixi');
    await expect(page.getByTestId('title')).toBeVisible();
    await expect(page.getByTestId('scenario-default')).toBeVisible();
    await expect(page.getByTestId('scenario-copilot')).toBeVisible();
    await page.getByTestId('scenario-copilot').click();
    await page.getByTestId('start-run').click();
    await expect(page.getByTestId('setup')).toBeVisible();
    await expect(page.getByTestId('runbar')).toBeVisible();
    await expect(page.getByTestId('scenario')).toHaveText('Copilot');
  });

  test('default start-run path does not show a scenario pill', async ({ page }) => {
    await page.goto('/?renderer=pixi');
    await expect(page.getByTestId('title')).toBeVisible();
    await page.getByTestId('start-run').click();
    await expect(page.getByTestId('setup')).toBeVisible();
    await expect(page.getByTestId('runbar')).toBeVisible();
    await expect(page.getByTestId('scenario')).toHaveCount(0);
  });
});

import { expect, test } from '@playwright/test';
import type { MetaState } from '../../src/state/meta';

const META_WITH_ACHIEVEMENT: MetaState = {
  points: 0,
  unlockedDifficulties: ['easy', 'normal'],
  defeatedBosses: [],
  achievements: ['first-clear'],
  bestScore: 120,
  unlockedCards: [],
  unlockedRelics: [],
  unlockedPresets: [],
  dailyRuns: {},
};

test('タイトルから実績コレクションを開き取得済み／未取得を区別表示できる', async ({ page }) => {
  await page.addInitScript((meta) => {
    localStorage.setItem('devops-tycoon:meta:v1', JSON.stringify(meta));
  }, META_WITH_ACHIEVEMENT);

  await page.goto('/?seed=achievement-collection-e2e');

  await page.getByTestId('open-achievements').click();
  await expect(page.getByTestId('achievement-collection')).toBeVisible();
  await expect(page.getByTestId('achievement-count')).toHaveText('1/5');

  const firstClear = page.getByTestId('achievement-first-clear');
  await expect(firstClear).toHaveAttribute('data-unlocked', 'true');
  await expect(page.getByTestId('achievement-hint-first-clear')).toHaveText('達成済み');

  const noDamage = page.getByTestId('achievement-no-damage');
  await expect(noDamage).toHaveAttribute('data-unlocked', 'false');
  await expect(page.getByTestId('achievement-hint-no-damage')).toContainText('残業');

  await page.getByTestId('achievement-collection-close').click();
  await expect(page.getByTestId('achievement-collection')).not.toBeVisible();
});

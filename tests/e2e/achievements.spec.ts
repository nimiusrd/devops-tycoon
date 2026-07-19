import { expect, test } from './fixtures';
import type { MetaState } from '../../src/state/meta';

const META_WITH_ACHIEVEMENT: MetaState = {
  points: 0,
  unlockedDifficulties: ['easy', 'normal'],
  defeatedBosses: [],
  achievements: ['first-clear'],
  collectedWinTypes: ['healthy'],
  collectedDiagnoses: ['reviewHell'],
  bestScore: 120,
  unlockedCards: [],
  unlockedRelics: [],
  dailyRuns: {},
  soundMuted: false,
  seenTutorial: true,
};

test('タイトルから実績コレクションを開き取得済み／未取得を区別表示できる', async ({ page }) => {
  await page.addInitScript((meta) => {
    localStorage.setItem('devops-tycoon:meta:v1', JSON.stringify(meta));
  }, META_WITH_ACHIEVEMENT);

  await page.goto('/?renderer=dom&seed=achievement-collection-e2e');

  await page.getByTestId('open-achievements').click();
  await expect(page.getByTestId('achievement-collection')).toBeVisible();
  await expect(page.getByTestId('achievement-count')).toHaveText('1/7');

  const firstClear = page.getByTestId('achievement-first-clear');
  await expect(firstClear).toHaveAttribute('data-unlocked', 'true');
  await expect(page.getByTestId('achievement-hint-first-clear')).toHaveText('達成済み');

  const noDamage = page.getByTestId('achievement-no-damage');
  await expect(noDamage).toHaveAttribute('data-unlocked', 'false');
  await expect(page.getByTestId('achievement-hint-no-damage')).toContainText('残業');

  await expect(page.getByTestId('win-title-count')).toHaveText('1/7');
  const healthy = page.getByTestId('win-title-healthy');
  await expect(healthy).toHaveAttribute('data-unlocked', 'true');
  await expect(page.getByTestId('win-title-hint-healthy')).toContainText('出荷・品質・士気');

  const noDamageTitle = page.getByTestId('win-title-noDamage');
  await expect(noDamageTitle).toHaveAttribute('data-unlocked', 'false');
  await expect(page.getByTestId('win-title-hint-noDamage')).toContainText('残業');

  await expect(page.getByTestId('failure-encyclopedia')).toBeVisible();
  await expect(page.getByTestId('failure-encyclopedia-count')).toHaveText('1/4');
  const reviewHell = page.getByTestId('failure-entry-reviewHell');
  await expect(reviewHell).toHaveAttribute('data-unlocked', 'true');
  await expect(page.getByTestId('failure-entry-hint-reviewHell')).toContainText('レビュー枠');
  const rework = page.getByTestId('failure-entry-reworkSpiral');
  await expect(rework).toHaveAttribute('data-unlocked', 'false');
  await expect(page.getByTestId('failure-entry-hint-reworkSpiral')).toContainText('手戻り');

  await page.getByTestId('achievement-collection-close').click();
  await expect(page.getByTestId('achievement-collection')).not.toBeVisible();
});

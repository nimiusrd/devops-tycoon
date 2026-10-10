import { expect, test } from './fixtures';
import type { MetaState } from '../../src/state/meta';
import { seedMeta } from './seedMeta';

const META_WITH_ACHIEVEMENT: MetaState = {
  points: 0,
  unlockedDifficulties: ['easy', 'normal'],
  defeatedBosses: [],
  achievements: ['first-clear'],
  collectedWinTypes: ['healthy'],
  collectedWinCombos: ['easy:healthy'],
  collectedDiagnoses: ['reviewHell'],
  bestScore: 120,
  unlockedCards: [],
  unlockedRelics: [],
  preferredCardIds: [],
  dailyRuns: {},
  soundMuted: false,
  seenTutorial: true,
};

test('タイトルから実績コレクションを開き取得済み／未取得を区別表示できる', async ({ page }) => {
  await seedMeta(page, META_WITH_ACHIEVEMENT);

  await page.goto('/?seed=achievement-collection-e2e');

  await page.getByTestId('open-achievements').click();
  await expect(page.getByTestId('achievement-collection')).toBeVisible();
  await expect(
    page.getByTestId('achievement-collection').locator('.result-overlay-body'),
  ).toHaveAttribute('tabindex', '0');
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

const VIEWPORTS = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`難易度別の勝ち方を横はみ出しなしで表示できる（${viewport.name}）`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seedMeta(page, META_WITH_ACHIEVEMENT);
    await page.goto('/?seed=achievement-collection-e2e');
    await page.getByTestId('open-achievements').click();

    const codex = page.getByTestId('win-combo-codex');
    await codex.scrollIntoViewIfNeeded();
    await expect(codex).toBeVisible();
    await expect(page.getByTestId('win-combo-count')).toHaveText('1/28');
    await expect(page.getByTestId('win-combo-next')).toContainText('Normal');
    await expect(page.getByTestId('win-combo-easy-healthy')).toHaveAttribute(
      'data-achieved',
      'true',
    );
    await expect(page.getByTestId('win-combo-normal-healthy')).toHaveAttribute(
      'data-achieved',
      'false',
    );
    await expect(page.getByTestId('win-combo-row-hard')).toHaveAttribute('data-unlocked', 'false');

    const overflow = await codex.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const docOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(docOverflow).toBeLessThanOrEqual(0);

    await codex.screenshot({
      path: test.info().outputPath(`win-combo-codex-${viewport.name}.png`),
    });
  });
}

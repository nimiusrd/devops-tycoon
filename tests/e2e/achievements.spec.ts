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
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'desktop-short', width: 1024, height: 768 },
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'desktop-wide', width: 1440, height: 900 },
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
    await expect(page.getByTestId('win-combo-next')).toHaveText(
      '次の目標: Easy で 通常勝利・AI 導入成功勝利',
    );
    await expect(codex.locator('.win-combo-cells [data-next-goal="true"]')).toHaveCount(2);
    await expect(page.getByTestId('win-combo-row-easy')).toHaveClass(/is-next-goal/);
    const achieved = page.getByTestId('win-combo-easy-healthy');
    const nextGoal = page.getByTestId('win-combo-easy-normal');
    const unmet = page.getByTestId('win-combo-easy-management');
    expect(await achieved.ariaSnapshot()).toMatch(/健全勝利\s*、達成/);
    expect(await nextGoal.ariaSnapshot()).toMatch(/通常勝利\s*、未達、次の目標/);
    expect(await unmet.ariaSnapshot()).toMatch(/経営勝利\s*、未達/);
    expect(await achieved.ariaSnapshot()).not.toContain('✓');
    await expect(achieved.locator('[aria-hidden="true"]')).toHaveText('✓');
    for (const cell of [achieved, nextGoal, unmet]) {
      await expect(cell.locator('.visually-hidden')).toHaveCSS('width', '0px');
      await expect(cell.locator('.visually-hidden')).toHaveCSS('height', '0px');
    }
    await expect(page.getByTestId('win-combo-easy-healthy')).toHaveAttribute(
      'data-achieved',
      'true',
    );
    await expect(page.getByTestId('win-combo-normal-healthy')).toHaveAttribute(
      'data-achieved',
      'false',
    );
    const hard = page.getByTestId('win-combo-row-hard');
    await expect(hard).toHaveAttribute('data-unlocked', 'false');
    const lock = hard.getByRole('img', { name: '難易度未解放' });
    await expect(lock).toBeVisible();
    const lockIcon = lock.locator('[data-icon="locked"]');
    await expect(lockIcon).toBeVisible();
    await expect(lockIcon).toHaveAttribute('aria-hidden', 'true');
    expect(await lockIcon.evaluate((icon) => getComputedStyle(icon).maskImage)).toContain(
      'assets/icons/security.svg',
    );
    expect(await lock.ariaSnapshot()).toBe('- img "難易度未解放"');
    await expect(hard).toHaveCSS('border-style', 'dashed');
    await expect(hard.locator('.win-combo-row-count')).toHaveCount(0);
    expect((await hard.innerText()).match(/前の難易度でボスを突破すると解放/g)).toHaveLength(1);
    const lockedContrast = await hard.evaluate((row) => {
      const luminance = (color: string) => {
        const channels = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((value) => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const ratio = (foreground: string, background: string) => {
        const a = luminance(foreground);
        const b = luminance(background);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      const surfaceOf = (element: Element) => {
        let current: Element | null = element;
        while (current) {
          const background = getComputedStyle(current).backgroundColor;
          const alpha = background.match(/[\d.]+/g)?.[3];
          if (/^rgb\(/.test(background) || (alpha !== undefined && Number(alpha) > 0)) {
            return background;
          }
          current = current.parentElement;
        }
        return 'rgb(0, 0, 0)';
      };
      const readable = (selector: string) => {
        const element = row.querySelector(selector);
        if (!element) return 0;
        return ratio(getComputedStyle(element).color, surfaceOf(element));
      };
      return {
        opacity: getComputedStyle(row).opacity,
        label: readable('.achievement-card-label'),
        hint: readable('.achievement-card-hint'),
      };
    });
    expect(Number(lockedContrast.opacity)).toBe(1);
    expect(lockedContrast.label).toBeGreaterThanOrEqual(4.5);
    expect(lockedContrast.hint).toBeGreaterThanOrEqual(4.5);

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

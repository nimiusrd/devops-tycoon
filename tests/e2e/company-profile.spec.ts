import type { Locator } from '@playwright/test';
import type { RunSave } from '../../src/state/runPersistence';
import { expect, test } from './fixtures';

const VIEWPORTS = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'desktop-short', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

async function expectNoHorizontalOverflow(container: Locator) {
  const extraWidth = await container.evaluate(
    (element) => element.scrollWidth - element.clientWidth,
  );
  expect(extraWidth).toBeLessThanOrEqual(1);
}

for (const { name, width, height } of VIEWPORTS) {
  test.describe(name, () => {
    test.use({
      viewport: { width, height },
      hasTouch: width <= 390,
      reducedMotion: width <= 390 ? 'reduce' : 'no-preference',
    });

    test('編成と全社マップでプロフィールを展開でき、盤面と既存操作が使える', async ({
      page,
      hasTouch,
    }) => {
      test.setTimeout(60_000);
      await page.goto(`/?renderer=pixi&seed=company-profile-${name}`);
      await page.getByTestId('difficulty-easy').click();
      await page.getByTestId('start-run').click();

      const setup = page.getByTestId('setup');
      const setupProfile = setup.getByTestId('company-profile');
      const summary = setupProfile.getByTestId('company-profile-summary');
      await expect(summary).toContainText('この会社が築いたもの');
      await expect(summary).toContainText('進化 0/15');
      await expect(setupProfile).not.toHaveAttribute('open', '');
      if (hasTouch) {
        await summary.tap();
      } else {
        await summary.focus();
        await page.keyboard.press('Enter');
      }
      await expect(setupProfile).toHaveAttribute('open', '');
      expect((await summary.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await expect(setupProfile.getByRole('heading', { name: '組織進化と次の目標' })).toBeVisible();
      await expect(setupProfile.getByTestId('company-profile-points')).toHaveText('0');
      await expect(setupProfile.getByTestId('company-profile-members').locator('li')).toHaveCount(
        3,
      );
      await expectNoHorizontalOverflow(setup.locator('.formation-panel'));

      await page.getByTestId('open-org').click();
      const org = page.getByTestId('org-screen');
      const orgProfile = org.getByTestId('company-profile');
      await expect(org.getByTestId('org-pixi-mount').locator('canvas')).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId('webgl-status')).toHaveCount(0);
      await expect(org.getByTestId('org-diagnosis')).toBeVisible();
      const stage = org.getByTestId('org-field');
      const collapsed = await stage.boundingBox();
      expect(collapsed?.height ?? 0).toBeGreaterThan(0);
      await orgProfile.getByTestId('company-profile-summary').click();
      await expect(orgProfile).toHaveAttribute('open', '');
      await expect(orgProfile.getByTestId('company-profile-members').locator('li')).toHaveText(
        await setupProfile.getByTestId('company-profile-members').locator('li').allTextContents(),
      );
      const review = orgProfile.getByTestId('company-profile-branch-review');
      await review.locator('summary').click();
      await expect(review.getByTestId('company-profile-node-review-2')).toContainText('前提未達');
      const expanded = await stage.boundingBox();
      expect(expanded?.width).toBeCloseTo(collapsed!.width);
      expect(expanded?.height ?? 0).toBeGreaterThanOrEqual(width >= 1024 ? 364 : 279);
      await expectNoHorizontalOverflow(page.getByTestId('zoom-overlay'));
      await page.getByTestId('crumb-team').click();
      await setup.getByTestId('begin-sprint').click();
      await expect(page.getByTestId('board')).toHaveAttribute('data-effect-renderer', 'pixi', {
        timeout: 30_000,
      });
    });
  });
}

test('新しい編成ダイアログ内の詳細をTabとSpaceで開閉し、Escapeで起点に戻る', async ({ page }) => {
  await page.goto('/?renderer=pixi&seed=company-profile-focus');
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  const opener = page.getByTestId('open-formation');
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByTestId('formation');
  const profile = dialog.getByTestId('company-profile');
  const summary = profile.getByTestId('company-profile-summary');
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(summary).toBeFocused();
  expect(await summary.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
  await page.keyboard.press('Space');
  await expect(profile).toHaveAttribute('open', '');
  await page.keyboard.press('Tab');
  await expect(profile.getByTestId('company-profile-branch-dev').locator('summary')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(summary).toBeFocused();
  await page.keyboard.press('Space');
  await expect(profile).not.toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('保存から再開した進化・昇格・所持を表示し、全社の増設と炎上中も編成を区別する', async ({
  page,
}) => {
  await page.goto('/?renderer=pixi&seed=company-profile-resume');
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  await expect(page.getByTestId('setup')).toBeVisible();

  const imported = await page.evaluate(async () => {
    const game = window.game!;
    const raw = game.exportRunSaveText();
    if (!raw) throw new Error('検証用のランを書き出せませんでした');
    const save: RunSave = JSON.parse(raw);
    save.state.evolution = { points: 2, unlocked: { 'dev-1': true, 'review-1': true } };
    save.state.deck = [{ defId: 'copilot', level: 2 }];
    save.state.relics = ['small-pr'];
    save.state.roster.members[0].name = '検証 さくら';
    save.state.roster.members[0].rank = 'senior';
    save.state.roster.members[0].level = 7;
    const otherTeam = save.state.extras.teams?.find(
      (team) => team.id !== save.state.extras.activeTeamId,
    );
    if (!otherTeam) throw new Error('炎上中のチームを記録できませんでした');
    otherTeam.incidents = 3;
    return (await game.importRunSaveText(JSON.stringify(save))).ok;
  });
  expect(imported).toBe(true);
  await page.reload();
  await page.getByTestId('resume-run').click();
  const setup = page.getByTestId('setup');
  const profile = setup.getByTestId('company-profile');
  const summary = profile.getByTestId('company-profile-summary');
  await expect(summary).toContainText('進化 2/15');
  await expect(summary).toContainText('カード 1枚');
  await expect(summary).toContainText('レリック 1個');
  await summary.click();
  await expect(profile.getByTestId('company-profile-points')).toHaveText('2');
  const review = profile.getByTestId('company-profile-branch-review');
  await expect(review.locator('summary')).toContainText('レビュー体制 1/3');
  await review.locator('summary').click();
  await expect(review.getByTestId('company-profile-node-review-1')).toContainText('解放済み');
  const next = review.getByTestId('company-profile-node-review-2');
  await expect(next).toContainText('ポイント不足');
  await expect(next).toContainText('必要 3ポイント、あと1ポイント');
  await expect(next).toContainText('前提 レビュー容量増強（達成）');
  await expect(profile.getByTestId('company-profile-members')).toContainText(
    '検証 さくら · シニア Lv.7',
  );
  await profile.locator('summary').filter({ hasText: '導入済みカード' }).click();
  await expect(
    profile.getByText('このデッキから手札が配られます。', { exact: false }),
  ).toBeVisible();
  await expect(profile.getByText('Copilot全員配布', { exact: true })).toBeVisible();
  await profile.locator('summary').filter({ hasText: '所持レリック' }).click();
  await expect(profile.getByText('小さく出す文化', { exact: true })).toBeVisible();

  await page.getByTestId('open-org').click();
  const org = page.getByTestId('org-screen');
  await expect(org.getByTestId('org-onfire')).toHaveText(/^[1-9]\d*$/);
  const teams = await page.evaluate(() => {
    const game = window.game!;
    const before = game.getState().teams.length;
    const after = game.applyOrgLever('recruitDraft').teams.length;
    return { before, after };
  });
  expect(teams.after).toBe(teams.before + 1);
  const orgProfile = org.getByTestId('company-profile');
  await orgProfile.getByTestId('company-profile-summary').click();
  await expect(orgProfile.getByTestId('company-profile-members')).toContainText(
    '検証 さくら · シニア Lv.7',
  );
  await expect(orgProfile.getByTestId('company-profile-members').locator('li')).toHaveCount(3);
  await expect(org.getByTestId('org-onfire')).toHaveText(/^[1-9]\d*$/);
});

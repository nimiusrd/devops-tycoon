import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import type { GameHandle } from '../../src/game';
import type { RunState } from '../../src/sim/run/types';

type GameWindow = Window & { game?: GameHandle };

async function keyboardFocus(page: Page, button: Locator) {
  await button.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(button).toBeFocused();
  await expect(button).toBeInViewport();
  const ring = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    let parent = element.parentElement;
    let background = '';
    while (parent) {
      background = getComputedStyle(parent).backgroundColor;
      if (/^rgb\(/.test(background)) break;
      parent = parent.parentElement;
    }
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
    const foreground = luminance(style.outlineColor);
    const surface = luminance(background);
    return {
      visible: element.matches(':focus-visible'),
      width: parseFloat(style.outlineWidth),
      style: style.outlineStyle,
      contrast: (Math.max(foreground, surface) + 0.05) / (Math.min(foreground, surface) + 0.05),
    };
  });
  expect(ring.visible).toBe(true);
  expect(ring.width).toBeGreaterThanOrEqual(2);
  expect(ring.style).toBe('solid');
  expect(ring.contrast).toBeGreaterThanOrEqual(3);
}

const viewports = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'desktop-short', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
];

for (const viewport of viewports) {
  test(`会社の案内は読んで閉じても操作できる: ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({
      reducedMotion: viewport.name === 'phone-se' ? 'reduce' : 'no-preference',
    });
    await page.goto('/?seed=company-guidance-e2e');
    await page.getByTestId('difficulty-easy').click();
    await page.getByTestId('start-run').click();
    await page.evaluate(() => (window as GameWindow).game!.pause());
    await expect(page.getByTestId('setup-observation')).toHaveCount(0);
    await page.getByTestId('assign-m2-coding').click();
    await expect(page.getByTestId('setup-observation-review-staff')).toContainText(
      'Review担当 0人',
    );
    await expect(page.getByTestId('setup-observation').getByRole('status')).toHaveAttribute(
      'aria-live',
      'polite',
    );
    await keyboardFocus(page, page.getByTestId('setup-observation-dismiss'));
    await page.screenshot({ path: testInfo.outputPath('setup-observation.png'), fullPage: true });
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('setup-observation')).toHaveCount(0);
    await expect(page.getByTestId('begin-sprint')).toBeFocused();
    await page.getByTestId('assign-m2-review').click();
    await page.getByTestId('assign-m2-coding').click();
    await expect(page.getByTestId('setup-observation')).toHaveCount(0);
    await expect(page.getByTestId('begin-sprint')).toBeEnabled();

    // 代表2カード・予算不足・配置対象なしを同じ固定条件で表示する。
    // 既存 E2E と同じ、画面状態だけを切り替える検証用経路。
    const deckBefore = await page.evaluate(() => {
      const game = (window as GameWindow).game!;
      const engine = (game as unknown as { engine: RunState }).engine;
      engine.phase = 'draft';
      engine.draft = ['copilot', 'auto-test', 'docs'];
      engine.budget = 0;
      engine.roster.members.forEach((m) => {
        m.assignment = 'bench';
      });
      game.playCard(-1);
      return game.getState().deck;
    });
    await expect(page.getByTestId('draft')).toBeVisible();
    const explanation = page.getByTestId('card-company-guidance-auto-test');
    await expect(explanation).toContainText('配置対象なし');
    await expect(explanation).toContainText('予算不足');
    await page.screenshot({
      path: testInfo.outputPath('draft-company-guidance.png'),
      fullPage: true,
    });
    await explanation.click();
    expect(await page.evaluate(() => (window as GameWindow).game!.getState().deck)).toEqual(
      deckBefore,
    );
    await expect(page.getByTestId('draft')).toBeVisible();
    await expect(page.getByTestId('card-company-guidance-docs')).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const pick = page.getByTestId('draft-card-auto-test');
    await expect(pick).toHaveAccessibleName('自動テスト強化: この施策を取得');
    await pick.scrollIntoViewIfNeeded();
    await expect(pick).toBeInViewport();
    expect((await pick.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await keyboardFocus(page, pick);
    await page.screenshot({ path: testInfo.outputPath('draft-focus.png'), fullPage: true });
    await page.keyboard.press('Space');
    await expect(page.getByTestId('draft')).toHaveCount(0);
    const deckAfter = await page.evaluate(() => (window as GameWindow).game!.getState().deck);
    expect(deckAfter).toHaveLength(deckBefore.length + 1);
    expect(deckAfter.at(-1)?.defId).toBe('auto-test');
  });
}

test('案内を閉じたチームから別チームへ入ると、そのチームの予兆を表示する', async ({ page }) => {
  await page.goto('/?seed=company-guidance-teams');
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  await page.evaluate(() => (window as GameWindow).game!.pause());
  await page.getByTestId('assign-m2-coding').click();
  await page.getByTestId('setup-observation-dismiss').click();
  const before = await page.evaluate(() => {
    const game = (window as GameWindow).game!;
    game.zoomTo('company');
    const state = game.getState();
    const other = state.orgScale?.departments
      .flatMap((dept) => dept.teams)
      .find((team) => team.id !== state.activeTeamId);
    if (!other) throw new Error('切替対象のチームが無い');
    game.enterTeam(other.id);
    return {
      quarter: state.quarterNumber,
      sprint: state.sprintIndexInQuarter,
      team: state.activeTeamId,
    };
  });
  const after = await page.evaluate(() => (window as GameWindow).game!.getState());
  expect(after.activeTeamId).not.toBe(before.team);
  expect(after.quarterNumber).toBe(before.quarter);
  expect(after.sprintIndexInQuarter).toBe(before.sprint);
  for (const member of after.roster.members.filter((m) => !m.onLeave)) {
    await page.getByTestId(`assign-${member.id}-coding`).click();
  }
  await expect(page.getByTestId('setup-observation-review-staff')).toBeVisible();
});

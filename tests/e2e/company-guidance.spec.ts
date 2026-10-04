import { expect, test } from './fixtures';
import type { GameHandle } from '../../src/game';
import type { RunState } from '../../src/sim/run/types';

type GameWindow = Window & { game?: GameHandle };

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
    await page.screenshot({ path: testInfo.outputPath('setup-observation.png'), fullPage: true });
    await page.getByTestId('setup-observation-dismiss').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('setup-observation')).toHaveCount(0);
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
    await pick.scrollIntoViewIfNeeded();
    await expect(pick).toBeInViewport();
    expect((await pick.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await pick.focus();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('draft')).toHaveCount(0);
    const deckAfter = await page.evaluate(() => (window as GameWindow).game!.getState().deck);
    expect(deckAfter).toHaveLength(deckBefore.length + 1);
    expect(deckAfter.at(-1)?.defId).toBe('auto-test');
  });
}

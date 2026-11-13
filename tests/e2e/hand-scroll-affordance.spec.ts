/**
 * 390px で手札横スクロールの手がかり（ぞき・端フェード・snap）を確認する（#1010）。
 */
import { expect, test } from './fixtures';
import { VISUAL_TOKENS } from '../../src/render/visualTokens';

test.describe('390px 手札横スクロールの手がかり（#1010）', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/?seed=hand-scroll-1010&renderer=pixi');
    await expect(page.getByTestId('title')).toBeVisible();
    await page.evaluate(() => {
      const game = window.game;
      if (!game) throw new Error('window.game がない');
      game.startRun('easy', [], 'hand-scroll-1010');
      game.pause();
      game.engine.deck.push(
        { defId: 'docs', level: 1 },
        { defId: 'copilot', level: 1 },
        { defId: 'docs', level: 2 },
        { defId: 'copilot', level: 2 },
        { defId: 'docs', level: 3 },
        { defId: 'copilot', level: 3 },
      );
      game.beginSetupSprint();
      game.pause();
      game.engine.sprint!.focus = 5;
      game.playCard(-1);
    });
    await expect(page.getByTestId('deck')).toHaveAttribute('data-mode', 'hand');
    await page.evaluate(() => {
      const layout = document.querySelector('[data-testid="sprint-layout"]') as HTMLElement | null;
      if (layout) layout.scrollTop = 0;
      window.scrollTo(0, 0);
    });
  });

  test('次カードが24px以上ぞき、端フェードと scroll-snap が有効', async ({ page }) => {
    const deck = page.getByTestId('deck');
    await expect(deck).toHaveAttribute('data-mode', 'hand');
    const host = deck.locator('.scroll-overflow-host');
    const scroller = deck.locator('.deckbar-cards');
    const cards = scroller.locator('.card');
    await expect(cards).toHaveCount(3);

    const metrics = await scroller.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      scrollSnapType: getComputedStyle(element).scrollSnapType,
    }));
    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
    expect(metrics.scrollSnapType).toBe('x mandatory');

    await expect(host).toHaveAttribute('data-scroll-overflow', 'x');
    await expect(host).toHaveAttribute('data-scroll-overflow-start', 'true');
    await expect(host).toHaveAttribute('data-scroll-overflow-end', 'false');

    const peekPx = await scroller.evaluate((element) => {
      const scrollerBox = element.getBoundingClientRect();
      const second = element.querySelector<HTMLElement>('.card:nth-child(2)');
      if (!second) return 0;
      const cardBox = second.getBoundingClientRect();
      const visibleRight = Math.min(cardBox.right, scrollerBox.right);
      const visibleLeft = Math.max(cardBox.left, scrollerBox.left);
      return Math.max(0, visibleRight - visibleLeft);
    });
    expect(peekPx).toBeGreaterThanOrEqual(VISUAL_TOKENS.dimensions.scrollOverflow.peekPx);

    const fadeOpacity = await host.evaluate(
      (element) => getComputedStyle(element, '::after').opacity,
    );
    expect(Number.parseFloat(fadeOpacity)).toBeGreaterThan(0);

    await scroller.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    await expect(host).toHaveAttribute('data-scroll-overflow-end', 'true');
    await expect(host).toHaveAttribute('data-scroll-overflow-start', 'false');

    const snapAlign = await cards
      .nth(1)
      .evaluate((element) => getComputedStyle(element).scrollSnapAlign);
    expect(snapAlign).toBe('start');

    await cards.nth(1).evaluate((element) => {
      element.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'start' });
    });
    const snapped = await scroller.evaluate((element) => {
      const card = element.querySelector<HTMLElement>('.card:nth-child(2)');
      if (!card) return null;
      return Math.abs(element.scrollLeft - card.offsetLeft);
    });
    expect(snapped ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(4);
  });
});

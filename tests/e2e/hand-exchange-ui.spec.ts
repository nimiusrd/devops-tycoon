/** RI-186: 狭幅の手札交換 UI と利用不可理由の表示を確認する。 */
import { expect, test } from './fixtures';
import type { GameHandle } from '../../src/game';

type ExchangeGame = GameHandle & {
  engine: {
    deck: Array<{ defId: string; level: number }>;
    sprint: { focus: number; cardPiles: { drawOrder: number[] } } | null;
  };
};

type ExchangeGameWindow = Window & { game?: ExchangeGame };

for (const viewport of [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test(`${viewport.name} で手札交換モードと利用不可理由に到達できる`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/?seed=ri186-hand-exchange-ui');
    await expect(page.getByTestId('title')).toBeVisible();

    await page.evaluate(() => {
      const game = (window as ExchangeGameWindow).game;
      if (!game) throw new Error('window.game が公開されていない');
      game.startRun('easy', [], 'ri186-hand-exchange-ui');
      game.engine.deck.push(
        { defId: 'docs', level: 1 },
        { defId: 'copilot', level: 1 },
        { defId: 'market', level: 1 },
        { defId: 'docs', level: 2 },
        { defId: 'copilot', level: 2 },
        { defId: 'market', level: 2 },
      );
      game.beginSetupSprint();
      if (!game.engine.sprint) throw new Error('スプリントが開始されていない');
      game.engine.sprint.focus = 5;
      game.playCard(-1);
    });

    const deck = page.getByTestId('deck');
    await expect(deck).toHaveAttribute('data-mode', 'hand');
    const cards = deck.locator('.deckbar-cards');
    const handCards = cards.locator('[data-testid^="hand-card-"]');
    await expect(handCards).toHaveCount(3);
    await expect(page.getByTestId('hand-exchange-toggle')).toBeEnabled();

    const toggle = page.getByTestId('hand-exchange-toggle');
    await toggle.click();
    await expect(deck).toHaveAttribute('data-exchange-mode', 'true');
    await expect(cards.locator('.card-action-mode')).toHaveCount(3);
    await expect(cards.locator('.card-action-mode').first()).toHaveText('交換');
    await expect(toggle).toHaveText('やめる');

    const cardsBox = await cards.boundingBox();
    const viewportCards = await cards.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(cardsBox, '手札のスクロール領域が見つからない').not.toBeNull();
    expect(viewportCards.clientWidth).toBeGreaterThan(0);
    expect(viewportCards.scrollWidth).toBeGreaterThan(viewportCards.clientWidth);

    for (let index = 0; index < (await handCards.count()); index += 1) {
      const card = handCards.nth(index);
      await card.scrollIntoViewIfNeeded();
      const cardBox = await card.boundingBox();
      const scrollerBox = await cards.boundingBox();
      if (!cardBox || !scrollerBox) throw new Error('手札カードの領域が取得できない');
      expect(cardBox.x).toBeGreaterThanOrEqual(scrollerBox.x - 1);
      expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(scrollerBox.x + scrollerBox.width + 1);
      await expect(card).toBeEnabled();
      await card.click({ trial: true });
    }

    const toggleBox = await toggle.boundingBox();
    expect(toggleBox, '交換ボタンの領域が取得できない').not.toBeNull();
    expect(toggleBox!.x + toggleBox!.width).toBeLessThanOrEqual(viewport.width + 1);
    await toggle.click();

    await page.evaluate(() => {
      const game = (window as ExchangeGameWindow).game;
      if (!game?.engine.sprint) throw new Error('スプリントが開始されていない');
      game.engine.sprint.cardPiles.drawOrder = [];
      game.playCard(-1);
    });

    await expect(toggle).toBeDisabled();
    const status = page.getByTestId('hand-exchange-status');
    await expect(status).toHaveAttribute('role', 'status');
    await expect(status).toHaveText('交換不可: 山札に交換できるカードがありません');
    await expect(status).toBeVisible();
    const statusLayout = await status.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      whiteSpace: getComputedStyle(element).whiteSpace,
    }));
    expect(statusLayout.whiteSpace).toBe('nowrap');
    expect(statusLayout.scrollWidth).toBeLessThanOrEqual(statusLayout.clientWidth + 1);
  });
}

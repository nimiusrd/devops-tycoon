/** RI-186: 狭幅の手札交換 UI と利用不可理由の表示を確認する。 */
import { expect, test, type Page } from './fixtures';
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

async function openHand(page: Page) {
  await page.goto('/?seed=hand-layout');
  await expect(page.getByTestId('title')).toBeVisible();
  await page.evaluate(() => {
    const game = (window as ExchangeGameWindow).game;
    if (!game) throw new Error('window.game が公開されていない');
    game.startRun('easy', [], 'devops-tycoon');
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
    if (!game.engine.sprint) throw new Error('スプリントが開始されていない');
    game.engine.sprint.focus = 5;
    game.playCard(-1);
  });
  await expect(page.getByTestId('board')).toHaveAttribute('data-effect-renderer', 'pixi');
  await expect(page.getByTestId('webgl-status')).toHaveCount(0);
  await expect(page.getByTestId('deck').locator('.card')).toHaveCount(3);
}

/** 操作時の自動スクロールを除き、フロー内でのカード位置とバーの寸法を測る。 */
async function handLayout(page: Page) {
  await page.mouse.move(0, 0);
  return page.getByTestId('deck').evaluate((deck) => {
    const root = deck.closest('[data-testid="sprint-layout"]');
    const rect = deck.getBoundingClientRect();
    return {
      height: rect.height,
      width: rect.width,
      cards: [...deck.querySelectorAll('.card')].map((card) => {
        const box = card.getBoundingClientRect();
        return { x: box.x, y: box.y + (root?.scrollTop ?? 0), height: box.height };
      }),
    };
  });
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  test(`${viewport.width}px: 交換・集中力不足・停止で手札の位置と高さが変わらない（#887）`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openHand(page);
    const deck = page.getByTestId('deck');
    const toggle = page.getByTestId('hand-exchange-toggle');
    await deck.scrollIntoViewIfNeeded();
    const initial = await handLayout(page);
    const assertStable = async () => {
      await expect.poll(() => handLayout(page)).toEqual(initial);
    };

    await toggle.click();
    await expect(deck).toHaveAttribute('data-exchange-mode', 'true');
    await assertStable();
    for (const [selector, minimum] of [
      ['.card-action-mode', 11],
      ['.card-cost-exchange', 12],
      ['.deckbar-exchange-status', 12],
    ] as const) {
      const size = await deck
        .locator(selector)
        .first()
        .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
      expect(size).toBeGreaterThanOrEqual(minimum);
    }
    await toggle.click();
    await expect(deck).toHaveAttribute('data-exchange-mode', 'false');
    await assertStable();

    await page.getByTestId('speed-pause').click();
    await expect(deck).toHaveAttribute('data-paused', 'true');
    await assertStable();
    await page.getByTestId('speed-1x').click();
    await expect(deck).toHaveAttribute('data-paused', 'false');
    await assertStable();

    for (let count = 1; count <= 2; count += 1) {
      await toggle.click();
      await deck.locator('.card').first().click();
      await expect(page.getByTestId('hand-exchange-count')).toHaveText(`交換 ${count}/2`);
      await assertStable();
    }
    await expect(toggle).toBeDisabled();
    await expect(page.getByTestId('hand-exchange-status')).toContainText('交換上限');

    await page.evaluate(() => {
      const game = (window as ExchangeGameWindow).game;
      if (!game?.engine.sprint) throw new Error('スプリントが開始されていない');
      game.engine.sprint.focus = 0;
      game.playCard(-1);
    });
    await expect(deck.locator('.card:disabled')).toHaveCount(3);
    await assertStable();
  });
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`320×568・${reducedMotion}: 開始直後と進行後に手札1枚が全体表示される（#886）`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.emulateMedia({ reducedMotion });
    await openHand(page);
    for (const progress of [false, true]) {
      if (progress) await page.evaluate(() => window.game?.step(3000));
      await expect(page.getByTestId('sprint-layout')).toHaveJSProperty('scrollTop', 0);
      const card = page.getByTestId('deck').locator('.card').first();
      await expect(card).toBeInViewport({ ratio: 1 });
      const board = await page.getByTestId('board').boundingBox();
      expect(board?.width).toBeGreaterThanOrEqual(240);
      expect(board?.height).toBeGreaterThanOrEqual(96);
      await page.screenshot({
        path: testInfo.outputPath(`手札-${progress ? '進行後' : '開始時'}.png`),
      });
    }
  });
}

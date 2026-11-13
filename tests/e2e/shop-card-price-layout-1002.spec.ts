/**
 * ショップカードの価格欄 (#1002)。
 * 価格と発動コストを同じ行グループにし、残高注記はその下へ分離する。
 */
import {
  advanceCurrentSprintToResult,
  beginPublicSprint,
  expect,
  test,
  type Page,
} from './fixtures';

const SHOP_VIEWPORTS = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop-1280', width: 1280, height: 800 },
] as const;

async function openShopAfterFirstSprint(page: Page): Promise<string> {
  await beginPublicSprint(page, { seed: 'qa-seed-1030', difficulty: 'easy' });
  await advanceCurrentSprintToResult(page);
  const cardTestId = await page.evaluate(() => {
    const game = window.game;
    if (!game) throw new Error('window.game が公開されていない');
    let state = game.getState();
    let guard = 0;
    while (state.phase !== 'shop' && guard < 120) {
      guard += 1;
      switch (state.phase) {
        case 'result':
          state = game.acknowledgeResult();
          break;
        case 'draft':
          state = state.draft?.length ? game.chooseCard(state.draft[0]) : game.skipDraft();
          break;
        case 'evolution':
          state = game.finishEvolution();
          break;
        case 'beat':
          state = game.resolveBeat(0);
          break;
        default:
          throw new Error(`ショップへ到達しない: phase=${state.phase}`);
      }
    }
    if (state.phase !== 'shop' || !state.shop?.cards.length) {
      throw new Error('ショップカードが無い');
    }
    const card = state.shop.cards.find((offer) => !offer.bought);
    if (!card) throw new Error('未購入のショップカードが無い');
    return `shop-card-${card.defId}`;
  });
  await expect(page.getByTestId('shop')).toBeVisible();
  return cardTestId;
}

for (const viewport of SHOP_VIEWPORTS) {
  test(`ショップ価格欄は価格と発動を同塊にし残高注記は下 (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const cardTestId = await openShopAfterFirstSprint(page);
    const card = page.getByTestId(cardTestId);
    await expect(card).toBeVisible();
    await expect(card).toContainText('支払後の残高');
    await expect(card).toContainText('発動');

    const layout = await card.evaluate((el) => {
      const cardRect = el.getBoundingClientRect();
      const cost = el.querySelector('.shop-card-cost');
      const priceLine = el.querySelector('.shop-card-price-line');
      const focus = el.querySelector('.shop-card-focus-cost');
      const note = el.querySelector('.spend-risk-note');
      if (!cost || !priceLine || !focus) throw new Error('価格欄の構造が不正');
      const costRect = cost.getBoundingClientRect();
      const priceRect = priceLine.getBoundingClientRect();
      const focusRect = focus.getBoundingClientRect();
      const noteRect = note?.getBoundingClientRect();
      const priceLineText = priceLine.textContent ?? '';
      const lines = (cost.textContent ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      return {
        focusInsidePriceLine: priceLine.contains(focus),
        noteOutsidePriceLine: !note || !priceLine.contains(note),
        noteBelowPriceLine: !noteRect || noteRect.top >= priceRect.bottom - 1,
        priceLineHasBoth: priceLineText.includes('💰') && priceLineText.includes('発動'),
        noLeadingSlashLine: lines.every((line) => !line.startsWith('/')),
        costAlignedRight: Math.abs(costRect.right - cardRect.right) <= 16,
        focusNotBelowNote: !noteRect || focusRect.top <= noteRect.top + 1,
      };
    });

    expect(layout.focusInsidePriceLine).toBe(true);
    expect(layout.noteOutsidePriceLine).toBe(true);
    expect(layout.noteBelowPriceLine).toBe(true);
    expect(layout.priceLineHasBoth).toBe(true);
    expect(layout.noLeadingSlashLine).toBe(true);
    expect(layout.costAlignedRight).toBe(true);
    expect(layout.focusNotBelowNote).toBe(true);
  });
}

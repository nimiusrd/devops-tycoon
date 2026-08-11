import { describe, expect, it } from 'vitest';
import { RECRUIT_COST } from '../../../src/sim/member/roster';
import { RunEngine, SHOP_RELIC_COST } from '../../../src/sim/run/engine';
import {
  buyShopItems,
  POLICY_DEFS,
  shopCardDeliveryScore,
  shopRelicDeliveryScore,
} from '../../playtest/harness';

describe('harness RI-78 ショップ出荷価値買い', () => {
  it('skilledShopBuy / skilledShopCtl は preferDelivery でカード発動を揃える', () => {
    expect(POLICY_DEFS.skilledShopBuy.cards).toBe('preferDelivery');
    expect(POLICY_DEFS.skilledShopCtl.cards).toBe('preferDelivery');
    expect(POLICY_DEFS.skilledShopBuy.shop).toBe('buy');
    expect(POLICY_DEFS.skilledShopCtl.shop).toBeUndefined();
  });

  it('減速カードより加速カードのスコアが高く、費用対効果で並ぶ', () => {
    // copilot: coding+15% / cost 1 → 正
    // docs: coding-8% / cost 15 → 負
    expect(shopCardDeliveryScore('copilot', 1)).toBeGreaterThan(shopCardDeliveryScore('docs', 15));
    expect(shopCardDeliveryScore('copilot', 1)).toBeGreaterThan(0);
    expect(shopCardDeliveryScore('docs', 15)).toBeLessThan(0);
  });

  it('出荷寄与レリックは士気専用より高得点になる', () => {
    const flow = shopRelicDeliveryScore('flow-first', SHOP_RELIC_COST);
    const psych = shopRelicDeliveryScore('psych-safety', SHOP_RELIC_COST);
    expect(flow).toBeGreaterThan(psych);
    expect(flow).toBeGreaterThan(0);
  });

  it('skilledShopBuy は減速カードより加速カードを先に買う', () => {
    const engine = new RunEngine({ seed: 'ri78-shop-delivery-order', difficulty: 'normal' });
    engine.startRun();
    const internals = engine as unknown as {
      phase: string;
      budget: number;
      deck: Array<{ defId: string; level: number }>;
      relics: string[];
      shop: {
        cards: Array<{ defId: string; cost: number; bought: boolean }>;
        relic: { id: string; cost: number; bought: boolean } | null;
        recruit: { cost: number; bought: boolean } | null;
      } | null;
    };
    internals.phase = 'shop';
    // 加速カード1枚分だけ買える予算（レリックや減速カードを先に買うと加速を逃す）。
    internals.budget = 10 + 1; // SHOP_BUDGET_FLOOR(10) + copilot(1)
    internals.deck = [];
    internals.relics = [];
    internals.shop = {
      cards: [
        { defId: 'docs', cost: 8, bought: false },
        { defId: 'copilot', cost: 1, bought: false },
      ],
      relic: { id: 'psych-safety', cost: SHOP_RELIC_COST, bought: false },
      recruit: { cost: RECRUIT_COST, bought: false },
    };

    buyShopItems(engine, POLICY_DEFS.skilledShopBuy);

    const s = engine.snapshot();
    expect(s.deck.some((c) => c.defId === 'copilot')).toBe(true);
    expect(s.deck.some((c) => c.defId === 'docs')).toBe(false);
    expect(s.relics).not.toContain('psych-safety');
    expect(s.shop?.cards.find((c) => c.defId === 'copilot')?.bought).toBe(true);
    expect(s.shop?.cards.find((c) => c.defId === 'docs')?.bought).toBe(false);
    expect(s.shop?.relic?.bought).toBe(false);
  });

  it('skilledShopBuy はコーディング加速のないレリックを買わない', () => {
    const engine = new RunEngine({ seed: 'ri78-shop-relic-skip', difficulty: 'normal' });
    engine.startRun();
    const internals = engine as unknown as {
      phase: string;
      budget: number;
      deck: Array<{ defId: string; level: number }>;
      relics: string[];
      shop: {
        cards: Array<{ defId: string; cost: number; bought: boolean }>;
        relic: { id: string; cost: number; bought: boolean } | null;
        recruit: { cost: number; bought: boolean } | null;
      } | null;
    };
    internals.phase = 'shop';
    internals.budget = SHOP_RELIC_COST + 10;
    internals.deck = [];
    internals.relics = [];
    internals.shop = {
      cards: [{ defId: 'docs', cost: 15, bought: false }],
      relic: { id: 'flow-first', cost: SHOP_RELIC_COST, bought: false },
      recruit: { cost: RECRUIT_COST, bought: false },
    };

    buyShopItems(engine, POLICY_DEFS.skilledShopBuy);

    const s = engine.snapshot();
    expect(s.relics).not.toContain('flow-first');
    expect(s.deck).toEqual([]);
  });

  it('skilledShopBuy は正スコアの最良1点だけ買い、減速カードと非加速レリックは買わない', () => {
    const engine = new RunEngine({ seed: 'ri78-shop-single-best', difficulty: 'normal' });
    engine.startRun();
    const internals = engine as unknown as {
      phase: string;
      budget: number;
      deck: Array<{ defId: string; level: number }>;
      relics: string[];
      shop: {
        cards: Array<{ defId: string; cost: number; bought: boolean }>;
        relic: { id: string; cost: number; bought: boolean } | null;
        recruit: { cost: number; bought: boolean } | null;
      } | null;
    };
    internals.phase = 'shop';
    internals.budget = 100;
    internals.deck = [];
    internals.relics = [];
    internals.shop = {
      cards: [
        { defId: 'copilot', cost: 1, bought: false },
        { defId: 'feature-flags', cost: 1, bought: false },
        { defId: 'docs', cost: 15, bought: false },
      ],
      relic: { id: 'psych-safety', cost: SHOP_RELIC_COST, bought: false },
      recruit: { cost: RECRUIT_COST, bought: false },
    };

    buyShopItems(engine, POLICY_DEFS.skilledShopBuy);

    const s = engine.snapshot();
    const boughtCards = s.deck.map((c) => c.defId);
    expect(boughtCards).toEqual(['copilot']);
    expect(s.relics).toEqual([]);
    expect(s.shop?.relic?.bought).toBe(false);
  });
});

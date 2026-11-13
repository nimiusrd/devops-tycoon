import { describe, expect, it } from 'vitest';
import { EVENT_DEFS } from '../../../src/data/events';
import { SHOP_OFFER_SURPLUS_PROMPT, shopOfferBeatPrompt } from '../../../src/render/shopOfferView';
import type { RunState, ShopOffer } from '../../../src/sim/run/types';
import { createInitialRoster } from '../../../src/sim/member';
import { createRng } from '../../../src/sim/rng';

const shopOffer = EVENT_DEFS.find((event) => event.id === 'shop-offer')!;

function baseState(shop: ShopOffer, budget: number): RunState {
  return {
    budget,
    roster: createInitialRoster(createRng('shop-offer-view')),
    relics: [],
    shop,
  } as RunState;
}

const unaffordableShop: ShopOffer = {
  cards: [
    { defId: 'docs', cost: 12, bought: false },
    { defId: 'auto-test', cost: 14, bought: false },
  ],
  relic: { id: 'postmortem', cost: 12, bought: false },
  recruit: { cost: 25, bought: false },
};

describe('shopOfferBeatPrompt (#1018)', () => {
  it('💰3 で買える品がないときは「余裕がある」を出さない', () => {
    const prompt = shopOfferBeatPrompt(shopOffer, baseState(unaffordableShop, 3));
    expect(prompt).not.toContain('余裕がある');
    expect(prompt).toContain('買える品がない');
  });

  it('買える品があるときは従来どおり「余裕がある」', () => {
    const affordableShop: ShopOffer = {
      ...unaffordableShop,
      cards: [{ defId: 'pr-size-limit', cost: 6, bought: false }],
    };
    const prompt = shopOfferBeatPrompt(shopOffer, baseState(affordableShop, 100));
    expect(prompt).toBe(SHOP_OFFER_SURPLUS_PROMPT);
    expect(prompt).toContain('余裕がある');
  });
});

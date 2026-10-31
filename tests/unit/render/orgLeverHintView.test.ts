import { describe, expect, it } from 'vitest';
import { EVENT_DEFS } from '../../../src/data/events';
import { LEVER_DEFS } from '../../../src/data/levers';
import {
  MIN_ORG_LEVER_BUDGET,
  isShopOfferPresent,
  shouldShowOrgLeverHint,
  type OrgLeverHintDecisionInput,
} from '../../../src/render/orgLeverHintView';
import type { RunState } from '../../../src/sim/run/types';

const shopEventId = EVENT_DEFS.find((event) =>
  event.choices.some((choice) => choice.leadsTo === 'shop'),
)?.id;

function decision(overrides: Partial<OrgLeverHintDecisionInput> = {}): OrgLeverHintDecisionInput {
  return {
    quarterNumber: 1,
    budget: MIN_ORG_LEVER_BUDGET,
    shopArrived: false,
    dismissed: false,
    readOnly: false,
    ...overrides,
  };
}

function presence(
  overrides: Partial<Pick<RunState, 'phase' | 'beat' | 'shop'>> = {},
): Pick<RunState, 'phase' | 'beat' | 'shop'> {
  return {
    phase: 'setup',
    beat: null,
    shop: null,
    ...overrides,
  };
}

describe('組織レバーの予算案内', () => {
  it('最安レバーの定義を境界にし、それ未満や別条件では出さない', () => {
    expect(shopEventId).toBe('shop-offer');
    expect(MIN_ORG_LEVER_BUDGET).toBe(Math.min(...LEVER_DEFS.map((lever) => lever.cost)));
    expect(MIN_ORG_LEVER_BUDGET).toBeGreaterThan(0);
    expect(shouldShowOrgLeverHint(decision())).toBe(true);
    expect(shouldShowOrgLeverHint(decision({ budget: MIN_ORG_LEVER_BUDGET - 1 }))).toBe(false);
    expect(shouldShowOrgLeverHint(decision({ quarterNumber: 2 }))).toBe(false);
    expect(shouldShowOrgLeverHint(decision({ shopArrived: true }))).toBe(false);
    expect(shouldShowOrgLeverHint(decision({ dismissed: true }))).toBe(false);
    expect(shouldShowOrgLeverHint(decision({ readOnly: true }))).toBe(false);
  });

  it('ショップ抽選の到来はショップへ進むイベントとショップ画面だけを見る', () => {
    expect(isShopOfferPresent(presence())).toBe(false);
    expect(
      isShopOfferPresent(
        presence({
          phase: 'beat',
          beat: { eventId: 'rest-offer', kind: 'decision' },
        }),
      ),
    ).toBe(false);
    expect(
      isShopOfferPresent(
        presence({
          phase: 'beat',
          beat: { eventId: shopEventId!, kind: 'decision' },
        }),
      ),
    ).toBe(true);
    expect(isShopOfferPresent(presence({ phase: 'shop' }))).toBe(true);
    expect(
      isShopOfferPresent(
        presence({
          shop: { cards: [], recruit: { cost: 25, bought: false } },
        }),
      ),
    ).toBe(true);
  });
});

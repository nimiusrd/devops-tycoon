import { describe, expect, it } from 'vitest';
import { LEVER_DEFS } from '../../../src/data/levers';
import {
  MIN_ORG_LEVER_BUDGET,
  shouldShowOrgLeverHint,
  type OrgLeverHintDecisionInput,
} from '../../../src/render/orgLeverHintView';

function decision(overrides: Partial<OrgLeverHintDecisionInput> = {}): OrgLeverHintDecisionInput {
  return {
    quarterNumber: 1,
    budget: MIN_ORG_LEVER_BUDGET,
    dismissed: false,
    readOnly: false,
    ...overrides,
  };
}

describe('組織レバーの予算案内', () => {
  it('最安レバーの定義を境界にし、それ未満や別条件では出さない', () => {
    expect(MIN_ORG_LEVER_BUDGET).toBe(Math.min(...LEVER_DEFS.map((lever) => lever.cost)));
    expect(MIN_ORG_LEVER_BUDGET).toBeGreaterThan(0);
    expect(shouldShowOrgLeverHint(decision())).toBe(true);
    expect(shouldShowOrgLeverHint(decision({ budget: MIN_ORG_LEVER_BUDGET - 1 }))).toBe(false);
    expect(shouldShowOrgLeverHint(decision({ budget: 0 }))).toBe(false);
    expect(shouldShowOrgLeverHint(decision({ quarterNumber: 2 }))).toBe(false);
    expect(shouldShowOrgLeverHint(decision({ dismissed: true }))).toBe(false);
    expect(shouldShowOrgLeverHint(decision({ readOnly: true }))).toBe(false);
  });

  it('開封か予算0で消したあとは、予算が戻っても同じ条件では出さない', () => {
    expect(
      shouldShowOrgLeverHint(
        decision({ dismissed: true, budget: MIN_ORG_LEVER_BUDGET + 40, quarterNumber: 1 }),
      ),
    ).toBe(false);
    expect(
      shouldShowOrgLeverHint(decision({ dismissed: false, budget: MIN_ORG_LEVER_BUDGET })),
    ).toBe(true);
  });
});

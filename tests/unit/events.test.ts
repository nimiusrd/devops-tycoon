import { describe, expect, it } from 'vitest';
import type { EventDef } from '../../src/data/events';
import { createOrgState } from '../../src/sim/org';
import { TECH_DEBT_CAP } from '../../src/sim/outcome';
import {
  applyEventOutcome,
  effectiveEventWeight,
  eventEligible,
  eventSignals,
  pickWeighted,
} from '../../src/sim/run/events';
import type { EventSignal, RunPassives } from '../../src/sim/run/types';
import type { OrgState } from '../../src/sim/types';

const org = (o: Partial<OrgState> = {}): OrgState => ({ ...createOrgState('default', true), ...o });

const passives = (moraleDamageMul = 1): RunPassives => ({
  moraleDamageMul,
  restHealBonus: 0,
  shopDiscount: 0,
  relicSlots: 0,
});

const event = (partial: Partial<EventDef>): EventDef => ({
  id: 'test-event',
  title: 'test',
  prompt: 'test',
  tone: 'good',
  choices: [{ label: 'ok', description: 'ok', outcome: {} }],
  ...partial,
});

const signals = (partial: Partial<Record<EventSignal, number>>): Record<EventSignal, number> => ({
  techDebtHigh: 0,
  aiDependencyHigh: 0,
  aiLiteracyLow: 0,
  seniorHpLow: 0,
  moraleLow: 0,
  qualityLow: 0,
  testCoverageHigh: 0,
  documentationHigh: 0,
  ...partial,
});

describe('applyEventOutcome の条件枝', () => {
  it('空 outcome は org を変更せず、返却差分は既定値だけになる', () => {
    const base = org({
      deliveryScore: 11,
      morale: 52,
      seniorHp: 53,
      quality: 54,
      testCoverage: 55,
      aiLiteracy: 56,
      aiDependency: 57,
      techDebt: 58,
    });

    const res = applyEventOutcome({}, base, passives(0.25));

    expect(base).toMatchObject({
      deliveryScore: 11,
      morale: 52,
      seniorHp: 53,
      quality: 54,
      testCoverage: 55,
      aiLiteracy: 56,
      aiDependency: 57,
      techDebt: 58,
    });
    expect(res).toEqual({ budgetDelta: 0, delivered: 0 });
  });

  it('指定された outcome だけを加算し、正の Morale はダメージ軽減しない', () => {
    const base = org({
      deliveryScore: 10,
      morale: 40,
      seniorHp: 41,
      quality: 42,
      testCoverage: 43,
      aiLiteracy: 44,
      aiDependency: 45,
      techDebt: 46,
    });

    const res = applyEventOutcome(
      {
        delivered: 7,
        morale: 8,
        seniorHp: 9,
        quality: 10,
        testCoverage: 11,
        aiLiteracy: 12,
        aiDependency: 13,
        techDebt: 14,
        budget: -15,
        grantCard: 'ai-guideline',
        grantRelic: 'small-pr',
        grantRecruit: true,
        trust: { team: -3 },
        forceLose: 'reviewFreeze',
        nextSprint: { reviewLoadAdd: 2 },
      },
      base,
      passives(0.25),
    );

    expect(base).toMatchObject({
      deliveryScore: 17,
      morale: 48,
      seniorHp: 50,
      quality: 52,
      testCoverage: 54,
      aiLiteracy: 56,
      aiDependency: 58,
      techDebt: 60,
    });
    expect(res).toEqual({
      budgetDelta: -15,
      grantRelic: 'small-pr',
      grantCard: 'ai-guideline',
      grantRecruit: true,
      delivered: 7,
      trust: { team: -3 },
      forceLose: 'reviewFreeze',
      nextSprint: { reviewLoadAdd: 2 },
    });
  });

  it('負の Morale は倍率で軽減し、各 0..100 値と techDebt 下限を clamp する', () => {
    const base = org({
      morale: 5,
      seniorHp: 97,
      quality: 2,
      testCoverage: 99,
      aiLiteracy: 3,
      aiDependency: 98,
      techDebt: 4,
    });

    applyEventOutcome(
      {
        morale: -20,
        seniorHp: 10,
        quality: -10,
        testCoverage: 5,
        aiLiteracy: -10,
        aiDependency: 5,
        techDebt: -9,
      },
      base,
      passives(0.5),
    );

    expect(base).toMatchObject({
      morale: 0,
      seniorHp: 100,
      quality: 0,
      testCoverage: 100,
      aiLiteracy: 0,
      aiDependency: 100,
      techDebt: 0,
    });
  });
});

describe('eventSignals の比率と clamp', () => {
  it('各シグナルを 0..1 の正確な比率へ変換する', () => {
    expect(
      eventSignals(
        org({
          techDebt: TECH_DEBT_CAP / 2,
          aiDependency: 25,
          aiLiteracy: 70,
          seniorHp: 80,
          morale: 65,
          quality: 40,
          testCoverage: 75,
          documentation: 10,
        }),
      ),
    ).toEqual({
      techDebtHigh: 0.5,
      aiDependencyHigh: 0.25,
      aiLiteracyLow: 0.3,
      seniorHpLow: 0.2,
      moraleLow: 0.35,
      qualityLow: 0.6,
      testCoverageHigh: 0.75,
      documentationHigh: 0.1,
    });
  });

  it('範囲外の org 値はシグナル側で 0..1 に丸める', () => {
    expect(
      eventSignals(
        org({
          techDebt: TECH_DEBT_CAP * 2,
          aiDependency: 150,
          aiLiteracy: -20,
          seniorHp: 150,
          morale: -10,
          quality: 140,
          testCoverage: -10,
          documentation: 150,
        }),
      ),
    ).toEqual({
      techDebtHigh: 1,
      aiDependencyHigh: 1,
      aiLiteracyLow: 1,
      seniorHpLow: 0,
      moraleLow: 1,
      qualityLow: 0,
      testCoverageHigh: 0,
      documentationHigh: 1,
    });
  });
});

describe('effectiveEventWeight / pickWeighted の境界', () => {
  it('weight 未指定は 1 とし、trigger の倍率を順に掛ける', () => {
    expect(effectiveEventWeight(event({}), signals({}))).toBe(1);
    expect(
      effectiveEventWeight(
        event({ weight: 2, triggers: { techDebtHigh: 3, moraleLow: 1 } }),
        signals({ techDebtHigh: 0.5, moraleLow: 0.25 }),
      ),
    ).toBe(2 * (1 + 3 * 0.5) * (1 + 1 * 0.25));
  });

  it('空・総重み 0・境界ちょうど・末尾 fallback を区別して選ぶ', () => {
    const first = event({ id: 'first' });
    const second = event({ id: 'second' });
    const third = event({ id: 'third' });

    expect(pickWeighted([], 0.5)).toBeUndefined();
    expect(
      pickWeighted(
        [
          { def: first, weight: 0 },
          { def: second, weight: 0 },
        ],
        0.5,
      ),
    ).toBe(first);
    expect(
      pickWeighted(
        [
          { def: first, weight: 1 },
          { def: second, weight: 2 },
          { def: third, weight: 3 },
        ],
        1 / 6,
      ),
    ).toBe(second);
    expect(
      pickWeighted(
        [
          { def: first, weight: 1 },
          { def: second, weight: 2 },
        ],
        1,
      ),
    ).toBe(second);
  });
});

describe('eventEligible の minSignal 条件', () => {
  it('minSignal 未指定は対象になり、指定時は全条件を下限以上で満たす必要がある', () => {
    expect(eventEligible(event({}), signals({}))).toBe(true);
    expect(
      eventEligible(
        event({ minSignal: { seniorHpLow: 0.55, moraleLow: 0.25 } }),
        signals({ seniorHpLow: 0.55, moraleLow: 0.25 }),
      ),
    ).toBe(true);
    expect(
      eventEligible(
        event({ minSignal: { seniorHpLow: 0.55, moraleLow: 0.25 } }),
        signals({ seniorHpLow: 0.54, moraleLow: 0.99 }),
      ),
    ).toBe(false);
  });
});

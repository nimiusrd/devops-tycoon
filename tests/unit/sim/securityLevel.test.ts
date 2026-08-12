import { describe, expect, it } from 'vitest';
import { getCard } from '../../../src/data/cards';
import { getDifficulty } from '../../../src/data/difficulties';
import { getEvolutionNode } from '../../../src/data/evolution';
import { getRelic } from '../../../src/data/relics';
import { applyDeckBaseline } from '../../../src/sim/cards';
import {
  IDENTITY_CARD_EFFECTS,
  incidentProbability,
  securityCustomerTrustDelta,
  securityIncidentRateBonus,
  securitySpreadMul,
} from '../../../src/sim/model';
import { createOrgState } from '../../../src/sim/org';
import { RunEngine } from '../../../src/sim/run/engine';
import type { OrgState, Task } from '../../../src/sim/types';
import { POLICY_DEFS } from '../../playtest/harness';

function org(securityLevel: number, overrides: Partial<OrgState> = {}): OrgState {
  return {
    aiEnabled: true,
    aiDependency: 30,
    aiLiteracy: 50,
    testCoverage: 50,
    documentation: 40,
    quality: 50,
    securityLevel,
    morale: 70,
    seniorHp: 80,
    techDebt: 0,
    deliveryScore: 0,
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    kind: 'normal',
    progress: 1,
    lane: 'review',
    aiAssisted: false,
    reworkAttempts: 0,
    wasReworked: false,
    highValue: false,
    debt: false,
    incident: false,
    ...overrides,
  };
}

describe('RI-87 セキュリティ軸', () => {
  it('難易度プリセットとシナリオに securityLevel がある', () => {
    expect(getDifficulty('easy').org.securityLevel).toBe(70);
    expect(getDifficulty('normal').org.securityLevel).toBe(60);
    expect(getDifficulty('hard').org.securityLevel).toBe(60);
    expect(getDifficulty('nightmare').org.securityLevel).toBe(55);
    expect(createOrgState('default', true).securityLevel).toBe(60);
  });

  it('securityLevel が低いほど事故率ボーナスと延焼倍率が大きい', () => {
    expect(securityIncidentRateBonus(100)).toBeCloseTo(0);
    expect(securityIncidentRateBonus(50)).toBeCloseTo(0);
    expect(securityIncidentRateBonus(0)).toBeCloseTo(0.05);
    expect(securitySpreadMul(100)).toBeCloseTo(1);
    expect(securitySpreadMul(50)).toBeCloseTo(1);
    expect(securitySpreadMul(0)).toBeCloseTo(1.6);
    expect(securitySpreadMul(20)).toBeGreaterThan(securitySpreadMul(50));
  });

  it('incidentProbability は securityLevel が低いほど高くなる', () => {
    const low = incidentProbability(org(10), task(), IDENTITY_CARD_EFFECTS);
    const high = incidentProbability(org(90), task(), IDENTITY_CARD_EFFECTS);
    expect(low).toBeGreaterThan(high);
  });

  it('顧客信頼ペナルティは延焼と低水準で単調に悪化する', () => {
    expect(securityCustomerTrustDelta(100, 2, 1)).toBe(0);
    expect(securityCustomerTrustDelta(50, 2, 1)).toBe(0);
    expect(securityCustomerTrustDelta(0, 2, 0)).toBe(0);
    const soft = securityCustomerTrustDelta(40, 1, 1);
    const hard = securityCustomerTrustDelta(10, 1, 2);
    expect(hard).toBeLessThan(soft);
    expect(hard).toBeLessThan(0);
  });

  it('applyDeckBaseline が securityAdd を org へ焼き込む', () => {
    const state = org(50);
    applyDeckBaseline(state, { ...IDENTITY_CARD_EFFECTS, securityAdd: 8 });
    expect(state.securityLevel).toBe(58);
    applyDeckBaseline(state, { ...IDENTITY_CARD_EFFECTS, securityAdd: -10 });
    expect(state.securityLevel).toBe(48);
  });

  it('既存カード／レリック／進化に securityAdd が載っている', () => {
    expect(getCard('auto-test')?.base.securityAdd).toBe(8);
    expect(getCard('docs')?.base.securityAdd).toBe(5);
    expect(getCard('static-analysis')?.base.securityAdd).toBe(4);
    expect(getCard('copilot')?.base.securityAdd).toBe(-5);
    expect(getCard('claude-code')?.base.securityAdd).toBe(-4);
    expect(getCard('devin')?.base.securityAdd).toBe(-8);
    expect(getRelic('postmortem')?.effects?.securityAdd).toBe(6);
    expect(getRelic('no-friday-deploy')?.effects?.securityAdd).toBe(4);
    expect(getEvolutionNode('quality-1')?.effects?.securityAdd).toBe(6);
    expect(getEvolutionNode('quality-2')?.effects?.securityAdd).toBe(8);
    expect(getEvolutionNode('quality-3')?.effects?.securityAdd).toBe(10);
    expect(getEvolutionNode('dev-1')?.effects?.securityAdd).toBe(-4);
    expect(getEvolutionNode('dev-3')?.effects?.securityAdd).toBe(-6);
    expect(getEvolutionNode('ai-3')?.effects?.securityAdd).toBe(-6);
  });

  it('スプリントで延焼があると顧客信頼が下がる（低セキュリティほど大きい）', () => {
    const low = new RunEngine({ seed: 'ri87-trust-low', difficulty: 'nightmare' });
    low.startRun();
    const lowBefore = low.snapshot().stakeholderTrust.customers;
    const lowInternals = low as unknown as {
      applyIncidentTrustPenalty: (r: { incidents: number; spread: number }) => void;
      org: OrgState;
    };
    // 直接ペナルティ関数経路を検証（盤面 RNG に依存しない）。
    lowInternals.org.securityLevel = 10;
    lowInternals.applyIncidentTrustPenalty({ incidents: 2, spread: 1 });
    const lowDelta = low.snapshot().stakeholderTrust.customers - lowBefore;

    const high = new RunEngine({ seed: 'ri87-trust-high', difficulty: 'easy' });
    high.startRun();
    const highBefore = high.snapshot().stakeholderTrust.customers;
    const highInternals = high as unknown as {
      applyIncidentTrustPenalty: (r: { incidents: number; spread: number }) => void;
      org: OrgState;
    };
    // Easy 初期 securityLevel を高く保ったまま同じ延焼を適用。
    highInternals.org.securityLevel = 95;
    highInternals.applyIncidentTrustPenalty({ incidents: 2, spread: 1 });
    const highDelta = high.snapshot().stakeholderTrust.customers - highBefore;

    expect(lowDelta).toBeLessThan(highDelta);
    expect(lowDelta).toBeLessThan(0);
  });

  it('playtest に securityNeglect / securityFocus 方針がある', () => {
    expect(POLICY_DEFS.securityNeglect.draft).toBe('securityNeglect');
    expect(POLICY_DEFS.securityNeglect.shop).toBe('buyAvoidSecurity');
    expect(POLICY_DEFS.securityFocus.cards).toBe('preferSecurity');
    expect(POLICY_DEFS.securityFocus.draft).toBe('security');
    expect(POLICY_DEFS.securityFocus.shop).toBe('buySecurity');
    expect(POLICY_DEFS.securityFocus.evolve).toBe('qualityFirst');
  });
});

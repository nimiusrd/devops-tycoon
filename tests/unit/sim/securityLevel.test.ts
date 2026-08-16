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
  securityCustomerTrustFromRaw,
  securityCustomerTrustSpreadRaw,
  securityFragility,
  securityIncidentRateBonus,
  securitySpreadMul,
} from '../../../src/sim/model';
import { createOrgState } from '../../../src/sim/org';
import {
  deriveTeamCapacities,
  projectOrgScale,
  advanceCoarseTeams,
} from '../../../src/sim/orgscale/teamState';
import { emptyAdjustState } from '../../../src/sim/orgscale/levers';
import type { TeamRunState } from '../../../src/sim/orgscale/types';
import { RunEngine } from '../../../src/sim/run/engine';
import type { OrgState, SprintMetrics, Task } from '../../../src/sim/types';
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
    expect(POLICY_DEFS.securityNeglect.evolve).toBe('neglectFirst');
    expect(POLICY_DEFS.securityFocus.cards).toBe('preferSecurity');
    expect(POLICY_DEFS.securityFocus.draft).toBe('security');
    expect(POLICY_DEFS.securityFocus.shop).toBe('buySecurity');
    expect(POLICY_DEFS.securityFocus.evolve).toBe('qualityFirst');
  });

  it('粗粒度の incidentBias はセキュリティが低いほど高い', () => {
    const high = deriveTeamCapacities({
      engineers: 4,
      reviewQueue: 0,
      incidents: 0,
      quality: 50,
      securityLevel: 80,
    });
    const low = deriveTeamCapacities({
      engineers: 4,
      reviewQueue: 0,
      incidents: 0,
      quality: 50,
      securityLevel: 10,
    });
    expect(low.incidentBias).toBeGreaterThan(high.incidentBias);
  });

  it('全社セキュリティ集約は選択中チームのライブ値を使う', () => {
    const team = (id: string, securityLevel: number): TeamRunState => ({
      id,
      deptId: 'product',
      name: id,
      engineers: 4,
      headcount: 4,
      aiLiteracy: 50,
      aiDependency: 30,
      morale: 70,
      techDebt: 10,
      shipping: 0,
      reviewQueue: 0,
      incidents: 0,
      reviewCapacity: 70,
      incidentBias: 0.08,
      seniorHp: 80,
      aiEnabled: true,
      testCoverage: 50,
      documentation: 40,
      quality: 60,
      securityLevel,
    });
    const scale = projectOrgScale({
      seed: 'ri87-live-sec',
      teams: [team('product-t0', 80), team('product-t1', 80)],
      homeTeamId: 'product-t0',
      activeTeamId: 'product-t0',
      activeLive: { securityLevel: 20 },
      diagnosis: 'seniorSacrifice',
      budget: 20,
      infraBase: { ci: 50, docs: 40, aiGuideline: 50 },
      adjust: emptyAdjustState(),
    });
    expect(scale.securityLevel).toBe(50);
  });

  it('旧セーブの securityLevel 補完後に incidentBias を再計算する', () => {
    const e = new RunEngine({ seed: 'ri87-hydrate-bias', difficulty: 'normal' });
    e.startRun();
    const persist = e.exportPersistState()!;
    const other = persist.extras.teams.find((t) => t.id !== persist.extras.activeTeamId)!;
    delete (other as { securityLevel?: number }).securityLevel;
    other.quality = 20;
    other.incidents = 0;
    other.incidentBias = 0.08 + (100 - 20) * 0.002;
    const restored = new RunEngine({ seed: 'ri87-hydrate-bias', difficulty: 'normal' });
    restored.hydratePersistState(persist);
    const team = restored.snapshot().teams.find((t) => t.id === other.id)!;
    expect(team.securityLevel).toBe(20);
    expect(team.incidentBias).toBeCloseTo(
      deriveTeamCapacities({
        engineers: team.engineers,
        reviewQueue: team.reviewQueue,
        incidents: team.incidents,
        quality: team.quality,
        securityLevel: 20,
      }).incidentBias,
      8,
    );
  });

  it('顧客信頼ペナルティは延焼発生時の水準で確定する', () => {
    const e = new RunEngine({ seed: 'ri87-trust-at-spread', difficulty: 'nightmare' });
    e.startRun();
    const before = e.snapshot().stakeholderTrust.customers;
    const internals = e as unknown as {
      applyIncidentTrustPenalty: (r: { incidents: number; spread: number }) => void;
      org: OrgState;
      sprint: { metrics: Partial<SprintMetrics> } | null;
    };
    internals.org.securityLevel = 90;
    internals.sprint = {
      metrics: {
        spread: 1,
        securityTrustSpreadRaw: securityCustomerTrustSpreadRaw(10),
        securityTrustIncidentFragility: securityFragility(10),
      },
    };
    internals.applyIncidentTrustPenalty({ incidents: 2, spread: 1 });
    const atSpread = e.snapshot().stakeholderTrust.customers - before;
    expect(atSpread).toBe(
      securityCustomerTrustFromRaw(
        securityCustomerTrustSpreadRaw(10) + 2 * 0.5 * securityFragility(10),
      ),
    );
    expect(atSpread).toBeLessThan(securityCustomerTrustDelta(90, 2, 1));
  });

  it('粗粒度発火の信頼 raw は発火チームの水準で積む', () => {
    const pressured = (securityLevel: number): TeamRunState => ({
      id: 'pressured',
      deptId: 'platform',
      name: '圧迫',
      engineers: 8,
      headcount: 8,
      aiLiteracy: 40,
      aiDependency: 40,
      morale: 50,
      techDebt: 20,
      shipping: 50,
      reviewQueue: 10,
      incidents: 1,
      reviewCapacity: 10,
      incidentBias: 0.4,
      seniorHp: 60,
      aiEnabled: true,
      testCoverage: 40,
      documentation: 30,
      quality: 50,
      securityLevel,
    });
    const home: TeamRunState = { ...pressured(80), id: 'home', name: 'ホーム' };
    const low = advanceCoarseTeams([home, pressured(0)], {
      seed: 'ri91-b1-byteam',
      stepKey: 'adj',
      excludeId: 'home',
    });
    const high = advanceCoarseTeams([home, pressured(80)], {
      seed: 'ri91-b1-byteam',
      stepKey: 'adj',
      excludeId: 'home',
    });
    expect(low.ignited).toBe(1);
    expect(high.ignited).toBe(1);
    expect(low.securityTrustSpreadRaw).toBeCloseTo(securityCustomerTrustSpreadRaw(0), 8);
    expect(high.securityTrustSpreadRaw).toBeCloseTo(securityCustomerTrustSpreadRaw(80), 8);
    expect(low.securityTrustSpreadRaw).toBeGreaterThan(high.securityTrustSpreadRaw);
  });

  it('粗粒度の信頼 raw はステップ間で繰り越してから確定する', () => {
    const e = new RunEngine({ seed: 'ri87-trust-carry', difficulty: 'normal' });
    e.startRun();
    const before = e.snapshot().stakeholderTrust.customers;
    const internals = e as unknown as {
      applyCoarseSecurityTrust: (raw: number) => void;
      coarseSecurityTrustRaw: number;
    };
    const piece = securityCustomerTrustSpreadRaw(40);
    expect(piece).toBeCloseTo(0.4, 8);
    internals.applyCoarseSecurityTrust(piece);
    expect(e.snapshot().stakeholderTrust.customers).toBe(before);
    expect(internals.coarseSecurityTrustRaw).toBeCloseTo(0.4, 8);
    internals.applyCoarseSecurityTrust(piece);
    expect(e.snapshot().stakeholderTrust.customers).toBe(
      before + securityCustomerTrustFromRaw(0.8),
    );
  });
});

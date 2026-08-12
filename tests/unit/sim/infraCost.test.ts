import { describe, expect, it } from 'vitest';
import { getCard } from '../../../src/data/cards';
import { getRelic } from '../../../src/data/relics';
import { combineEffects, scaleEffects } from '../../../src/sim/cards';
import { IDENTITY_CARD_EFFECTS } from '../../../src/sim/model';
import {
  BASE_INFRA_COST_PER_DEPENDENCY,
  foldRunEffects,
  infraBillingRateForSprint,
} from '../../../src/sim/run/effects';
import { RunEngine } from '../../../src/sim/run/engine';
import {
  applyTrialAiDependencyPressure,
  computeInfraCost,
  previewInfraCost,
} from '../../../src/sim/run/sprintBaselineBuild';
import type { EvolutionState } from '../../../src/sim/run/types';
import type { OrgState } from '../../../src/sim/types';

const emptyEvolution: EvolutionState = { points: 0, unlocked: {} };

function org(aiDependency: number): OrgState {
  return {
    aiEnabled: true,
    aiDependency,
    aiLiteracy: 40,
    testCoverage: 40,
    documentation: 40,
    quality: 50,
    securityLevel: 55,
    morale: 70,
    seniorHp: 80,
    techDebt: 0,
    deliveryScore: 0,
  };
}

const ctx = {
  deck: [] as { defId: string; level: number }[],
  relics: [] as string[],
  evolution: emptyEvolution,
  difficulty: 'normal' as const,
  trials: [] as string[],
};

describe('RI-88 インフラコスト軸', () => {
  it('ベース単価があり、試練は上乗せする（RI-77 でベース引き上げ）', () => {
    expect(BASE_INFRA_COST_PER_DEPENDENCY).toBe(0.22);
    expect(foldRunEffects({ ...ctx }).frontierModelCostPerDependency).toBe(0.22);
    expect(
      foldRunEffects({ ...ctx, trials: ['frontier-dependency'] }).frontierModelCostPerDependency,
    ).toBeCloseTo(0.26);
  });

  it('frontier の毎スプ課金は上乗せだけ、ボスはベース込み（RI-77）', () => {
    const folded = 0.26;
    expect(infraBillingRateForSprint('normal', true, folded)).toBeCloseTo(0.04);
    expect(infraBillingRateForSprint('elite', true, folded)).toBeCloseTo(0.04);
    expect(infraBillingRateForSprint('boss', true, folded)).toBeCloseTo(0.26);
    expect(infraBillingRateForSprint('boss', false, 0.22)).toBeCloseTo(0.22);
    expect(infraBillingRateForSprint('normal', false, 0.22)).toBeNull();
  });

  it('computeInfraCost は高依存で増え、1 未満は 0', () => {
    expect(computeInfraCost(80, 0.01, 1)).toBe(0);
    expect(computeInfraCost(100, 0.01, 1)).toBe(1);
    expect(computeInfraCost(100, 0.01, 0.525)).toBe(0);
    expect(computeInfraCost(40, 0.05, 1)).toBe(2);
  });

  it('通常ランの非ボスでは課金せず、ボス課金フラグで予算を減らす', () => {
    const engine = new RunEngine({ seed: 'ri88-boss-bill', difficulty: 'normal' });
    engine.startRun();
    const internals = engine as unknown as { org: { aiDependency: number } };
    internals.org.aiDependency = 100;
    const before = engine.snapshot().budget;
    engine.beginSetupSprint();
    expect(engine.snapshot().budget).toBe(before);

    expect(applyTrialAiDependencyPressure(org(100), 20, ctx, { billInfraCost: false })).toBe(20);
    // ceil(100 * 0.22) = 22
    expect(applyTrialAiDependencyPressure(org(100), 20, ctx, { billInfraCost: true })).toBe(0);
  });

  it('インフラと無関係な試練だけでは毎スプリント課金しない（RI-77）', () => {
    const engine = new RunEngine({
      seed: 'ri77-non-infra-trial',
      difficulty: 'normal',
      trials: ['low-focus'],
    });
    engine.startRun();
    const internals = engine as unknown as {
      org: { aiDependency: number };
      teams: Array<{ aiDependency: number }>;
    };
    for (const t of internals.teams) t.aiDependency = 100;
    internals.org.aiDependency = 100;
    const before = engine.snapshot().budget;
    engine.beginSetupSprint();
    expect(engine.snapshot().budget).toBe(before);
  });

  it('コスト最適化進化はボス課金を下げ、複数四半期で差が開く', () => {
    const none = previewInfraCost(100, ctx);
    const optimized = previewInfraCost(100, {
      ...ctx,
      evolution: { points: 0, unlocked: { 'ai-1': true, 'ai-2': true, 'ai-3': true } },
    });
    expect(none.cost).toBe(22); // ceil(100 * 0.22)
    expect(optimized.infraCostMul).toBeCloseTo(0.75 * 0.7);
    expect(optimized.cost).toBe(12); // ceil(100 * 0.22 * 0.525)
    expect(none.cost * 4 - optimized.cost * 4).toBe(40);
  });

  it('既存カード ai-guideline とレリック budget-discipline が infraCostMul を下げる', () => {
    expect(getCard('ai-guideline')?.base.infraCostMul).toBe(0.75);
    expect(getRelic('budget-discipline')?.effects?.infraCostMul).toBe(0.8);
    const withRelic = foldRunEffects({ ...ctx, relics: ['budget-discipline'] });
    expect(withRelic.effects.infraCostMul).toBe(0.8);
    const played = combineEffects(
      IDENTITY_CARD_EFFECTS,
      scaleEffects(getCard('ai-guideline')!.base, 1),
    );
    expect(played.infraCostMul).toBe(0.75);
  });

  it('複数チームでは全社平均の依存度で課金する', () => {
    const engine = new RunEngine({
      seed: 'ri88-company-dep',
      difficulty: 'easy',
      trials: ['frontier-dependency'],
    });
    engine.startRun();
    const internals = engine as unknown as {
      org: { aiDependency: number };
      teams: Array<{ id: string; aiDependency: number }>;
      activeTeamId: string;
    };
    // 選択中だけ低依存でも、他チーム高依存なら全社平均で課金される。
    for (const t of internals.teams) {
      t.aiDependency = t.id === internals.activeTeamId ? 0 : 100;
    }
    internals.org.aiDependency = 0;
    const n = internals.teams.length;
    expect(n).toBeGreaterThan(1);

    const before = engine.snapshot().budget;
    engine.beginSetupSprint();
    // 試練ドリフト +5 後の選択中=5。他チームは 100 のまま。毎スプは上乗せ 0.04 のみ。
    const companyDep = Math.round((5 + 100 * (n - 1)) / n);
    const expected = computeInfraCost(companyDep, 0.04, 1);
    expect(computeInfraCost(5, 0.04, 1)).toBe(0);
    expect(expected).toBeGreaterThan(0);
    expect(engine.snapshot().budget).toBe(before - expected);
    expect(engine.snapshot().org.aiDependency).toBe(5);
  });

  it('カード返金は computeInfraCost と同じ 1 未満無料ルールを使う', () => {
    // 毎スプ上乗せ 0.04 × relic0.8。課金≥1 かつカード後 <1 になる依存帯を使う。
    const engine = new RunEngine({
      seed: 'ri88-refund-floor',
      difficulty: 'easy',
      trials: ['frontier-dependency'],
    });
    engine.startRun();
    const internals = engine as unknown as {
      relics: string[];
      org: { aiDependency: number };
      teams: Array<{ aiDependency: number }>;
      deck: Array<{ defId: string; level: number }>;
      sprint: {
        focus: number;
        cardPiles: { hand: number[]; played: number[]; discard: number[]; drawOrder: number[] };
      } | null;
      sprintPassiveEffects: { infraCostMul: number };
    };
    internals.relics = ['budget-discipline'];
    // 全チーム 35 → ドリフト後選択中 40。全社平均はおおよそ 36〜38。
    // ×0.04×0.8 ≥1 → 課金、×0.04×0.8×0.75 <1 → 返金で 0。
    for (const t of internals.teams) t.aiDependency = 35;
    internals.org.aiDependency = 35;
    const before = engine.snapshot().budget;
    engine.beginSetupSprint();
    expect(engine.snapshot().org.aiDependency).toBe(40);
    const n = internals.teams.length;
    const companyDep = Math.round((40 + 35 * (n - 1)) / n);
    const expected = computeInfraCost(companyDep, 0.04, 0.8);
    expect(expected).toBeGreaterThan(0);
    expect(computeInfraCost(companyDep, 0.04, 0.8 * 0.75)).toBe(0);
    expect(engine.snapshot().budget).toBe(before - expected);
    expect(internals.sprintPassiveEffects.infraCostMul).toBe(0.8);

    internals.deck = [{ defId: 'ai-guideline', level: 1 }];
    internals.sprint!.cardPiles = { hand: [0], played: [], discard: [], drawOrder: [] };
    internals.sprint!.focus = 100;
    expect(engine.playCard(0).ok).toBe(true);
    // 再計算 raw<1 → 0。課金分を全額返す。
    expect(engine.snapshot().budget).toBe(before);
  });
});

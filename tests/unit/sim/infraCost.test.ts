import { describe, expect, it } from 'vitest';
import { getCard } from '../../../src/data/cards';
import { getRelic } from '../../../src/data/relics';
import { combineEffects, scaleEffects } from '../../../src/sim/cards';
import { IDENTITY_CARD_EFFECTS } from '../../../src/sim/model';
import { BASE_INFRA_COST_PER_DEPENDENCY, foldRunEffects } from '../../../src/sim/run/effects';
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
  it('ベース単価があり、試練は上乗せして旧 0.05 を維持する', () => {
    expect(BASE_INFRA_COST_PER_DEPENDENCY).toBe(0.01);
    expect(foldRunEffects({ ...ctx }).frontierModelCostPerDependency).toBe(0.01);
    expect(
      foldRunEffects({ ...ctx, trials: ['frontier-dependency'] }).frontierModelCostPerDependency,
    ).toBe(0.05);
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
    expect(applyTrialAiDependencyPressure(org(100), 20, ctx, { billInfraCost: true })).toBe(19);
  });

  it('コスト最適化進化はボス課金を下げ、複数四半期で差が開く', () => {
    const none = previewInfraCost(100, ctx);
    const optimized = previewInfraCost(100, {
      ...ctx,
      evolution: { points: 0, unlocked: { 'ai-1': true, 'ai-2': true, 'ai-3': true } },
    });
    expect(none.cost).toBe(1);
    expect(optimized.infraCostMul).toBeCloseTo(0.75 * 0.7);
    expect(optimized.cost).toBe(0);
    expect(none.cost * 4 - optimized.cost * 4).toBe(4);
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
});

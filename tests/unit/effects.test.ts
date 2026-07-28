import { describe, expect, it } from 'vitest';
import { IDENTITY_CARD_EFFECTS } from '../../src/sim/model';
import {
  IDENTITY_PASSIVES,
  foldPassives,
  foldRunEffects,
  toEffects,
  withBossEffects,
} from '../../src/sim/run/effects';
import type { EvolutionState, RunModifierInput } from '../../src/sim/run/types';

const emptyEvolution: EvolutionState = { points: 0, unlocked: {} };

const input = (overrides: Partial<RunModifierInput> = {}): RunModifierInput => ({
  deck: [],
  relics: [],
  evolution: emptyEvolution,
  difficulty: 'normal',
  trials: [],
  ...overrides,
});

describe('run effects fold', () => {
  it('空入力では全係数と補正が identity になる', () => {
    expect(foldRunEffects(input())).toEqual({
      effects: { ...IDENTITY_CARD_EFFECTS },
      focusBonus: 0,
      codingSlotBonus: 0,
      aiDependencyDriftPerSprint: 0,
      frontierModelCostPerDependency: 0,
    });
  });

  it('partial effects を identity で補完する', () => {
    expect(toEffects({ reworkRateAdd: -0.08, reviewEfficiencyMul: 1.15 })).toEqual({
      ...IDENTITY_CARD_EFFECTS,
      reworkRateAdd: -0.08,
      reviewEfficiencyMul: 1.15,
    });
  });

  it('難易度・試練・レリック・進化の係数を乗算と加算で畳み込む', () => {
    const folded = foldRunEffects(
      input({
        difficulty: 'hard',
        trials: ['flammable', 'review-cap', 'low-focus', 'frontier-dependency', 'unknown-trial'],
        relics: [
          'postmortem',
          'small-pr',
          'doc-driven',
          'no-friday-deploy',
          'strong-ci',
          'unknown-relic',
        ],
        evolution: {
          points: 0,
          unlocked: {
            'dev-1': true,
            'dev-3': true,
            'review-1': true,
            'review-2': true,
            'quality-1': true,
            'quality-2': true,
            'quality-3': true,
            'ai-1': true,
            'ai-2': true,
            'ai-3': true,
            'culture-1': true,
            'culture-2': true,
            'culture-3': true,
            'unknown-node': true,
          },
        },
      }),
    );

    expect(folded.effects).toEqual({
      codingSpeedMul: 1.12 * 1.2,
      routineSpeedMul: 1.3,
      reviewEfficiencyMul: 0.92 * 0.85 * 1.15 * 1.18,
      reviewCapacityMul: 1.2,
      reworkRateAdd: 0.05 - 0.08 - 0.12 - 0.1 - 0.1,
      incidentRateMul: 1.3 * 0.9 * 0.85 * 0.82,
      aiLiteracyAdd: 18,
      aiDependencyAdd: 0,
      qualityAdd: 6 + 8 + 10,
      testCoverageAdd: 8 + 12,
    });
    expect(folded.focusBonus).toBe(-1 + 2 + 3);
    expect(folded.codingSlotBonus).toBe(0);
    expect(folded.aiDependencyDriftPerSprint).toBe(5);
    expect(folded.frontierModelCostPerDependency).toBe(0.05);
  });

  it('deck は常時効果に含めない', () => {
    const folded = foldRunEffects(
      input({
        deck: [
          { defId: 'copilot', level: 3 },
          { defId: 'auto-test', level: 2 },
        ],
      }),
    );

    expect(folded.effects).toEqual({ ...IDENTITY_CARD_EFFECTS });
  });
});

describe('run passives fold', () => {
  it('空入力と未知レリックでは passives が identity になる', () => {
    expect(foldPassives([])).toEqual(IDENTITY_PASSIVES);
    expect(foldPassives(['unknown-relic'])).toEqual(IDENTITY_PASSIVES);
  });

  it('レリックの数値パッシブを合算し、ショップ割引は 80% で止まる', () => {
    expect(
      foldPassives([
        'psych-safety',
        'expectation-mgmt',
        'flow-first',
        'budget-discipline',
        'budget-discipline',
        'budget-discipline',
        'budget-discipline',
        'budget-discipline',
      ]),
    ).toEqual({
      moraleDamageMul: 0.6 * 0.75,
      restHealBonus: 10,
      shopDiscount: 0.8,
      relicSlots: 6,
    });
  });
});

describe('boss effects', () => {
  it('boss が無い・未知なら base をそのまま返す', () => {
    const base = toEffects({ incidentRateMul: 0.8, qualityAdd: 4 });

    expect(withBossEffects(base, null)).toBe(base);
    expect(withBossEffects(base, 'unknown-boss')).toBe(base);
  });

  it('boss の障害率倍率だけを掛ける', () => {
    const base = toEffects({ incidentRateMul: 0.8, qualityAdd: 4 });

    expect(withBossEffects(base, 'major-incident')).toEqual({
      ...base,
      incidentRateMul: 0.8 * 1.65,
    });
  });
});

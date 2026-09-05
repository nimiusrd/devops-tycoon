import { describe, expect, it } from 'vitest';
import { getGoalAdjustment, type GoalAdjustmentDef } from '../../../src/data/goalAdjustments';
import {
  applyDeliveryGoalEffects,
  applyGoalEffectsToGoal,
  applyGoalOrgEffectsToTeam,
  buildInitialTrust,
  buildQuarterReview,
  loseReasonForOutcome,
  MIN_ADJUSTED_QUARTER_DELIVERY_TARGET,
} from '../../../src/sim/run/quarterReview';
import { deriveTeamCapacities } from '../../../src/sim/orgscale/teamState';
import type { TeamRunState } from '../../../src/sim/orgscale/types';
import type { QuarterGoal } from '../../../src/sim/run/types';
import type { OrgState } from '../../../src/sim/types';
import { org, totals } from '../helpers/orgFixtures';

describe('四半期を継続できない具体的な理由', () => {
  const goal: QuarterGoal = {
    deliveryTarget: 100,
    qualityTarget: 50,
    techDebtLimit: 50,
    moraleTarget: 50,
    incidentLimit: 10,
  };

  it.each<{
    label: string;
    orgChanges: Partial<OrgState>;
    reviewQueuePeak: number;
    reason: string;
  }>([
    { label: '士気崩壊', orgChanges: { morale: 0 }, reviewQueuePeak: 0, reason: 'moraleCollapse' },
    { label: '技術的負債', orgChanges: { techDebt: 130 }, reviewQueuePeak: 0, reason: 'techDebt' },
    { label: 'レビュー凍結', orgChanges: {}, reviewQueuePeak: 48, reason: 'reviewFreeze' },
  ])(
    '目標修正で救済できない $label は一般的な KPI 未達ではなく原因を返す',
    ({ orgChanges, reviewQueuePeak, reason }) => {
      const input = {
        goal,
        org: org({ morale: 60, seniorHp: 60, techDebt: 20, quality: 60, ...orgChanges }),
        totals: totals({ delivered: 100, reviewQueuePeak }),
        trust: buildInitialTrust('normal'),
        budget: 40,
        quarterNumber: 1,
        bossSprintCleared: false,
      };
      const review = buildQuarterReview(input);

      expect(review.outcome).toBe('missed_crisis');
      expect(review.availableAdjustments).toEqual([]);
      expect(loseReasonForOutcome(review.outcome, { ...input, progress: review.progress })).toBe(
        reason,
      );
    },
  );

  it('信頼枯渇による shutdown は同時に発生した士気崩壊より信頼を終了理由にする', () => {
    const input = {
      goal,
      org: org({ morale: 0, seniorHp: 60, techDebt: 20, quality: 60 }),
      totals: totals({ delivered: 100 }),
      trust: { management: 0, customers: 60, team: 60 },
      budget: 40,
      quarterNumber: 1,
      bossSprintCleared: false,
    };
    const review = buildQuarterReview(input);

    expect(review.outcome).toBe('shutdown');
    expect(loseReasonForOutcome(review.outcome, { ...input, progress: review.progress })).toBe(
      'trustExhausted',
    );
  });
});

describe('四半期目標の複合効果と任意 KPI', () => {
  it('Delivery は乗算で丸めてから加算する', () => {
    expect(applyDeliveryGoalEffects(4001, { deliveryMul: 0.5, deliveryAdd: 99 })).toBe(2100);
  });

  it('乗算で下限へ達しても、その後の加算を適用する', () => {
    expect(applyDeliveryGoalEffects(2000, { deliveryMul: 0, deliveryAdd: 99 })).toBe(
      MIN_ADJUSTED_QUARTER_DELIVERY_TARGET + 99,
    );
  });

  it('加算で下限を割り込むと下限に止まり、効果が無ければ入力を保つ', () => {
    expect(applyDeliveryGoalEffects(4000, { deliveryMul: 0.5, deliveryAdd: -2000 })).toBe(
      MIN_ADJUSTED_QUARTER_DELIVERY_TARGET,
    );
    expect(applyDeliveryGoalEffects(4001, {})).toBe(4001);
  });

  it('AI 導入目標のない四半期へ AI 目標修正を適用しても KPI を新設しない', () => {
    const goal: QuarterGoal = {
      deliveryTarget: 4000,
      qualityTarget: 45,
      techDebtLimit: 55,
      moraleTarget: 40,
      incidentLimit: 6,
    };
    const before = structuredClone(goal);
    const def = getGoalAdjustment('pause_ai_rollout')!;

    expect(applyGoalEffectsToGoal(goal, def)).toEqual({ ...goal, deliveryTarget: 3680 });
    expect(applyGoalEffectsToGoal(goal, def)).not.toHaveProperty('aiAdoptionTarget');
    expect(applyGoalEffectsToGoal({ ...goal, aiAdoptionTarget: 10 }, def)).toEqual({
      ...goal,
      deliveryTarget: 3680,
      aiAdoptionTarget: 0,
    });
    expect(goal).toEqual(before);
  });
});

function makeTeam(quality: number): TeamRunState {
  const team = {
    id: 'product-t0',
    deptId: 'product',
    name: 'チーム A',
    engineers: 5,
    headcount: 5,
    aiLiteracy: 50,
    aiDependency: 40,
    morale: 50,
    techDebt: 40,
    shipping: 100,
    reviewQueue: 2,
    incidents: 1,
    seniorHp: 50,
    aiEnabled: true,
    testCoverage: 50,
    documentation: 50,
    quality,
    securityLevel: 55,
  };
  return { ...team, ...deriveTeamCapacities(team) };
}

describe('チームへの品質効果の適用', () => {
  it.each([
    { quality: 50, delta: 10, expected: 60 },
    { quality: 96, delta: 10, expected: 100 },
    { quality: 4, delta: -10, expected: 0 },
  ])(
    '品質 $quality に $delta を適用すると $expected になり障害リスクも更新する',
    ({ quality, delta, expected }) => {
      const team = makeTeam(quality);
      const before = structuredClone(team);
      const def: GoalAdjustmentDef = {
        ...getGoalAdjustment('quality_pivot')!,
        orgEffects: { qualityDelta: delta },
      };

      const result = applyGoalOrgEffectsToTeam(team, def);

      expect(result).toEqual({
        ...before,
        quality: expected,
        incidentBias: expect.any(Number),
      });
      if (delta > 0) expect(result.incidentBias).toBeLessThan(team.incidentBias);
      else expect(result.incidentBias).toBeGreaterThan(team.incidentBias);
      expect(team).toEqual(before);
      expect(result).not.toBe(team);
    },
  );
});

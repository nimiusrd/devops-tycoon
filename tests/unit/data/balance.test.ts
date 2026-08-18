import { describe, expect, it } from 'vitest';
import { ACTION_DEFS } from '../../../src/data/actions';
import {
  ACTION_BALANCE,
  ACTION_BALANCE_BY_ID,
  BALANCE_REGISTRY,
  MEMBER_BALANCE,
  PROCESS_BALANCE,
  defineBalanceEntry,
  defineProbabilityDistribution,
  flattenBalanceEntries,
  validateBalanceRegistry,
} from '../../../src/data/balance';
import * as actionSimulation from '../../../src/sim/actions';
import {
  AI_ADOPTION,
  AI_CODING_SPEEDUP,
  AI_DELIVERY_VALUE_LITERACY_WEIGHT,
  AI_DEP_PER_TASK,
  BURNING_REGEN_MUL,
  BURNING_REVIEW_SLOWDOWN,
  BURN_TICKS,
  CODING_BASE_TICKS,
  COMBO_BONUS_CAP,
  COMBO_BONUS_PER,
  DEBT_PER_SPREAD,
  HIGH_VALUE_MULTIPLIER,
  INCIDENT_CONTAIN_HP,
  INCIDENT_HP_COST,
  MAX_REWORK,
  OVERTIME_CODING_MUL,
  OVERTIME_REVIEW_MUL,
  REVIEW_BASE_PER_TICK,
  REVIEW_HP_COST,
  REVIEW_HP_REGEN,
  REWORK_TICKS,
  SIZE_FACTOR,
  SPREAD_MORALE_COST,
  SPLIT_REWORK_REDUCTION,
  STABILITY_COMBO_CAP,
  STABILITY_COMBO_TAIL_MUL,
  STABILITY_HIGH_VALUE_COMBO_THRESHOLD,
  STABILITY_HIGH_VALUE_MUL,
  STABILITY_REWORK_MUL,
  STABILITY_TICKS,
  TASK_BASE_VALUE,
} from '../../../src/sim/model/process';
import { ORG_STAT_MAX, ORG_STAT_MIN } from '../../../src/sim/orgStat';

const PROCESS_BALANCE_IDS = [
  'process.ai.adoption',
  'process.ai.deliveryValue.literacyWeight',
  'process.ai.dependency.perTask',
  'process.ai.dependency.whenDisabled',
  'process.coding.aiSpeedup',
  'process.coding.baseTicks',
  'process.coding.sizeFactor.complex',
  'process.coding.sizeFactor.normal',
  'process.coding.sizeFactor.routine',
  'process.combo.bonusCap',
  'process.combo.bonusPer',
  'process.combo.minimumCount',
  'process.delivery.highValueMultiplier',
  'process.delivery.taskValue.complex',
  'process.delivery.taskValue.normal',
  'process.delivery.taskValue.routine',
  'process.incident.aiLowLiteracyWeight',
  'process.incident.autoContainHpCost',
  'process.incident.baseProbability',
  'process.incident.burnTicks',
  'process.incident.burning.regenMultiplier',
  'process.incident.burning.reviewSlowdown',
  'process.incident.customerTrust.minimumCount',
  'process.incident.customerTrust.perIncidentRaw',
  'process.incident.customerTrust.perSpreadRaw',
  'process.incident.customerTrust.rawThreshold',
  'process.incident.maximum',
  'process.incident.minimum',
  'process.incident.spread.debt',
  'process.incident.spread.moraleCost',
  'process.incident.testCoverageWeight',
  'process.overtime.codingMultiplier',
  'process.overtime.reviewMultiplier',
  'process.review.basePerTick',
  'process.review.hpCost',
  'process.review.hpEfficiency.floor',
  'process.review.hpEfficiency.range',
  'process.review.hpRegen',
  'process.rework.aiAssistedAdd',
  'process.rework.aiDependencyWeight',
  'process.rework.aiLiteracyWeight',
  'process.rework.attemptDecay',
  'process.rework.baseProbability',
  'process.rework.maxAttempts',
  'process.rework.maximum',
  'process.rework.minimum',
  'process.rework.qualityWeight',
  'process.rework.splitReduction',
  'process.rework.ticks',
  'process.security.fragility.maximum',
  'process.security.fragility.minimum',
  'process.security.fragility.threshold',
  'process.security.incidentRateBonus',
  'process.security.level.maximum',
  'process.security.level.minimum',
  'process.security.rivalLevel.minimum',
  'process.security.spreadMultiplierAdd',
  'process.stability.comboCap',
  'process.stability.comboTailMultiplier',
  'process.stability.highValueComboThreshold',
  'process.stability.highValueMultiplier',
  'process.stability.reworkMultiplier',
  'process.stability.ticks',
] as const;

const ACTION_BALANCE_IDS = [
  'action.interruptReview.focusCost',
  'action.interruptReview.cooldownTicks',
  'action.interruptReview.gaugeGain',
  'action.splitPr.focusCost',
  'action.splitPr.cooldownTicks',
  'action.splitPr.gaugeGain',
  'action.firefight.focusCost',
  'action.firefight.cooldownTicks',
  'action.firefight.gaugeGain',
  'action.assignTask.focusCost',
  'action.assignTask.cooldownTicks',
  'action.assignTask.gaugeGain',
  'action.aiThrottle.focusCost',
  'action.aiThrottle.cooldownTicks',
  'action.aiThrottle.gaugeGain',
  'action.pairReview.focusCost',
  'action.pairReview.cooldownTicks',
  'action.pairReview.gaugeGain',
  'action.overtime.focusCost',
  'action.overtime.cooldownTicks',
  'action.overtime.gaugeGain',
  'action.andon.focusCost',
  'action.andon.cooldownTicks',
  'action.andon.gaugeGain',
  'action.interruptReview.reviewCount',
  'action.interruptReview.seniorHpCost',
  'action.firefight.seniorHpCost',
  'action.firefight.seniorHpEscalation',
  'action.firefight.seniorHpCostMaximum',
  'action.firefight.lightMoraleCost',
  'action.firefight.lightSeniorHpCost',
  'action.firefight.stabilityBurnTicks',
  'action.firefight.stabilityMinimumBurning',
  'action.pairReview.reviewCount',
  'action.pairReview.aiLiteracyGain',
  'action.splitPr.progressPenalty',
  'action.splitPr.moraleCost',
  'action.splitPr.seniorHpCost',
  'action.overtime.durationTicks',
  'action.overtime.moraleCost',
  'action.overtime.seniorHpCost',
  'action.andon.durationTicks',
  'action.andon.stabilityReviewMinimum',
  'action.andon.baseMoraleCost',
  'action.andon.thinMoraleCost',
  'action.andon.seniorHpCost',
  'action.aiThrottle.durationTicks',
  'action.combo.gaugeFocusRefund',
  'action.assignTask.progress',
  'action.assignTask.moraleCost',
  'action.assignTask.mismatchStreakMaximum',
  'action.assignTask.idealMoraleMinimum',
  'action.task.progress.minimum',
  'action.task.progress.maximum',
  'action.organizationStat.minimum',
  'action.organizationStat.maximum',
] as const;

const BALANCE_IDS = [
  ...PROCESS_BALANCE_IDS,
  ...ACTION_BALANCE_IDS,
  ...Object.values(MEMBER_BALANCE).map((entry) => entry.id),
].sort();

describe('型付きバランスレジストリ', () => {
  it('集約済みの工程・メンバー値が検証を通り、全安定 ID と既存 export を維持する', () => {
    expect(validateBalanceRegistry(BALANCE_REGISTRY)).toEqual([]);
    expect([...BALANCE_REGISTRY].map((entry) => entry.id).sort()).toEqual(BALANCE_IDS);
    expect(CODING_BASE_TICKS).toBe(PROCESS_BALANCE.codingBaseTicks.value);
    expect(AI_CODING_SPEEDUP).toBe(PROCESS_BALANCE.aiCodingSpeedup.value);
    expect(AI_ADOPTION).toBe(PROCESS_BALANCE.aiAdoption.value);
    expect(AI_DEP_PER_TASK).toBe(PROCESS_BALANCE.aiDependencyPerTask.value);
    expect(AI_DELIVERY_VALUE_LITERACY_WEIGHT).toBe(
      PROCESS_BALANCE.aiDeliveryValueLiteracyWeight.value,
    );
    expect(SIZE_FACTOR).toEqual({
      routine: PROCESS_BALANCE.codingSizeRoutineFactor.value,
      normal: PROCESS_BALANCE.codingSizeNormalFactor.value,
      complex: PROCESS_BALANCE.codingSizeComplexFactor.value,
    });
    expect(TASK_BASE_VALUE).toEqual({
      routine: PROCESS_BALANCE.taskValueRoutine.value,
      normal: PROCESS_BALANCE.taskValueNormal.value,
      complex: PROCESS_BALANCE.taskValueComplex.value,
    });
    expect(HIGH_VALUE_MULTIPLIER).toBe(PROCESS_BALANCE.highValueMultiplier.value);
    expect(REVIEW_BASE_PER_TICK).toBe(PROCESS_BALANCE.reviewBasePerTick.value);
    expect(REVIEW_HP_COST).toBe(PROCESS_BALANCE.reviewHpCost.value);
    expect(REVIEW_HP_REGEN).toBe(PROCESS_BALANCE.reviewHpRegen.value);
    expect(REWORK_TICKS).toBe(PROCESS_BALANCE.reworkTicks.value);
    expect(MAX_REWORK).toBe(PROCESS_BALANCE.reworkMaxAttempts.value);
    expect(SPLIT_REWORK_REDUCTION).toBe(PROCESS_BALANCE.reworkSplitReduction.value);
    expect(INCIDENT_HP_COST).toBe(PROCESS_BALANCE.incidentHpCost.value);
    expect(INCIDENT_CONTAIN_HP).toBe(PROCESS_BALANCE.incidentHpCost.value);
    expect(DEBT_PER_SPREAD).toBe(PROCESS_BALANCE.spreadDebt.value);
    expect(BURN_TICKS).toBe(PROCESS_BALANCE.burnTicks.value);
    expect(SPREAD_MORALE_COST).toBe(PROCESS_BALANCE.spreadMoraleCost.value);
    expect(BURNING_REVIEW_SLOWDOWN).toBe(PROCESS_BALANCE.burningReviewSlowdown.value);
    expect(BURNING_REGEN_MUL).toBe(PROCESS_BALANCE.burningRegenMultiplier.value);
    expect(STABILITY_TICKS).toBe(PROCESS_BALANCE.stabilityTicks.value);
    expect(STABILITY_REWORK_MUL).toBe(PROCESS_BALANCE.stabilityReworkMultiplier.value);
    expect(STABILITY_COMBO_CAP).toBe(PROCESS_BALANCE.stabilityComboCap.value);
    expect(STABILITY_COMBO_TAIL_MUL).toBe(PROCESS_BALANCE.stabilityComboTailMultiplier.value);
    expect(STABILITY_HIGH_VALUE_COMBO_THRESHOLD).toBe(
      PROCESS_BALANCE.stabilityHighValueComboThreshold.value,
    );
    expect(STABILITY_HIGH_VALUE_MUL).toBe(PROCESS_BALANCE.stabilityHighValueMultiplier.value);
    expect(OVERTIME_CODING_MUL).toBe(PROCESS_BALANCE.overtimeCodingMultiplier.value);
    expect(OVERTIME_REVIEW_MUL).toBe(PROCESS_BALANCE.overtimeReviewMultiplier.value);
    expect(COMBO_BONUS_PER).toBe(PROCESS_BALANCE.comboBonusPer.value);
    expect(COMBO_BONUS_CAP).toBe(PROCESS_BALANCE.comboBonusCap.value);
  });

  it('介入の実行定義と互換aliasがアクションレジストリを参照する', () => {
    expect([...Object.values(ACTION_BALANCE).map((entry) => entry.id)].sort()).toEqual(
      [...ACTION_BALANCE_IDS].sort(),
    );
    expect(ACTION_DEFS.map((definition) => definition.id)).toEqual(
      Object.keys(ACTION_BALANCE_BY_ID),
    );

    for (const definition of ACTION_DEFS) {
      const balance = ACTION_BALANCE_BY_ID[definition.id];
      expect(definition.cost).toBe(balance.focusCost.value);
      expect(definition.cooldownTicks).toBe(balance.cooldownTicks.value);
      expect(definition.gauge).toBe(balance.gauge.value);
    }

    const aliases = [
      [actionSimulation.INTERRUPT_REVIEW_COUNT, ACTION_BALANCE.interruptReviewCount],
      [actionSimulation.INTERRUPT_HP_COST, ACTION_BALANCE.interruptReviewHpCost],
      [actionSimulation.FIREFIGHT_HP_COST, ACTION_BALANCE.firefightHpCost],
      [actionSimulation.FIREFIGHT_HP_ESCALATION, ACTION_BALANCE.firefightHpEscalation],
      [actionSimulation.FIREFIGHT_HP_COST_MAX, ACTION_BALANCE.firefightHpCostMaximum],
      [actionSimulation.FIREFIGHT_LIGHT_MORALE_COST, ACTION_BALANCE.firefightLightMoraleCost],
      [actionSimulation.FIREFIGHT_LIGHT_HP_COST, ACTION_BALANCE.firefightLightHpCost],
      [actionSimulation.FIREFIGHT_STABILITY_BURN_TICKS, ACTION_BALANCE.firefightStabilityBurnTicks],
      [
        actionSimulation.FIREFIGHT_STABILITY_MIN_BURNING,
        ACTION_BALANCE.firefightStabilityMinimumBurning,
      ],
      [actionSimulation.PAIR_REVIEW_COUNT, ACTION_BALANCE.pairReviewCount],
      [actionSimulation.PAIR_LITERACY_GAIN, ACTION_BALANCE.pairReviewLiteracyGain],
      [actionSimulation.SPLIT_PROGRESS_PENALTY, ACTION_BALANCE.splitPrProgressPenalty],
      [actionSimulation.SPLIT_MORALE_COST, ACTION_BALANCE.splitPrMoraleCost],
      [actionSimulation.SPLIT_HP_COST, ACTION_BALANCE.splitPrHpCost],
      [actionSimulation.OVERTIME_TICKS, ACTION_BALANCE.overtimeTicks],
      [actionSimulation.OVERTIME_MORALE_COST, ACTION_BALANCE.overtimeMoraleCost],
      [actionSimulation.OVERTIME_HP_COST, ACTION_BALANCE.overtimeHpCost],
      [actionSimulation.ANDON_TICKS, ACTION_BALANCE.andonTicks],
      [actionSimulation.ANDON_STABILITY_REVIEW_MIN, ACTION_BALANCE.andonStabilityReviewMinimum],
      [actionSimulation.ANDON_BASE_MORALE_COST, ACTION_BALANCE.andonBaseMoraleCost],
      [actionSimulation.ANDON_THIN_MORALE_COST, ACTION_BALANCE.andonThinMoraleCost],
      [actionSimulation.ANDON_HP_COST, ACTION_BALANCE.andonHpCost],
      [actionSimulation.THROTTLE_TICKS, ACTION_BALANCE.aiThrottleTicks],
      [actionSimulation.GAUGE_FOCUS_REFUND, ACTION_BALANCE.comboGaugeFocusRefund],
      [actionSimulation.ASSIGN_PROGRESS, ACTION_BALANCE.assignTaskProgress],
      [actionSimulation.ASSIGN_MORALE_COST, ACTION_BALANCE.assignTaskMoraleCost],
      [actionSimulation.ASSIGN_MISMATCH_STREAK_MAX, ACTION_BALANCE.assignTaskMismatchStreakMaximum],
      [actionSimulation.ASSIGN_IDEAL_MORALE_MIN, ACTION_BALANCE.assignTaskIdealMoraleMinimum],
      [actionSimulation.TASK_PROGRESS_MIN, ACTION_BALANCE.taskProgressMinimum],
      [actionSimulation.TASK_PROGRESS_MAX, ACTION_BALANCE.taskProgressMaximum],
    ] as const;

    for (const [actual, entry] of aliases) expect(actual).toBe(entry.value);
    expect(ORG_STAT_MIN).toBe(ACTION_BALANCE.organizationStatMinimum.value);
    expect(ORG_STAT_MAX).toBe(ACTION_BALANCE.organizationStatMaximum.value);
  });

  it('介入の割合・進捗・組織指標の範囲を検証する', () => {
    const invalidRatio = defineBalanceEntry({
      ...ACTION_BALANCE.assignTaskProgress,
      id: 'test.action-ratio-out-of-range',
      value: 1.1,
      allowedRange: { min: 0, max: 2 },
    });

    expect(validateBalanceRegistry([invalidRatio])).toContainEqual(
      expect.objectContaining({ code: 'ratio-out-of-range', id: invalidRatio.id }),
    );
    expect(ACTION_BALANCE.taskProgressMinimum.value).toBeGreaterThanOrEqual(0);
    expect(ACTION_BALANCE.taskProgressMaximum.value).toBeLessThanOrEqual(1);
    expect(ACTION_BALANCE.organizationStatMinimum.value).toBeGreaterThanOrEqual(0);
    expect(ACTION_BALANCE.organizationStatMaximum.value).toBeLessThanOrEqual(100);
  });

  it('Security 脆弱度の分母となる閾値は正数に制限する', () => {
    expect(PROCESS_BALANCE.securityFragilityThreshold.allowedRange.min).toBeGreaterThan(0);
  });

  it('メンバーの分母・生成前提となる下限を正しく制限する', () => {
    expect(MEMBER_BALANCE.xpLevelBase.allowedRange.min).toBeGreaterThan(0);
    expect(MEMBER_BALANCE.leaveThreshold.allowedRange.min).toBeGreaterThan(0);
    expect(MEMBER_BALANCE.rosterCapacity.allowedRange.min).toBeGreaterThanOrEqual(3);
  });

  it('昇格閾値は同値を許可せず、順番を維持する', () => {
    const middle = defineBalanceEntry({
      ...MEMBER_BALANCE.promotionMiddleLevel,
      value: MEMBER_BALANCE.promotionSeniorLevel.value,
    });
    const senior = defineBalanceEntry({
      ...MEMBER_BALANCE.promotionSeniorLevel,
      value: MEMBER_BALANCE.promotionSeniorLevel.value,
    });

    expect(validateBalanceRegistry([middle, senior])).toContainEqual(
      expect.objectContaining({
        code: 'related-range-inverted',
        id: MEMBER_BALANCE.promotionMiddleLevel.id,
      }),
    );
  });

  it('Review の HP 効率下限は正数に制限する', () => {
    expect(PROCESS_BALANCE.reviewHpEfficiencyFloor.allowedRange.min).toBeGreaterThan(0);
  });

  it('Review の HP 効率係数は合計 1 に制限する', () => {
    const invalidFloor = defineBalanceEntry({
      ...PROCESS_BALANCE.reviewHpEfficiencyFloor,
      value: 0.5,
    });
    const invalidRange = defineBalanceEntry({
      ...PROCESS_BALANCE.reviewHpEfficiencyRange,
      value: 0.7,
    });

    expect(validateBalanceRegistry([invalidFloor, invalidRange])).toContainEqual(
      expect.objectContaining({
        code: 'related-total-invalid',
        id: PROCESS_BALANCE.reviewHpEfficiencyFloor.id,
      }),
    );
  });

  it('粗粒度の完了件数換算に使う通常タスク価値は正数に制限する', () => {
    expect(PROCESS_BALANCE.taskValueNormal.allowedRange.min).toBeGreaterThan(0);
  });

  it.each([
    PROCESS_BALANCE.codingBaseTicks,
    PROCESS_BALANCE.reworkTicks,
    PROCESS_BALANCE.burnTicks,
    PROCESS_BALANCE.stabilityTicks,
    PROCESS_BALANCE.incidentTrustMinimumCount,
    PROCESS_BALANCE.comboMinimumCount,
    PROCESS_BALANCE.stabilityComboCap,
    PROCESS_BALANCE.stabilityHighValueComboThreshold,
    PROCESS_BALANCE.securityLevelMinimum,
    PROCESS_BALANCE.securityLevelMaximum,
    PROCESS_BALANCE.securityRivalLevelMinimum,
    ACTION_BALANCE.interruptReviewFocusCost,
    ACTION_BALANCE.interruptReviewCooldownTicks,
    ACTION_BALANCE.splitPrFocusCost,
    ACTION_BALANCE.splitPrCooldownTicks,
    ACTION_BALANCE.firefightFocusCost,
    ACTION_BALANCE.firefightCooldownTicks,
    ACTION_BALANCE.assignTaskFocusCost,
    ACTION_BALANCE.assignTaskCooldownTicks,
    ACTION_BALANCE.aiThrottleFocusCost,
    ACTION_BALANCE.aiThrottleCooldownTicks,
    ACTION_BALANCE.pairReviewFocusCost,
    ACTION_BALANCE.pairReviewCooldownTicks,
    ACTION_BALANCE.overtimeFocusCost,
    ACTION_BALANCE.overtimeCooldownTicks,
    ACTION_BALANCE.andonFocusCost,
    ACTION_BALANCE.andonCooldownTicks,
    ACTION_BALANCE.interruptReviewCount,
    ACTION_BALANCE.interruptReviewHpCost,
    ACTION_BALANCE.firefightHpCost,
    ACTION_BALANCE.firefightHpEscalation,
    ACTION_BALANCE.firefightHpCostMaximum,
    ACTION_BALANCE.firefightLightMoraleCost,
    ACTION_BALANCE.firefightLightHpCost,
    ACTION_BALANCE.firefightStabilityBurnTicks,
    ACTION_BALANCE.firefightStabilityMinimumBurning,
    ACTION_BALANCE.pairReviewCount,
    ACTION_BALANCE.pairReviewLiteracyGain,
    ACTION_BALANCE.splitPrMoraleCost,
    ACTION_BALANCE.splitPrHpCost,
    ACTION_BALANCE.overtimeTicks,
    ACTION_BALANCE.overtimeMoraleCost,
    ACTION_BALANCE.overtimeHpCost,
    ACTION_BALANCE.andonTicks,
    ACTION_BALANCE.andonStabilityReviewMinimum,
    ACTION_BALANCE.andonBaseMoraleCost,
    ACTION_BALANCE.andonThinMoraleCost,
    ACTION_BALANCE.andonHpCost,
    ACTION_BALANCE.aiThrottleTicks,
    ACTION_BALANCE.comboGaugeFocusRefund,
    ACTION_BALANCE.assignTaskMoraleCost,
    ACTION_BALANCE.assignTaskMismatchStreakMaximum,
    ACTION_BALANCE.assignTaskIdealMoraleMinimum,
    ACTION_BALANCE.organizationStatMinimum,
    ACTION_BALANCE.organizationStatMaximum,
  ])('$id は非整数の離散値を検証で拒否する', (entry) => {
    expect(entry.integer).toBe(true);
    const invalid = defineBalanceEntry({ ...entry, value: entry.value + 0.5 });

    expect(validateBalanceRegistry([invalid])).toContainEqual(
      expect.objectContaining({ code: 'non-integer-value', id: entry.id }),
    );
  });

  it.each([
    {
      minimum: PROCESS_BALANCE.reworkMinimum,
      maximum: PROCESS_BALANCE.reworkMaximum,
      invertedMinimum: 0.8,
      invertedMaximum: 0.7,
    },
    {
      minimum: PROCESS_BALANCE.incidentMinimum,
      maximum: PROCESS_BALANCE.incidentMaximum,
      invertedMinimum: 0.5,
      invertedMaximum: 0.4,
    },
    {
      minimum: PROCESS_BALANCE.securityLevelMinimum,
      maximum: PROCESS_BALANCE.securityLevelMaximum,
      invertedMinimum: 100,
      invertedMaximum: 99,
    },
    {
      minimum: PROCESS_BALANCE.securityRivalLevelMinimum,
      maximum: PROCESS_BALANCE.securityLevelMaximum,
      invertedMinimum: 100,
      invertedMaximum: 99,
    },
    {
      minimum: PROCESS_BALANCE.securityFragilityMinimum,
      maximum: PROCESS_BALANCE.securityFragilityMaximum,
      invertedMinimum: 1,
      invertedMaximum: 0.9,
    },
    {
      minimum: ACTION_BALANCE.taskProgressMinimum,
      maximum: ACTION_BALANCE.taskProgressMaximum,
      invertedMinimum: 0.8,
      invertedMaximum: 0.7,
    },
    {
      minimum: ACTION_BALANCE.organizationStatMinimum,
      maximum: ACTION_BALANCE.organizationStatMaximum,
      invertedMinimum: 100,
      invertedMaximum: 99,
    },
    {
      minimum: ACTION_BALANCE.firefightHpCost,
      maximum: ACTION_BALANCE.firefightHpCostMaximum,
      invertedMinimum: 7,
      invertedMaximum: 6,
    },
  ])(
    '$minimum.id と $maximum.id が逆転した場合は検証で拒否する',
    ({ minimum, maximum, invertedMinimum, invertedMaximum }) => {
      const invalidMinimum = defineBalanceEntry({ ...minimum, value: invertedMinimum });
      const invalidMaximum = defineBalanceEntry({ ...maximum, value: invertedMaximum });

      expect(validateBalanceRegistry([invalidMinimum, invalidMaximum])).toContainEqual(
        expect.objectContaining({ code: 'related-range-inverted', id: minimum.id }),
      );
    },
  );

  it('重複した安定IDを検出する', () => {
    const duplicate = defineBalanceEntry({
      ...PROCESS_BALANCE.codingBaseTicks,
      value: 8,
    });

    expect(validateBalanceRegistry([...BALANCE_REGISTRY, duplicate])).toContainEqual(
      expect.objectContaining({ code: 'duplicate-id', id: 'process.coding.baseTicks' }),
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('非有限値 %p を検出する', (value) => {
    const invalid = defineBalanceEntry({
      ...PROCESS_BALANCE.codingBaseTicks,
      id: `test.non-finite.${String(value)}`,
      value,
    });

    expect(validateBalanceRegistry([invalid])).toContainEqual(
      expect.objectContaining({ code: 'non-finite-value', id: invalid.id }),
    );
  });

  it('非有限な許容範囲、範囲の逆転、許容範囲外の値を検出する', () => {
    const invalidRange = defineBalanceEntry({
      ...PROCESS_BALANCE.codingBaseTicks,
      id: 'test.non-finite-range',
      allowedRange: { min: 1, max: Number.POSITIVE_INFINITY },
    });
    const invertedRange = defineBalanceEntry({
      ...PROCESS_BALANCE.codingBaseTicks,
      id: 'test.inverted-range',
      allowedRange: { min: 8, max: 7 },
    });
    const outOfRange = defineBalanceEntry({
      ...PROCESS_BALANCE.codingBaseTicks,
      id: 'test.value-out-of-range',
      value: 31,
    });

    const codes = validateBalanceRegistry([invalidRange, invertedRange, outOfRange]).map(
      (error) => error.code,
    );
    expect(codes).toContain('non-finite-range');
    expect(codes).toContain('range-inverted');
    expect(codes).toContain('value-out-of-range');
  });

  it('確率の単位範囲を検出する', () => {
    const invalidProbability = defineBalanceEntry({
      ...PROCESS_BALANCE.aiAdoption,
      id: 'test.probability-out-of-range',
      value: 1.1,
      allowedRange: { min: 0, max: 2 },
    });

    expect(validateBalanceRegistry([invalidProbability])).toContainEqual(
      expect.objectContaining({ code: 'probability-out-of-range', id: invalidProbability.id }),
    );
  });

  it('確率分布の非正重みと合計不一致を検出する', () => {
    const invalidDistribution = defineProbabilityDistribution({
      id: 'test.invalid-distribution',
      unit: 'probability',
      allowedRange: { min: 0, max: 1 },
      label: '不正な確率分布',
      description: '検証テスト用。',
      tags: ['test'],
      derived: false,
      entries: [
        defineBalanceEntry({
          id: 'test.invalid-distribution.none',
          value: 0,
          unit: 'probability',
          allowedRange: { min: 0, max: 1 },
          label: 'ゼロ重み',
          description: '検証テスト用。',
          tags: ['test'],
          derived: false,
        }),
        defineBalanceEntry({
          id: 'test.invalid-distribution.partial',
          value: 0.6,
          unit: 'probability',
          allowedRange: { min: 0, max: 1 },
          label: '合計不足',
          description: '検証テスト用。',
          tags: ['test'],
          derived: false,
        }),
      ],
    });

    const errors = validateBalanceRegistry([invalidDistribution]);
    expect(flattenBalanceEntries([invalidDistribution]).map((entry) => entry.id)).toEqual([
      'test.invalid-distribution.none',
      'test.invalid-distribution.partial',
    ]);
    expect(errors).toContainEqual(
      expect.objectContaining({
        code: 'distribution-weight-not-positive',
        id: 'test.invalid-distribution.none',
      }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        code: 'distribution-total-invalid',
        id: 'test.invalid-distribution',
      }),
    );
  });
});

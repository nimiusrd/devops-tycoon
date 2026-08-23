import { describe, expect, it } from 'vitest';
import { ACTION_DEFS } from '../../../src/data/actions';
import {
  ACTION_BALANCE,
  ACTION_BALANCE_BY_ID,
  BALANCE_REGISTRY,
  CARD_BALANCE,
  COARSE_TEAM_BALANCE,
  MEMBER_BALANCE,
  META_BALANCE,
  INITIAL_UNLOCKED_DIFFICULTIES,
  PROCESS_BALANCE,
  SPRINT_BALANCE,
  SPRINT_TASK_KIND_WEIGHTS,
  defineBalanceEntry,
  defineProbabilityDistribution,
  flattenBalanceEntries,
  OUTCOME_BALANCE,
  PACING_BALANCE,
  RUN_BALANCE,
  validateBalanceRegistry,
} from '../../../src/data/balance';
import * as actionSimulation from '../../../src/sim/actions';
import * as teamState from '../../../src/sim/orgscale/teamState';
import { HAND_SIZE, PREFERRED_DRAFT_WEIGHT_MUL } from '../../../src/sim/cards';
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
import * as runConstants from '../../../src/sim/run/constants';
import {
  DECISION_BEAT_CHANCE,
  REST_HEAL,
  REST_MORALE_HEAL,
  REST_REPAY,
  REST_REPAY_REWORK_RATE,
  REST_UPGRADE_FOCUS_MAX,
  SHOP_RELIC_COST,
} from '../../../src/sim/run/engine';
import { BASE_INFRA_COST_PER_DEPENDENCY } from '../../../src/sim/run/effects';
import {
  DAILY_RUN_DIFFICULTY,
  DAILY_RUN_TRIALS,
  MAX_PREFERRED_CARDS,
  defaultMeta,
} from '../../../src/state/meta';

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
  'process.coarse.aiPremisePressureReference',
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
  'process.rework.attemptDecay',
  'process.rework.maxAttempts',
  'process.rework.maximum',
  'process.rework.minimum',
  'process.rework.mismatch.dependencyWeight',
  'process.rework.shared.base',
  'process.rework.shared.qualityGapWeight',
  'process.rework.shared.techDebtWeight',
  'process.rework.splitReduction',
  'process.rework.workflow.dependencyInteraction',
  'process.rework.workflow.documentationWeight',
  'process.rework.workflow.literacyWeight',
  'process.rework.workflow.masteryWeight',
  'process.rework.workflow.skillGapWeight',
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

const RUN_BALANCE_IDS = [
  'run.draft.mulliganCost',
  'run.event.decisionBeatChance',
  'run.event.softOutcome.loseThreshold',
  'run.event.softOutcome.survivalFloor',
  'run.evolution.points.base',
  'run.evolution.points.deliveredDivisor',
  'run.evolution.points.eliteBonus',
  'run.infrastructure.baseCostPerDependency',
  'run.infrastructure.minimumBillableRaw',
  'run.quarter.sprintsPerQuarter',
  'run.rest.focusMaxAdd',
  'run.rest.moraleHeal',
  'run.rest.reworkReduction',
  'run.rest.seniorHpHeal',
  'run.rest.techDebtRepay',
  'run.shop.discountMaximum',
  'run.shop.minimumPrice',
  'run.shop.relicCost',
  'run.shop.relicSlots',
] as const;

const OUTCOME_BALANCE_IDS = [
  'outcome.quarter.delivery.throughputMultiplier',
  'outcome.quarter.delivery.minimumTargetScale',
  'outcome.quarter.delivery.baselineSprintFloor',
  'outcome.quarter.delivery.priorMinimumFloorFactor',
  'outcome.quarter.delivery.priorDecay',
  'outcome.quarter.goal.defaultQuality',
  'outcome.quarter.goal.defaultTechDebtLimit',
  'outcome.quarter.goal.defaultMorale',
  'outcome.quarter.goal.defaultIncidentLimit',
  'outcome.quarter.goal.incidentHeadroom',
  'outcome.quarter.goal.multiplier.easy',
  'outcome.quarter.goal.multiplier.normal',
  'outcome.quarter.goal.multiplier.hard',
  'outcome.quarter.goal.multiplier.nightmare',
  'outcome.quarter.initialTrust.easy',
  'outcome.quarter.initialTrust.normal',
  'outcome.quarter.initialTrust.hard',
  'outcome.quarter.initialTrust.nightmare',
  'outcome.quarter.initialTrust.teamBonus',
  'outcome.kpi.exceededHigherMultiplier',
  'outcome.kpi.exceededLowerMultiplier',
  'outcome.quarter.shutdown.trustMax',
  'outcome.quarter.shutdown.budgetMax',
  'outcome.quarter.shutdown.budgetMoraleMax',
  'outcome.quarter.shutdown.seniorHpMax',
  'outcome.quarter.shutdown.missedKpiMin',
  'outcome.quarter.reorg.minQuarter',
  'outcome.quarter.reorg.missedKpiMin',
  'outcome.quarter.reorg.trustMax',
  'outcome.quarter.reorg.trustMissedKpiMin',
  'outcome.quarter.crisis.trustMax',
  'outcome.quarter.crisis.budgetMax',
  'outcome.quarter.crisis.missedKpiMin',
  'outcome.quarter.adjustment.minimumTrust',
  'outcome.quarter.reorg.seniorHpRecovery',
  'outcome.quarter.reorg.techDebtRecovery',
  'outcome.lose.seniorHpMax',
  'outcome.lose.moraleMax',
  'outcome.lose.techDebtCap',
  'outcome.lose.reviewFreezePeak',
  'outcome.lose.consecutiveIncidentSprintCap',
  'outcome.lose.aiDependencyCap',
  'outcome.lose.aiLiteracyUnsafeMax',
  'outcome.lose.budgetMax',
  'outcome.win.management.budgetMin',
  'outcome.win.chaos.incidentsMin',
  'outcome.win.chaos.deliveredMin',
  'outcome.win.chaosNeglect.incidentsMin',
  'outcome.win.chaosNeglect.deliveredMin',
  'outcome.win.chaosNeglect.securityMax',
  'outcome.win.happiness.moraleMin',
  'outcome.win.happiness.seniorHpMin',
  'outcome.win.healthy.securityMin',
  'outcome.win.healthy.qualityMin',
  'outcome.win.healthy.moraleMin',
  'outcome.win.aiSuccess.aiPctMin',
  'outcome.win.aiSuccess.literacyMin',
  'outcome.win.aiSuccess.reworkMax',
  'outcome.win.aiSuccess.securityMin',
  'outcome.win.reviewQueuePeakMax',
  'outcome.win.noDamage.qualityMin',
  'outcome.win.noDamage.moraleMin',
  'outcome.win.noDamage.seniorHpMin',
  'outcome.win.noDamage.reworkMax',
  'outcome.win.noDamage.spreadMax',
  'outcome.win.documentation.qualityMin',
  'outcome.win.documentation.moraleMin',
  'outcome.win.documentation.reworkMax',
  'outcome.win.healthyFallback.reworkMax',
  'outcome.diagnosis.quarter.reviewQueueMin',
  'outcome.diagnosis.quarter.aiDependencyMin',
  'outcome.diagnosis.quarter.aiReworkRatioMin',
  'outcome.diagnosis.seniorSacrifice.seniorHpMax',
  'outcome.diagnosis.reviewQueueMin',
  'outcome.diagnosis.reviewHell.reworkRatioMax',
  'outcome.diagnosis.reworkSpiral.reworkRatioMin',
  'outcome.diagnosis.aiOverproduction.aiPctMin',
  'outcome.diagnosis.aiOverproduction.reworkRatioMin',
  'outcome.diagnosis.documentation.testCoverageMin',
  'outcome.diagnosis.documentation.documentationMin',
  'outcome.diagnosis.documentation.reworkRatioMax',
  'outcome.warning.reviewFreeze.watchRatio',
  'outcome.warning.reviewFreeze.dangerOffset',
] as const;

const PACING_BALANCE_IDS = [
  'pacing.simulation.fixedStepMs',
  'pacing.wallClock.msPerTick1x',
  'pacing.task.normalFloor.easy',
  'pacing.task.normalFloor.normal',
  'pacing.task.normalFloor.hard',
  'pacing.task.normalFloor.nightmare',
  'pacing.task.eliteMultiplier.easy',
  'pacing.task.eliteMultiplier.normal',
  'pacing.task.eliteMultiplier.hard',
  'pacing.task.eliteMultiplier.nightmare',
  'pacing.task.bossFloor.easy',
  'pacing.task.bossFloor.normal',
  'pacing.task.bossFloor.hard',
  'pacing.task.bossFloor.nightmare',
  'pacing.tick.sprint.minComplete',
  'pacing.tick.boss.minComplete',
  'pacing.tick.boss.maximum',
  'pacing.recovery.betweenSprint',
  'pacing.target.sprintWall.absoluteMinMs',
  'pacing.target.sprintWall.minTypicalMs',
  'pacing.target.sprintWall.maxTypicalMs',
  'pacing.target.bossWall.minMs',
  'pacing.target.bossWall.maxMs',
  'pacing.target.betweenSprintWallMs',
  'pacing.target.quarterReviewWallMs',
  'pacing.target.quarterWall.minMs',
  'pacing.target.quarterWall.maxMs',
  'pacing.target.runWall.minMs',
  'pacing.target.runWall.maxMs',
  'pacing.target.interventionPerSprint.min',
  'pacing.target.interventionPerSprint.max',
] as const;

const BALANCE_IDS = [
  ...PROCESS_BALANCE_IDS,
  ...ACTION_BALANCE_IDS,
  ...RUN_BALANCE_IDS,
  ...OUTCOME_BALANCE_IDS,
  ...Object.values(COARSE_TEAM_BALANCE).map((entry) => entry.id),
  ...Object.values(MEMBER_BALANCE).map((entry) => entry.id),
  ...Object.values(CARD_BALANCE).map((entry) => entry.id),
  ...Object.values(SPRINT_BALANCE).map((entry) => entry.id),
  ...PACING_BALANCE_IDS,
  ...Object.values(META_BALANCE).map((entry) => entry.id),
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
    expect(runConstants.SPRINTS_PER_QUARTER).toBe(RUN_BALANCE.sprintsPerQuarter.value);
    expect(runConstants.EVO_POINTS_BASE).toBe(RUN_BALANCE.evolutionPointsBase.value);
    expect(runConstants.EVO_POINTS_DELIVERED_DIVISOR).toBe(
      RUN_BALANCE.evolutionPointsDeliveredDivisor.value,
    );
    expect(runConstants.EVO_POINTS_ELITE_BONUS).toBe(RUN_BALANCE.evolutionPointsEliteBonus.value);
    expect(runConstants.DRAFT_MULLIGAN_COST).toBe(RUN_BALANCE.draftMulliganCost.value);
    expect(DECISION_BEAT_CHANCE).toBe(RUN_BALANCE.decisionBeatChance.value);
    expect(REST_HEAL).toBe(RUN_BALANCE.restSeniorHpHeal.value);
    expect(REST_MORALE_HEAL).toBe(RUN_BALANCE.restMoraleHeal.value);
    expect(REST_REPAY).toBe(RUN_BALANCE.restTechDebtRepay.value);
    expect(REST_REPAY_REWORK_RATE).toBe(-RUN_BALANCE.restReworkReduction.value);
    expect(REST_UPGRADE_FOCUS_MAX).toBe(RUN_BALANCE.restFocusMaxAdd.value);
    expect(SHOP_RELIC_COST).toBe(RUN_BALANCE.shopRelicCost.value);
    expect(BASE_INFRA_COST_PER_DEPENDENCY).toBe(RUN_BALANCE.infraBaseCostPerDependency.value);
    expect(HAND_SIZE).toBe(CARD_BALANCE.handSize.value);
    expect(PREFERRED_DRAFT_WEIGHT_MUL).toBe(CARD_BALANCE.draftPreferredWeightMultiplier.value);
    expect(MAX_PREFERRED_CARDS).toBe(META_BALANCE.preferredMaxCards.value);
    expect(OUTCOME_BALANCE.kpiHigherExceededMultiplier.value).toBe(1.15);
    expect(OUTCOME_BALANCE.kpiLowerExceededMultiplier.value).toBe(0.75);
    expect(OUTCOME_BALANCE.loseReviewFreezePeak.value).toBe(48);
    expect(OUTCOME_BALANCE.quarterCrisisTrustMax.value).toBe(15);
    expect(OUTCOME_BALANCE.quarterReorgTrustMax.value).toBe(20);
    expect(OUTCOME_BALANCE.quarterShutdownTrustMax.value).toBe(10);
    expect(OUTCOME_BALANCE.reorgSeniorHpRecovery.value).toBe(20);
    expect(OUTCOME_BALANCE.reorgTechDebtRecovery.value).toBe(8);
    expect(SPRINT_TASK_KIND_WEIGHTS.routine).toBe(SPRINT_BALANCE.taskKindDistribution.entries[0]);
    expect(SPRINT_TASK_KIND_WEIGHTS.normal).toBe(SPRINT_BALANCE.taskKindDistribution.entries[1]);
    expect(SPRINT_TASK_KIND_WEIGHTS.complex).toBe(SPRINT_BALANCE.taskKindDistribution.entries[2]);
    expect(SPRINT_BALANCE.taskKindDistribution.entries.map((entry) => entry.id)).toEqual([
      'sprint.task.kindWeight.routine',
      'sprint.task.kindWeight.normal',
      'sprint.task.kindWeight.complex',
    ]);
  });

  it('ペーシングの全ID・単位・範囲・順序制約を検証する', () => {
    const entries = Object.values(PACING_BALANCE);
    expect(entries.map((entry) => entry.id).sort()).toEqual([...PACING_BALANCE_IDS].sort());
    for (const entry of entries) {
      expect(Number.isFinite(entry.value)).toBe(true);
      expect(Number.isFinite(entry.allowedRange.min)).toBe(true);
      expect(Number.isFinite(entry.allowedRange.max)).toBe(true);
      expect(entry.allowedRange.min).toBeLessThanOrEqual(entry.value);
      expect(entry.value).toBeLessThanOrEqual(entry.allowedRange.max);
    }
    for (const key of [
      'fixedStepMs',
      'msPerTick1x',
      'sprintWallAbsoluteMinMs',
      'sprintWallMinTypicalMs',
      'sprintWallMaxTypicalMs',
      'bossWallMinMs',
      'bossWallMaxMs',
      'betweenSprintWallMs',
      'quarterReviewWallMs',
      'quarterWallMinMs',
      'quarterWallMaxMs',
      'runWallMinMs',
      'runWallMaxMs',
    ] as const) {
      expect(PACING_BALANCE[key].unit).toBe('milliseconds');
    }
    for (const key of [
      'normalTaskFloorEasy',
      'normalTaskFloorNormal',
      'normalTaskFloorHard',
      'normalTaskFloorNightmare',
      'bossTaskFloorEasy',
      'bossTaskFloorNormal',
      'bossTaskFloorHard',
      'bossTaskFloorNightmare',
      'interventionPerSprintMin',
      'interventionPerSprintMax',
    ] as const) {
      expect(PACING_BALANCE[key].unit).toBe('count');
      expect(PACING_BALANCE[key].integer).toBe(true);
    }
    for (const key of ['sprintMinCompleteTick', 'bossMinCompleteTick', 'bossMaxTicks'] as const) {
      expect(PACING_BALANCE[key].unit).toBe('ticks');
      expect(PACING_BALANCE[key].integer).toBe(true);
    }
    expect(PACING_BALANCE.betweenSprintRecovery.unit).toBe('ratio');
    expect(PACING_BALANCE.eliteTaskMultiplierEasy.unit).toBe('multiplier');
    expect(PACING_BALANCE.fixedStepMs.value).toBe(100);
    expect(PACING_BALANCE.msPerTick1x.value).toBe(780);
    expect(PACING_BALANCE.normalTaskFloorEasy.value).toBe(58);
    expect(PACING_BALANCE.normalTaskFloorNormal.value).toBe(50);
    expect(PACING_BALANCE.normalTaskFloorHard.value).toBe(42);
    expect(PACING_BALANCE.normalTaskFloorNightmare.value).toBe(32);
    expect(PACING_BALANCE.eliteTaskMultiplierEasy.value).toBe(1.24);
    expect(PACING_BALANCE.eliteTaskMultiplierNormal.value).toBe(1.12);
    expect(PACING_BALANCE.eliteTaskMultiplierHard.value).toBe(1.09);
    expect(PACING_BALANCE.eliteTaskMultiplierNightmare.value).toBe(1.15);
    expect(PACING_BALANCE.bossTaskFloorEasy.value).toBe(68);
    expect(PACING_BALANCE.bossTaskFloorNormal.value).toBe(58);
    expect(PACING_BALANCE.bossTaskFloorHard.value).toBe(52);
    expect(PACING_BALANCE.bossTaskFloorNightmare.value).toBe(56);
    expect(PACING_BALANCE.sprintMinCompleteTick.value).toBe(77);
    expect(PACING_BALANCE.bossMinCompleteTick.value).toBe(115);
    expect(PACING_BALANCE.bossMaxTicks.value).toBe(229);
    expect(PACING_BALANCE.betweenSprintRecovery.value).toBe(0.5);
    expect(PACING_BALANCE.sprintWallAbsoluteMinMs.value).toBe(30_000);
    expect(PACING_BALANCE.sprintWallMinTypicalMs.value).toBe(60_000);
    expect(PACING_BALANCE.sprintWallMaxTypicalMs.value).toBe(120_000);
    expect(PACING_BALANCE.bossWallMinMs.value).toBe(90_000);
    expect(PACING_BALANCE.bossWallMaxMs.value).toBe(180_000);
    expect(PACING_BALANCE.betweenSprintWallMs.value).toBe(30_000);
    expect(PACING_BALANCE.quarterReviewWallMs.value).toBe(45_000);
    expect(PACING_BALANCE.quarterWallMinMs.value).toBe(600_000);
    expect(PACING_BALANCE.quarterWallMaxMs.value).toBe(900_000);
    expect(PACING_BALANCE.runWallMinMs.value).toBe(900_000);
    expect(PACING_BALANCE.runWallMaxMs.value).toBe(2_700_000);
    expect(PACING_BALANCE.interventionPerSprintMin.value).toBe(3);
    expect(PACING_BALANCE.interventionPerSprintMax.value).toBe(8);
    expect(validateBalanceRegistry(BALANCE_REGISTRY)).toEqual([]);

    const invalidBand = defineBalanceEntry({
      ...PACING_BALANCE.sprintWallMinTypicalMs,
      value: PACING_BALANCE.sprintWallMaxTypicalMs.value + 1,
    });
    expect(
      validateBalanceRegistry([invalidBand, PACING_BALANCE.sprintWallMaxTypicalMs]),
    ).toContainEqual(
      expect.objectContaining({
        code: 'related-range-inverted',
        id: PACING_BALANCE.sprintWallMinTypicalMs.id,
      }),
    );
    const invalidBossMinimum = defineBalanceEntry({
      ...PACING_BALANCE.bossMinCompleteTick,
      value: PACING_BALANCE.bossMaxTicks.value,
    });
    expect(
      validateBalanceRegistry([invalidBossMinimum, PACING_BALANCE.bossMaxTicks]),
    ).toContainEqual(
      expect.objectContaining({
        code: 'related-range-inverted',
        id: PACING_BALANCE.bossMinCompleteTick.id,
      }),
    );
    const invalidSprintMinimum = defineBalanceEntry({
      ...PACING_BALANCE.sprintMinCompleteTick,
      value: PACING_BALANCE.bossMinCompleteTick.value,
    });
    expect(
      validateBalanceRegistry([invalidSprintMinimum, PACING_BALANCE.bossMinCompleteTick]),
    ).toContainEqual(
      expect.objectContaining({
        code: 'related-range-inverted',
        id: PACING_BALANCE.sprintMinCompleteTick.id,
      }),
    );
  });

  it('メタ進行の全ID・単位・互換aliasと学習ボーナス順序を検証する', () => {
    const entries = Object.values(META_BALANCE);
    for (const entry of entries) {
      expect(entry.id.startsWith('meta.')).toBe(true);
      expect(Number.isFinite(entry.value)).toBe(true);
      expect(entry.allowedRange.min).toBeLessThanOrEqual(entry.value);
      expect(entry.value).toBeLessThanOrEqual(entry.allowedRange.max);
    }
    expect(MAX_PREFERRED_CARDS).toBe(2);
    expect(MAX_PREFERRED_CARDS).toBe(META_BALANCE.preferredMaxCards.value);
    expect(META_BALANCE.rewardWinBase.value).toBe(20);
    expect(META_BALANCE.rewardLossBase.value).toBe(5);
    expect(META_BALANCE.rewardScoreMulFloor.value).toBe(1);
    expect(META_BALANCE.rewardLearningBase.value).toBe(2);
    expect(META_BALANCE.rewardLearningPerReview.value).toBe(1);
    expect(META_BALANCE.rewardLearningCap.value).toBe(5);
    expect(META_BALANCE.rewardReviewExceeded.value).toBe(3);
    expect(META_BALANCE.rewardReviewMet.value).toBe(1);
    expect(META_BALANCE.achievementComboMasterMinCombo.value).toBe(20);
    expect(DAILY_RUN_DIFFICULTY).toBe('normal');
    expect(DAILY_RUN_TRIALS).toEqual([]);
    expect(defaultMeta().unlockedDifficulties).toEqual([...INITIAL_UNLOCKED_DIFFICULTIES]);
    expect(META_BALANCE.preferredMaxCards.unit).toBe('count');
    expect(META_BALANCE.rewardWinBase.unit).toBe('points');
    expect(META_BALANCE.rewardScoreMulFloor.unit).toBe('multiplier');
    expect(META_BALANCE.achievementComboMasterMinCombo.integer).toBe(true);

    const invalidLearning = {
      ...META_BALANCE.rewardLearningBase,
      value: META_BALANCE.rewardLearningCap.value + 1,
    };
    expect(validateBalanceRegistry([invalidLearning, META_BALANCE.rewardLearningCap])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'related-range-inverted',
          id: META_BALANCE.rewardLearningBase.id,
        }),
      ]),
    );
  });

  it('粗粒度チームの値・境界・互換aliasをレジストリへ集約する', () => {
    expect(
      Object.values(COARSE_TEAM_BALANCE).every((entry) => entry.id.startsWith('coarse.team.')),
    ).toBe(true);
    expect(COARSE_TEAM_BALANCE.defaultHomeEngineers.value).toBe(5);
    expect(COARSE_TEAM_BALANCE.shippingMinimum.value).toBe(4);
    expect(COARSE_TEAM_BALANCE.healthReviewHellQueueMinimum.value).toBe(12);
    expect(COARSE_TEAM_BALANCE.leaguePlatinumMaximum.value).toBe(0.2);
    expect(teamState.ENTER_TEAM_FOCUS_PENALTY).toBe(
      COARSE_TEAM_BALANCE.enterTeamFocusPenalty.value,
    );
    expect(teamState.ENTER_TEAM_LOCK_SPRINTS).toBe(COARSE_TEAM_BALANCE.enterTeamLockSprints.value);
    expect(teamState.RIVAL_AI_DEPENDENCY_SPREAD).toBe(
      COARSE_TEAM_BALANCE.rivalAiDependencySpread.value,
    );
    expect(teamState.RIVAL_AI_DEPENDENCY_SPREAD_LOW_LITERACY).toBe(
      COARSE_TEAM_BALANCE.rivalAiDependencySpreadLowLiteracy.value,
    );

    const invalidQueueBounds = [
      {
        ...COARSE_TEAM_BALANCE.healthCongestedQueueMinimum,
        value: COARSE_TEAM_BALANCE.healthReviewHellQueueMinimum.value,
      },
      COARSE_TEAM_BALANCE.healthReviewHellQueueMinimum,
    ];
    expect(validateBalanceRegistry(invalidQueueBounds)).toContainEqual(
      expect.objectContaining({
        code: 'related-range-inverted',
        id: COARSE_TEAM_BALANCE.healthCongestedQueueMinimum.id,
      }),
    );
  });

  it('ラン進行・経済の値と関係制約を検証する', () => {
    expect(RUN_BALANCE.decisionBeatChance.value).toBe(0.55);
    expect(RUN_BALANCE.softOutcomeLoseThreshold.value).toBe(1);
    expect(RUN_BALANCE.softOutcomeSurvivalFloor.value).toBe(2);
    expect(RUN_BALANCE.softOutcomeLoseThreshold.allowedRange).toEqual({ min: 1, max: 1 });
    expect(RUN_BALANCE.shopDiscountMaximum.value).toBe(0.8);
    expect(RUN_BALANCE.infraMinimumBillableRaw.value).toBe(1);
    expect(RUN_BALANCE.softOutcomeLoseThreshold.value).toBeLessThan(
      RUN_BALANCE.softOutcomeSurvivalFloor.value,
    );

    const invalidLoseThreshold = defineBalanceEntry({
      ...RUN_BALANCE.softOutcomeLoseThreshold,
      value: RUN_BALANCE.softOutcomeSurvivalFloor.value,
    });
    expect(
      validateBalanceRegistry([invalidLoseThreshold, RUN_BALANCE.softOutcomeSurvivalFloor]),
    ).toContainEqual(
      expect.objectContaining({
        code: 'related-range-inverted',
        id: RUN_BALANCE.softOutcomeLoseThreshold.id,
      }),
    );
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
    expect(ACTION_BALANCE.taskProgressMinimum.allowedRange).toEqual({ min: 0, max: 0 });
    expect(ACTION_BALANCE.taskProgressMaximum.value).toBeLessThanOrEqual(1);
    expect(ACTION_BALANCE.taskProgressMaximum.allowedRange.min).toBeGreaterThanOrEqual(0.999);
    expect(ACTION_BALANCE.organizationStatMinimum.value).toBeGreaterThanOrEqual(0);
    expect(ACTION_BALANCE.organizationStatMinimum.allowedRange).toEqual({ min: 0, max: 0 });
    expect(ACTION_BALANCE.organizationStatMaximum.value).toBeLessThanOrEqual(100);
    expect(ACTION_BALANCE.organizationStatMaximum.allowedRange).toEqual({ min: 100, max: 100 });
    expect(ACTION_BALANCE.interruptReviewCount.allowedRange.min).toBe(1);
    expect(ACTION_BALANCE.pairReviewCount.allowedRange.min).toBe(1);
    expect(ACTION_BALANCE.overtimeTicks.allowedRange.min).toBe(1);
    expect(ACTION_BALANCE.andonTicks.allowedRange.min).toBe(1);
    expect(ACTION_BALANCE.aiThrottleTicks.allowedRange.min).toBe(1);
    expect(ACTION_BALANCE.firefightStabilityMinimumBurning.allowedRange.min).toBe(1);
    expect(ACTION_BALANCE.andonStabilityReviewMinimum.allowedRange.min).toBe(1);
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

  it('スプリント評価境界は同値を許可せず、順番を維持する', () => {
    const thresholdC = defineBalanceEntry({
      ...SPRINT_BALANCE.gradeThresholdC,
      value: SPRINT_BALANCE.gradeThresholdB.value,
    });
    const thresholdB = defineBalanceEntry({
      ...SPRINT_BALANCE.gradeThresholdB,
      value: SPRINT_BALANCE.gradeThresholdB.value,
    });

    expect(validateBalanceRegistry([thresholdC, thresholdB])).toContainEqual(
      expect.objectContaining({
        code: 'related-range-inverted',
        id: SPRINT_BALANCE.gradeThresholdC.id,
      }),
    );
  });

  it('Review freeze 警告帯は watch < danger < lose の順序を維持する', () => {
    const peak = defineBalanceEntry({
      ...OUTCOME_BALANCE.loseReviewFreezePeak,
      value: 48,
    });
    const watchRatio = defineBalanceEntry({
      ...OUTCOME_BALANCE.reviewFreezeWatchRatio,
      value: 0.95,
    });
    const dangerOffset = defineBalanceEntry({
      ...OUTCOME_BALANCE.reviewFreezeDangerOffset,
      value: 4,
    });

    expect(validateBalanceRegistry([peak, watchRatio, dangerOffset])).toContainEqual(
      expect.objectContaining({
        code: 'related-range-inverted',
        id: OUTCOME_BALANCE.reviewFreezeWatchRatio.id,
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
    CARD_BALANCE.handSize,
    CARD_BALANCE.draftCandidateCount,
    CARD_BALANCE.draftMulliganMaxAttempts,
    CARD_BALANCE.playFocusCostMinimum,
    SPRINT_BALANCE.gradePenaltyRework,
    SPRINT_BALANCE.gradePenaltyIncident,
    SPRINT_BALANCE.gradePenaltySpread,
    SPRINT_BALANCE.gradePenaltyHpLossFree,
    SPRINT_BALANCE.titleSpreadMinimum,
    SPRINT_BALANCE.titleSeniorBurnoutHpLoss,
    SPRINT_BALANCE.titleReviewHellQueueMax,
    SPRINT_BALANCE.titleReviewHellAiPct,
    SPRINT_BALANCE.titleFirefighterContains,
    SPRINT_BALANCE.titleFirefighterIncidents,
    SPRINT_BALANCE.titleUnstableIncidents,
    SPRINT_BALANCE.titleHealthyReworkMax,
    SPRINT_BALANCE.titleHealthyIncidentMax,
    SPRINT_BALANCE.titleComboMasterMin,
    SPRINT_BALANCE.titleNoOvertimeHpLossMax,
    SPRINT_BALANCE.titleNoOvertimeIncidentMax,
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
    {
      minimum: ACTION_BALANCE.firefightHpCostMaximum,
      maximum: ACTION_BALANCE.firefightLightHpCost,
      invertedMinimum: 12,
      invertedMaximum: 11,
    },
    {
      minimum: ACTION_BALANCE.assignTaskIdealMoraleMinimum,
      maximum: ACTION_BALANCE.assignTaskMoraleCost,
      invertedMinimum: 4,
      invertedMaximum: 3,
    },
    {
      minimum: CARD_BALANCE.effectMultiplierMinimum,
      maximum: CARD_BALANCE.effectMultiplierMaximum,
      invertedMinimum: 0.8,
      invertedMaximum: 0.7,
    },
    {
      minimum: CARD_BALANCE.effectReworkRateAddMinimum,
      maximum: CARD_BALANCE.effectReworkRateAddMaximum,
      invertedMinimum: 0.1,
      invertedMaximum: 0,
    },
    {
      minimum: CARD_BALANCE.effectAdditiveMinimum,
      maximum: CARD_BALANCE.effectAdditiveMaximum,
      invertedMinimum: 10,
      invertedMaximum: 9,
    },
    {
      minimum: SPRINT_BALANCE.stabilizingBonusPerGrant,
      maximum: SPRINT_BALANCE.stabilizingBonusCap,
      invertedMinimum: 0.02,
      invertedMaximum: 0.01,
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

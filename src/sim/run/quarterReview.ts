/**
 * 四半期レビューと目標修正（SPEC 第4.6.1 / 第10章 / 第15章）。
 *
 * ボス突破可否・KPI 達成度・信頼・継続リソースから outcome を決定論で算出し、
 * 目標修正の効果・代償を純関数で適用する。
 */
import { getBoss, type BossDef } from '../../data/bosses';
import { OUTCOME_BALANCE } from '../../data/balance';
import { allGoalAdjustmentIds, getGoalAdjustment } from '../../data/goalAdjustments';
import type { GoalAdjustmentDef, GoalNextQuarterEffects } from '../../data/goalAdjustments';
import { deriveTeamCapacities } from '../orgscale/teamState';
import type { TeamRunState } from '../orgscale/types';
import type { CardEffects, OrgState } from '../types';
import { SPRINTS_PER_QUARTER } from './constants';
import { pickQuarterBossId } from './quarterBoss';
import type {
  DifficultyId,
  GoalAdjustmentId,
  GoalKpiProgress,
  LoseReason,
  QuarterGoal,
  QuarterOutcome,
  QuarterReview,
  RunTotals,
  StakeholderTrust,
} from './types';
import { clamp } from '../clamp';

/** 組織再編（reorgReset）時の即時 org 効果加算。 */
export const REORG_RESET_SENIOR_HP = OUTCOME_BALANCE.reorgSeniorHpRecovery.value;
export const REORG_RESET_TECH_DEBT = -OUTCOME_BALANCE.reorgTechDebtRecovery.value;

/** pauseAiDebuff 適用時の出荷速度倍率（次四半期）。 */
export const PAUSE_AI_DEBUFF_MUL = 0.85;

/**
 * 次四半期に適用する物理効果を解決する（RI-83）。
 * `pauseAiDebuff` は出荷速度倍率へ畳み込む。
 */
export function resolveNextQuarterEffects(def: GoalAdjustmentDef): GoalNextQuarterEffects {
  const out: GoalNextQuarterEffects = { ...def.nextQuarterEffects };
  if (def.pauseAiDebuff) {
    // 出荷速度は codingSpeedMul のみ。routine にも同じ倍率を入れると定型で二重乗算になる。
    out.codingSpeedMul = (out.codingSpeedMul ?? 1) * PAUSE_AI_DEBUFF_MUL;
  }
  return out;
}

/** 定義に次四半期キャリーオーバーがあるか。 */
export function hasNextQuarterCarryover(def: GoalAdjustmentDef): boolean {
  return Object.keys(resolveNextQuarterEffects(def)).length > 0;
}

/**
 * アクティブな目標修正キャリーオーバーを CardEffects へ合成する（RI-83）。
 * 四半期不一致・未知 ID では入力をそのまま返す。
 * org 継続差分（techDebt / seniorHp）は `applyGoalCarryoverOrgTick` 側。
 */
export function applyGoalCarryoverToEffects(
  effects: CardEffects,
  carryoverId: GoalAdjustmentId | null,
  carryoverQuarter: number | null,
  quarterNumber: number,
): CardEffects {
  if (carryoverId === null || carryoverQuarter !== quarterNumber) return effects;
  const def = getGoalAdjustment(carryoverId);
  if (!def) return effects;
  const partial = resolveNextQuarterEffects(def);
  const hasCardEffects =
    partial.codingSpeedMul !== undefined ||
    partial.routineSpeedMul !== undefined ||
    partial.reviewEfficiencyMul !== undefined ||
    partial.reviewCapacityMul !== undefined ||
    partial.reworkRateAdd !== undefined ||
    partial.incidentRateMul !== undefined;
  if (!hasCardEffects) return effects;
  return {
    ...effects,
    codingSpeedMul: effects.codingSpeedMul * (partial.codingSpeedMul ?? 1),
    routineSpeedMul: effects.routineSpeedMul * (partial.routineSpeedMul ?? 1),
    reviewEfficiencyMul: effects.reviewEfficiencyMul * (partial.reviewEfficiencyMul ?? 1),
    reviewCapacityMul: effects.reviewCapacityMul * (partial.reviewCapacityMul ?? 1),
    reworkRateAdd: effects.reworkRateAdd + (partial.reworkRateAdd ?? 0),
    incidentRateMul: effects.incidentRateMul * (partial.incidentRateMul ?? 1),
    // qualityAdd は applyGoalCarryoverOrgTick で org へ適用する（二重適用を避ける）。
  };
}

/**
 * 次四半期キャリーオーバーに org 継続差分があるか（RI-83）。
 * アクティブチーム値が飽和して実値が変わらなくても、他チーム更新の判定に使う。
 */
export function hasGoalCarryoverOrgDelta(
  carryoverId: GoalAdjustmentId | null,
  carryoverQuarter: number | null,
  quarterNumber: number,
): boolean {
  if (carryoverId === null || carryoverQuarter !== quarterNumber) return false;
  const def = getGoalAdjustment(carryoverId);
  if (!def) return false;
  const partial = resolveNextQuarterEffects(def);
  return (
    (partial.techDebtDelta !== undefined && partial.techDebtDelta !== 0) ||
    (partial.seniorHpDelta !== undefined && partial.seniorHpDelta !== 0) ||
    (partial.qualityAdd !== undefined && partial.qualityAdd !== 0)
  );
}

/**
 * スプリント開始時に目標修正キャリーオーバーの org 継続差分を適用する（RI-83）。
 * `qualityAdd` も CardEffects に残さずここで組織値へ焼き込む（stepSprint は参照しない）。
 */
export function applyGoalCarryoverOrgTick(
  org: OrgState,
  carryoverId: GoalAdjustmentId | null,
  carryoverQuarter: number | null,
  quarterNumber: number,
): OrgState {
  if (carryoverId === null || carryoverQuarter !== quarterNumber) return org;
  const def = getGoalAdjustment(carryoverId);
  if (!def) return org;
  const partial = resolveNextQuarterEffects(def);
  let next = org;
  if (partial.techDebtDelta !== undefined && partial.techDebtDelta !== 0) {
    next = { ...next, techDebt: Math.max(0, next.techDebt + partial.techDebtDelta) };
  }
  if (partial.seniorHpDelta !== undefined && partial.seniorHpDelta !== 0) {
    next = { ...next, seniorHp: clamp(next.seniorHp + partial.seniorHpDelta, 0, 100) };
  }
  if (partial.qualityAdd !== undefined && partial.qualityAdd !== 0) {
    next = { ...next, quality: clamp(next.quality + partial.qualityAdd, 0, 100) };
  }
  return next;
}

/**
 * ボス突破床（1スプリント）に対する通常スループット比（RI-68）。
 * playtest 実測の 1スプリント出荷（約250〜400）と minSprintDelivered（約40〜90）から設定。
 */
export const QUARTER_DELIVERY_THROUGHPUT_MUL =
  OUTCOME_BALANCE.quarterDeliveryThroughputMultiplier.value;

/** 1スプリント床 → 四半期累計目標への換算係数（下限・目標修正の基準）。 */
export const QUARTER_DELIVERY_SCALE = SPRINTS_PER_QUARTER * QUARTER_DELIVERY_THROUGHPUT_MUL;

/** 四半期のうち通常スプリント本数（最終1本がボス）。 */
export const NORMAL_SPRINTS_PER_QUARTER = SPRINTS_PER_QUARTER - 1;

/** 通常スプリントの Delivery 床（ボス種別によらない基準）。 */
export const BASELINE_SPRINT_DELIVERY_FLOOR =
  OUTCOME_BALANCE.quarterDeliveryBaselineSprintFloor.value;

/** 新規四半期目標の Delivery 下限（旧 30 を四半期累計スケールへ）。 */
export const MIN_QUARTER_DELIVERY_TARGET =
  OUTCOME_BALANCE.quarterDeliveryMinimumTargetScale.value * QUARTER_DELIVERY_SCALE;

/**
 * priorGoal 減衰時の Delivery 下限。
 * 緩和の積み重ねでも代表的な四半期実績帯（約2000〜2500）の半分付近を下回らないようにする。
 */
export const MIN_PRIOR_QUARTER_DELIVERY_TARGET = Math.round(
  BASELINE_SPRINT_DELIVERY_FLOOR *
    SPRINTS_PER_QUARTER *
    QUARTER_DELIVERY_THROUGHPUT_MUL *
    OUTCOME_BALANCE.quarterDeliveryPriorMinimumFloorFactor.value,
);

/** priorGoal 引き継ぎ時の Delivery 減衰（`buildQuarterGoal` と同じ）。 */
export const PRIOR_GOAL_DELIVERY_DECAY = OUTCOME_BALANCE.quarterDeliveryPriorDecay.value;

/**
 * 目標修正適用後の Delivery 下限。
 * prior 下限と同じにして「緩和 → 次期開始で戻る」の見かけ差をなくす。
 */
export const MIN_ADJUSTED_QUARTER_DELIVERY_TARGET = MIN_PRIOR_QUARTER_DELIVERY_TARGET;

/**
 * 難易度別の四半期 Delivery 目標倍率（RI-68）。
 * `bossTargetMul * taskCountMul` は Easy で目標を縮めすぎ・Hard で上げすぎになり、
 * 組織プリセットのスループット差と二重に効いて達成分岐が潰れる。
 * skilled 実測（実績/目標の中央付近が met 帯 ≈1.0）に合わせて独立校正する。
 */
export const QUARTER_DELIVERY_GOAL_MUL: Record<DifficultyId, number> = {
  // RI-75/RI-84/RI-77: AI 出荷価値倍率後の skilled 実績に合わせ再校正。
  // 難易度ごとに達成と未達が両立する帯を保つ。
  // RI-73/F-7 は Delivery 倍率ではなく seniorHpCostMul で勝率帯を作る（目標分岐を壊さない）。
  easy: OUTCOME_BALANCE.quarterGoalMultiplierEasy.value,
  normal: OUTCOME_BALANCE.quarterGoalMultiplierNormal.value,
  hard: OUTCOME_BALANCE.quarterGoalMultiplierHard.value,
  nightmare: OUTCOME_BALANCE.quarterGoalMultiplierNightmare.value,
};

/** 難易度に応じた初期信頼。 */
export function buildInitialTrust(difficulty: DifficultyId): StakeholderTrust {
  const base = {
    easy: OUTCOME_BALANCE.quarterInitialTrustEasy.value,
    normal: OUTCOME_BALANCE.quarterInitialTrustNormal.value,
    hard: OUTCOME_BALANCE.quarterInitialTrustHard.value,
    nightmare: OUTCOME_BALANCE.quarterInitialTrustNightmare.value,
  }[difficulty];
  return {
    management: base,
    customers: base,
    team: Math.min(100, base + OUTCOME_BALANCE.quarterInitialTeamTrustBonus.value),
  };
}

/** ボス定義と難易度から四半期目標を生成する。 */
export function buildQuarterGoal(
  boss: BossDef,
  difficulty: DifficultyId,
  /** @deprecated Delivery 目標には使わない。呼び出し互換のため残す。 */
  _bossTargetMul: number,
  priorGoal?: QuarterGoal,
): QuarterGoal {
  const c = boss.clear;
  // RI-68: 通常5本は共通床、ボス1本だけ minSprintDelivered を使う（ボス床を6本分に掛けない）。
  // Delivery 目標倍率は難易度別定数。ボス突破側の bossTargetMul / taskCountMul とは分離する。
  const scale = QUARTER_DELIVERY_GOAL_MUL[difficulty];
  const baselineFloor = BASELINE_SPRINT_DELIVERY_FLOOR * scale;
  const bossFloor = (c.minSprintDelivered ?? BASELINE_SPRINT_DELIVERY_FLOOR) * scale;
  const quarterFloor = baselineFloor * NORMAL_SPRINTS_PER_QUARTER + bossFloor;
  const goal: QuarterGoal = {
    deliveryTarget: Math.max(
      MIN_QUARTER_DELIVERY_TARGET,
      Math.round(quarterFloor * QUARTER_DELIVERY_THROUGHPUT_MUL),
    ),
    qualityTarget: c.minQuality ?? OUTCOME_BALANCE.quarterGoalDefaultQuality.value,
    techDebtLimit: c.maxTechDebt ?? OUTCOME_BALANCE.quarterGoalDefaultTechDebtLimit.value,
    moraleTarget: c.minMorale ?? OUTCOME_BALANCE.quarterGoalDefaultMorale.value,
    incidentLimit:
      c.maxSpread !== undefined
        ? c.maxSpread + OUTCOME_BALANCE.quarterGoalIncidentHeadroom.value
        : OUTCOME_BALANCE.quarterGoalDefaultIncidentLimit.value,
  };
  if (c.minAiPct !== undefined) goal.aiAdoptionTarget = c.minAiPct;

  if (priorGoal) {
    goal.deliveryTarget = Math.max(
      MIN_PRIOR_QUARTER_DELIVERY_TARGET,
      Math.round(priorGoal.deliveryTarget * PRIOR_GOAL_DELIVERY_DECAY),
    );
    goal.qualityTarget = priorGoal.qualityTarget;
    goal.techDebtLimit = priorGoal.techDebtLimit;
    goal.moraleTarget = priorGoal.moraleTarget;
    goal.incidentLimit = priorGoal.incidentLimit;
    if (priorGoal.aiAdoptionTarget !== undefined) {
      goal.aiAdoptionTarget = priorGoal.aiAdoptionTarget;
    }
  }
  return goal;
}

export interface MeasureInput {
  goal: QuarterGoal;
  org: OrgState;
  totals: RunTotals;
}

/** KPI ごとの達成状況を測定する。 */
export function measureGoalProgress(input: MeasureInput): GoalKpiProgress[] {
  const { goal, org, totals } = input;
  const completed = Math.max(1, totals.completed);
  const aiPct = Math.round((totals.aiAssisted / completed) * 100);

  const kpis: GoalKpiProgress[] = [
    {
      id: 'delivery',
      label: 'Delivery（四半期累計）',
      target: goal.deliveryTarget,
      actual: totals.delivered,
      status: goalProgressStatus(totals.delivered, goal.deliveryTarget, true),
    },
    {
      id: 'quality',
      label: 'Quality',
      target: goal.qualityTarget,
      actual: org.quality,
      status: goalProgressStatus(org.quality, goal.qualityTarget, true),
    },
    {
      id: 'techDebt',
      label: 'Tech Debt',
      target: goal.techDebtLimit,
      actual: org.techDebt,
      status: goalProgressStatus(org.techDebt, goal.techDebtLimit, false),
    },
    {
      id: 'morale',
      label: 'Morale',
      target: goal.moraleTarget,
      actual: org.morale,
      status: goalProgressStatus(org.morale, goal.moraleTarget, true),
    },
    {
      id: 'incident',
      label: 'Incident',
      target: goal.incidentLimit,
      actual: totals.incidents,
      status: goalProgressStatus(totals.incidents, goal.incidentLimit, false),
    },
  ];

  if (goal.aiAdoptionTarget !== undefined) {
    kpis.push({
      id: 'aiAdoption',
      label: 'AI Adoption',
      target: goal.aiAdoptionTarget,
      actual: aiPct,
      status: goalProgressStatus(aiPct, goal.aiAdoptionTarget, true),
    });
  }
  return kpis;
}

/** 現行レビューとレガシーセーブ再判定で共有する KPI 境界判定。 */
export function goalProgressStatus(
  actual: number,
  target: number,
  higherIsBetter: boolean,
): GoalKpiProgress['status'] {
  if (higherIsBetter) {
    if (actual >= target * OUTCOME_BALANCE.kpiHigherExceededMultiplier.value) return 'exceeded';
    if (actual >= target) return 'met';
    return 'missed';
  }
  if (actual <= target * OUTCOME_BALANCE.kpiLowerExceededMultiplier.value) return 'exceeded';
  if (actual <= target) return 'met';
  return 'missed';
}

export interface DiagnoseInput {
  progress: GoalKpiProgress[];
  org: OrgState;
  totals: RunTotals;
  bossCleared: boolean;
}

const REASON_LABELS: Record<string, string> = {
  scopeOverload: 'スコープ過多: 出荷目標に対して Delivery が不足している。',
  reviewJam: 'レビュー詰まり: Review 待ち行列が限界に近づいた。',
  qualityIssue: '品質問題: Quality / Tech Debt が目標を下回っている。',
  aiAdoptionShortfall: 'AI Adoption 未達: 経営が求める AI 利用率に届いていない。',
  aiOverconfidence: 'AI 過信: AI 利用率は高いが手戻り・品質が追いついていない。',
  moraleDrop: '士気低下: Morale が目標を下回り、チームの持続力が弱い。',
  incidentSpiral: '障害連鎖: Incident が目標上限を超えた。',
  bossMiss: '外部評価未達: ボススプリントの突破条件を満たせなかった。',
};

/** 未達理由を診断メッセージとして返す。 */
export function diagnoseMissedReasons(input: DiagnoseInput): string[] {
  const reasons: string[] = [];
  const { progress, org, totals, bossCleared } = input;

  if (!bossCleared) reasons.push(REASON_LABELS.bossMiss);
  for (const kpi of progress) {
    if (kpi.status === 'missed') {
      if (kpi.id === 'delivery') reasons.push(REASON_LABELS.scopeOverload);
      if (kpi.id === 'quality' || kpi.id === 'techDebt') reasons.push(REASON_LABELS.qualityIssue);
      if (kpi.id === 'morale') reasons.push(REASON_LABELS.moraleDrop);
      if (kpi.id === 'incident') reasons.push(REASON_LABELS.incidentSpiral);
      if (kpi.id === 'aiAdoption') reasons.push(REASON_LABELS.aiAdoptionShortfall);
    }
  }
  if (totals.reviewQueuePeak >= OUTCOME_BALANCE.quarterMissedReasonReviewQueueMin.value) {
    reasons.push(REASON_LABELS.reviewJam);
  }
  if (
    org.aiDependency >= OUTCOME_BALANCE.quarterMissedReasonAiDependencyMin.value &&
    totals.rework / Math.max(1, totals.completed) >
      OUTCOME_BALANCE.quarterMissedReasonAiReworkRatioMin.value
  ) {
    reasons.push(REASON_LABELS.aiOverconfidence);
  }
  return Array.from(new Set(reasons));
}

export interface OutcomeInput {
  bossCleared: boolean;
  progress: GoalKpiProgress[];
  trust: StakeholderTrust;
  org: OrgState;
  budget: number;
  quarterNumber: number;
}

/** 四半期 outcome を決定論で算出する。 */
export function evaluateQuarterOutcome(input: OutcomeInput): QuarterOutcome {
  const { bossCleared, progress, trust, org, budget, quarterNumber } = input;
  const missedCount = progress.filter((p) => p.status === 'missed').length;
  const minTrust = Math.min(trust.management, trust.customers, trust.team);

  if (bossCleared) {
    const allExceeded = progress.every((p) => p.status === 'exceeded');
    const allMet = progress.every((p) => p.status !== 'missed');
    if (allExceeded) return 'exceeded';
    if (allMet) return 'met';
  }

  if (
    minTrust <= OUTCOME_BALANCE.quarterShutdownTrustMax.value ||
    (budget <= OUTCOME_BALANCE.quarterShutdownBudgetMax.value &&
      org.morale <= OUTCOME_BALANCE.quarterShutdownBudgetMoraleMax.value) ||
    (org.seniorHp <= OUTCOME_BALANCE.quarterShutdownSeniorHpMax.value &&
      missedCount >= OUTCOME_BALANCE.quarterShutdownMissedKpiMin.value)
  ) {
    return 'shutdown';
  }
  if (
    quarterNumber >= OUTCOME_BALANCE.quarterReorgMinQuarter.value &&
    missedCount >= OUTCOME_BALANCE.quarterReorgMissedKpiMin.value
  ) {
    return 'reorg_required';
  }
  if (
    minTrust <= OUTCOME_BALANCE.quarterReorgTrustMax.value &&
    missedCount >= OUTCOME_BALANCE.quarterReorgTrustMissedKpiMin.value
  ) {
    return 'reorg_required';
  }
  if (
    minTrust <= OUTCOME_BALANCE.quarterCrisisTrustMax.value ||
    budget <= OUTCOME_BALANCE.quarterCrisisBudgetMax.value ||
    missedCount >= OUTCOME_BALANCE.quarterCrisisMissedKpiMin.value
  ) {
    return 'missed_crisis';
  }
  return 'missed_adjustable';
}

/** 目標修正適用後の org 状態をシミュレートする（ハード敗北フィルタ用）。 */
function orgAfterAdjustment(org: OrgState, def: GoalAdjustmentDef): OrgState {
  const next = { ...org };
  if (def.orgEffects?.moraleDelta !== undefined) {
    next.morale = clamp(next.morale + def.orgEffects.moraleDelta, 0, 100);
  }
  if (def.orgEffects?.seniorHpDelta !== undefined) {
    next.seniorHp = clamp(next.seniorHp + def.orgEffects.seniorHpDelta, 0, 100);
  }
  if (def.orgEffects?.techDebtDelta !== undefined) {
    next.techDebt = Math.max(0, next.techDebt + def.orgEffects.techDebtDelta);
  }
  if (def.reorgReset) {
    next.seniorHp = clamp(next.seniorHp + REORG_RESET_SENIOR_HP, 0, 100);
    next.techDebt = Math.max(0, next.techDebt + REORG_RESET_TECH_DEBT);
  }
  return next;
}

function wouldHardLose(org: OrgState, totals: RunTotals): boolean {
  if (org.seniorHp <= OUTCOME_BALANCE.loseSeniorHpMax.value) return true;
  if (org.morale <= OUTCOME_BALANCE.loseMoraleMax.value) return true;
  if (org.techDebt >= OUTCOME_BALANCE.loseTechDebtCap.value) return true;
  if (totals.reviewQueuePeak >= OUTCOME_BALANCE.loseReviewFreezePeak.value) return true;
  return false;
}

/** outcome に応じて提示する目標修正を決める。 */
export function availableAdjustments(
  outcome: QuarterOutcome,
  trust: StakeholderTrust,
  budget: number,
  org: OrgState,
  totals: RunTotals,
): GoalAdjustmentId[] {
  if (outcome !== 'missed_adjustable') return [];
  return allGoalAdjustmentIds().filter((id) => {
    const def = getGoalAdjustment(id);
    if (!def) return false;
    const nextManagement = clamp(trust.management + (def.trustDelta.management ?? 0), 0, 100);
    const nextCustomers = clamp(trust.customers + (def.trustDelta.customers ?? 0), 0, 100);
    const nextTeam = clamp(trust.team + (def.trustDelta.team ?? 0), 0, 100);
    const nextBudget = budget + def.budgetDelta;
    if (
      nextCustomers < OUTCOME_BALANCE.quarterAdjustmentMinimumTrust.value ||
      nextManagement < OUTCOME_BALANCE.quarterAdjustmentMinimumTrust.value ||
      nextTeam < OUTCOME_BALANCE.quarterAdjustmentMinimumTrust.value
    ) {
      return false;
    }
    // 危機閾値（evaluateQuarterOutcome の minTrust<=15）と揃える。
    if (
      Math.min(nextManagement, nextCustomers, nextTeam) <=
      OUTCOME_BALANCE.quarterCrisisTrustMax.value
    ) {
      return false;
    }
    if (nextBudget <= OUTCOME_BALANCE.quarterCrisisBudgetMax.value) return false;
    if (wouldHardLose(orgAfterAdjustment(org, def), totals)) return false;
    return true;
  });
}

/** 目標修正の Delivery 効果だけを適用する（下限付き）。 */
export function applyDeliveryGoalEffects(
  currentDeliveryTarget: number,
  goalEffects: GoalAdjustmentDef['goalEffects'],
): number {
  let next = currentDeliveryTarget;
  if (goalEffects.deliveryMul !== undefined) {
    next = Math.max(
      MIN_ADJUSTED_QUARTER_DELIVERY_TARGET,
      Math.round(next * goalEffects.deliveryMul),
    );
  }
  if (goalEffects.deliveryAdd !== undefined) {
    next = Math.max(MIN_ADJUSTED_QUARTER_DELIVERY_TARGET, next + goalEffects.deliveryAdd);
  }
  return next;
}

/**
 * 目標修正の goalEffects を四半期目標へ適用する（RI-131）。
 * org / 信頼 / 予算は触らず、`applyGoalAdjustment` と見通し投影が同じ式を使う。
 */
export function applyGoalEffectsToGoal(goal: QuarterGoal, def: GoalAdjustmentDef): QuarterGoal {
  const ge = def.goalEffects;
  const next: QuarterGoal = {
    ...goal,
    deliveryTarget: applyDeliveryGoalEffects(goal.deliveryTarget, ge),
  };
  if (ge.qualityAdd !== undefined) next.qualityTarget = goal.qualityTarget + ge.qualityAdd;
  if (ge.moraleAdd !== undefined) next.moraleTarget = goal.moraleTarget + ge.moraleAdd;
  if (ge.techDebtLimitAdd !== undefined)
    next.techDebtLimit = goal.techDebtLimit + ge.techDebtLimitAdd;
  if (ge.incidentLimitAdd !== undefined)
    next.incidentLimit = goal.incidentLimit + ge.incidentLimitAdd;
  if (ge.aiAdoptionAdd !== undefined && goal.aiAdoptionTarget !== undefined) {
    next.aiAdoptionTarget = Math.max(0, goal.aiAdoptionTarget + ge.aiAdoptionAdd);
  }
  return next;
}

/**
 * 次四半期開始時の priorGoal 減衰（RI-131）。
 * Delivery だけ減衰し、他 KPI はコピーする。次ボスからの再生成はしない。
 */
export function decayGoalFromPrior(prior: QuarterGoal): QuarterGoal {
  const next: QuarterGoal = {
    ...prior,
    deliveryTarget: Math.max(
      MIN_PRIOR_QUARTER_DELIVERY_TARGET,
      Math.round(prior.deliveryTarget * PRIOR_GOAL_DELIVERY_DECAY),
    ),
  };
  if (prior.aiAdoptionTarget === undefined) delete next.aiAdoptionTarget;
  return next;
}

export interface ForwardGoals {
  /** 次四半期（Q+1）の見通し目標。 */
  next: QuarterGoal;
  /** その次（Q+2）の見通し目標。再減衰のみで物理キャリーは載せない。 */
  following: QuarterGoal;
}

export interface ForwardGoalContext {
  seed: string;
  difficulty: DifficultyId;
  /** 今四半期番号（1 起点）。Q+1 / Q+2 のボス抽選に使う。 */
  fromQuarter: number;
}

/**
 * 今四半期より先の目標見通し（RI-131）。
 * `def` があるときはその goalEffects を載せる。拘束力は持たない。
 * `ctx` があるときは次ボス抽選＋ `buildQuarterGoal(..., prior)` と同じ導出。
 */
export function projectForwardGoals(
  current: QuarterGoal,
  def?: GoalAdjustmentDef,
  ctx?: ForwardGoalContext,
): ForwardGoals {
  const adjusted = def ? applyGoalEffectsToGoal(current, def) : current;
  if (!ctx) {
    const next = decayGoalFromPrior(adjusted);
    const following = decayGoalFromPrior(next);
    return { next, following };
  }
  const nextBoss = getBoss(pickQuarterBossId(ctx.seed, ctx.fromQuarter + 1));
  const followingBoss = getBoss(pickQuarterBossId(ctx.seed, ctx.fromQuarter + 2));
  const next = nextBoss
    ? buildQuarterGoal(nextBoss, ctx.difficulty, 1, adjusted)
    : decayGoalFromPrior(adjusted);
  const following = followingBoss
    ? buildQuarterGoal(followingBoss, ctx.difficulty, 1, next)
    : decayGoalFromPrior(next);
  return { next, following };
}

/**
 * 目標修正選択後に次四半期へ持ち越される Delivery 目標のプレビュー（RI-68）。
 * 適用時下限と prior 減衰下限の両方を反映する。
 */
export function previewNextQuarterDeliveryTarget(
  currentDeliveryTarget: number,
  def: GoalAdjustmentDef,
): number {
  return decayGoalFromPrior({
    deliveryTarget: applyDeliveryGoalEffects(currentDeliveryTarget, def.goalEffects),
    qualityTarget: 0,
    techDebtLimit: 0,
    moraleTarget: 0,
    incidentLimit: 0,
  }).deliveryTarget;
}

export interface BuildReviewInput {
  goal: QuarterGoal;
  org: OrgState;
  totals: RunTotals;
  trust: StakeholderTrust;
  budget: number;
  quarterNumber: number;
  /** ボススプリント単体の突破可否（evaluateBoss）。 */
  bossSprintCleared: boolean;
}

/** 四半期レビューの完全スナップショットを構築する。 */
export function buildQuarterReview(input: BuildReviewInput): QuarterReview {
  const progress = measureGoalProgress({ goal: input.goal, org: input.org, totals: input.totals });
  const bossCleared = input.bossSprintCleared;
  const outcome = evaluateQuarterOutcome({
    bossCleared,
    progress,
    trust: input.trust,
    org: input.org,
    budget: input.budget,
    quarterNumber: input.quarterNumber,
  });
  let finalOutcome = outcome;
  const adjustments = availableAdjustments(
    outcome,
    input.trust,
    input.budget,
    input.org,
    input.totals,
  );
  // 修正可能でも安全性フィルタで提示手段が空なら継続不能へ落とす。
  // これは「選択肢を使い切った」ではなく一時的に実行可能な候補が無い状態なので、
  // loseReason は missed_crisis と同じ原因分解（RI-79）へ回す。
  if (finalOutcome === 'missed_adjustable' && adjustments.length === 0) {
    finalOutcome = 'missed_crisis';
  }

  const missedReasons =
    finalOutcome === 'exceeded' || finalOutcome === 'met'
      ? []
      : diagnoseMissedReasons({
          progress,
          org: input.org,
          totals: input.totals,
          bossCleared,
        });

  return {
    goal: input.goal,
    outcome: finalOutcome,
    trust: { ...input.trust },
    progress,
    missedReasons,
    availableAdjustments: finalOutcome === 'missed_adjustable' ? adjustments : [],
    bossCleared,
  };
}

export interface ApplyAdjustmentInput {
  goal: QuarterGoal;
  trust: StakeholderTrust;
  org: OrgState;
  budget: number;
  goalAdjustmentsTaken: GoalAdjustmentId[];
  nextBudgetCap: number | null;
}

export interface ApplyAdjustmentResult {
  goal: QuarterGoal;
  trust: StakeholderTrust;
  org: OrgState;
  budget: number;
  goalAdjustmentsTaken: GoalAdjustmentId[];
  nextBudgetCap: number | null;
  pauseAiDebuff: boolean;
}

/** 目標修正の効果と代償を決定論で適用する。 */
export function applyGoalAdjustment(
  input: ApplyAdjustmentInput,
  adjustmentId: GoalAdjustmentId,
): ApplyAdjustmentResult {
  const def = getGoalAdjustment(adjustmentId);
  if (!def) return { ...input, pauseAiDebuff: false };

  const trust: StakeholderTrust = {
    management: clamp(input.trust.management + (def.trustDelta.management ?? 0), 0, 100),
    customers: clamp(input.trust.customers + (def.trustDelta.customers ?? 0), 0, 100),
    team: clamp(input.trust.team + (def.trustDelta.team ?? 0), 0, 100),
  };

  const goal = applyGoalEffectsToGoal(input.goal, def);

  const org = { ...input.org };
  if (def.orgEffects?.deliveryScoreMul !== undefined) {
    org.deliveryScore = Math.round(org.deliveryScore * def.orgEffects.deliveryScoreMul);
  }
  if (def.orgEffects?.techDebtDelta !== undefined) {
    org.techDebt = Math.max(0, org.techDebt + def.orgEffects.techDebtDelta);
  }
  if (def.orgEffects?.moraleDelta !== undefined) {
    org.morale = clamp(org.morale + def.orgEffects.moraleDelta, 0, 100);
  }
  if (def.orgEffects?.seniorHpDelta !== undefined) {
    org.seniorHp = clamp(org.seniorHp + def.orgEffects.seniorHpDelta, 0, 100);
  }
  if (def.orgEffects?.qualityDelta !== undefined) {
    org.quality = clamp(org.quality + def.orgEffects.qualityDelta, 0, 100);
  }
  if (def.reorgReset) {
    org.seniorHp = clamp(org.seniorHp + REORG_RESET_SENIOR_HP, 0, 100);
    org.techDebt = Math.max(0, org.techDebt + REORG_RESET_TECH_DEBT);
  }

  let nextBudgetCap = input.nextBudgetCap;
  if (def.nextBudgetCapDelta !== undefined) {
    const base = nextBudgetCap ?? input.budget;
    nextBudgetCap = Math.max(10, base + def.nextBudgetCapDelta);
  }

  return {
    goal,
    trust,
    org,
    budget: Math.max(0, input.budget + def.budgetDelta),
    goalAdjustmentsTaken: [...input.goalAdjustmentsTaken, adjustmentId],
    nextBudgetCap,
    pauseAiDebuff: !!def.pauseAiDebuff,
  };
}

/**
 * 目標修正の org 効果を 1 チーム正本へ焼き込む（RI-64）。
 * `applyGoalAdjustment` と同じ差分を、切替後も失われないよう全チームへ適用する。
 */
export function applyGoalOrgEffectsToTeam(
  team: TeamRunState,
  def: GoalAdjustmentDef,
): TeamRunState {
  let next: TeamRunState = { ...team };
  if (def.orgEffects?.deliveryScoreMul !== undefined) {
    next = {
      ...next,
      shipping: Math.round(next.shipping * def.orgEffects.deliveryScoreMul),
    };
  }
  if (def.orgEffects?.techDebtDelta !== undefined) {
    next = { ...next, techDebt: Math.max(0, next.techDebt + def.orgEffects.techDebtDelta) };
  }
  if (def.orgEffects?.moraleDelta !== undefined) {
    next = { ...next, morale: clamp(next.morale + def.orgEffects.moraleDelta, 0, 100) };
  }
  if (def.orgEffects?.seniorHpDelta !== undefined) {
    next = { ...next, seniorHp: clamp(next.seniorHp + def.orgEffects.seniorHpDelta, 0, 100) };
  }
  if (def.orgEffects?.qualityDelta !== undefined) {
    next = { ...next, quality: clamp(next.quality + def.orgEffects.qualityDelta, 0, 100) };
  }
  if (def.reorgReset) {
    next = {
      ...next,
      seniorHp: clamp(next.seniorHp + REORG_RESET_SENIOR_HP, 0, 100),
      techDebt: Math.max(0, next.techDebt + REORG_RESET_TECH_DEBT),
    };
  }
  return { ...next, ...deriveTeamCapacities(next) };
}

/** outcome がラン継続（目標修正）可能か。 */
export function canChooseAdjustment(outcome: QuarterOutcome): boolean {
  return outcome === 'missed_adjustable';
}

/** outcome が勝利確定（レビュー承認）可能か。 */
export function canAcknowledgeWin(outcome: QuarterOutcome): boolean {
  return outcome === 'exceeded' || outcome === 'met';
}

/** outcome が継続不能（ラン終了）か。 */
export function isTerminalFailure(outcome: QuarterOutcome): boolean {
  return outcome === 'shutdown' || outcome === 'reorg_required' || outcome === 'missed_crisis';
}

/** 継続不能時の loseReason 分解に使う観測値（RI-79）。 */
export type LoseReasonOutcomeInput = Pick<
  OutcomeInput,
  'trust' | 'org' | 'budget' | 'progress' | 'quarterNumber'
> & {
  /** 空候補降格時のハード敗北（レビュー凍結）判定用。 */
  totals?: Pick<RunTotals, 'reviewQueuePeak'>;
};

/** 安全性フィルタと同じハード敗北条件を loseReason へ写す。 */
function hardLoseReasonFromOrg(
  org: OrgState,
  totals?: Pick<RunTotals, 'reviewQueuePeak'>,
): LoseReason | null {
  if (org.seniorHp <= OUTCOME_BALANCE.loseSeniorHpMax.value) return 'seniorBurnout';
  if (org.morale <= OUTCOME_BALANCE.loseMoraleMax.value) return 'moraleCollapse';
  if (org.techDebt >= OUTCOME_BALANCE.loseTechDebtCap.value) return 'techDebt';
  if ((totals?.reviewQueuePeak ?? 0) >= OUTCOME_BALANCE.loseReviewFreezePeak.value) {
    return 'reviewFreeze';
  }
  return null;
}

/**
 * 継続不能時の loseReason。
 * `evaluateQuarterOutcome` と同じ優先順で発火条件をラベルへ反映する（RI-79）。
 * 非継続不能 outcome や入力欠落時は後方互換のフォールバックを返す。
 */
export function loseReasonForOutcome(
  outcome: QuarterOutcome,
  input?: LoseReasonOutcomeInput,
): LoseReason {
  if (outcome === 'reorg_required') return 'reorgRequired';
  if (!isTerminalFailure(outcome) || !input) return 'trustExhausted';

  const missedCount = input.progress.filter((p) => p.status === 'missed').length;
  const minTrust = Math.min(input.trust.management, input.trust.customers, input.trust.team);
  const hard = hardLoseReasonFromOrg(input.org, input.totals);

  if (outcome === 'shutdown') {
    if (minTrust <= OUTCOME_BALANCE.quarterShutdownTrustMax.value) return 'trustExhausted';
    if (
      input.budget <= OUTCOME_BALANCE.quarterShutdownBudgetMax.value &&
      input.org.morale <= OUTCOME_BALANCE.quarterShutdownBudgetMoraleMax.value
    ) {
      return 'budgetExhausted';
    }
    if (
      input.org.seniorHp <= OUTCOME_BALANCE.quarterShutdownSeniorHpMax.value &&
      missedCount >= OUTCOME_BALANCE.quarterShutdownMissedKpiMin.value
    ) {
      return 'seniorBurnout';
    }
    return hard ?? 'trustExhausted';
  }

  // missed_crisis（空候補からの降格を含む）: ハード敗北条件を信頼フォールバックより先に見る。
  if (hard) return hard;
  if (minTrust <= OUTCOME_BALANCE.quarterCrisisTrustMax.value) return 'trustExhausted';
  if (input.budget <= OUTCOME_BALANCE.loseBudgetMax.value) return 'budgetExhausted';
  if (missedCount >= OUTCOME_BALANCE.quarterCrisisMissedKpiMin.value) return 'kpiMissed';
  // 空候補降格などで上記条件が全て非該当の場合も trustExhausted より kpiMissed が実態に近い。
  return 'kpiMissed';
}

export const OUTCOME_LABELS: Record<QuarterOutcome, string> = {
  exceeded: '超過達成',
  met: '目標達成',
  missed_adjustable: '未達（修正可能）',
  missed_crisis: '深刻な未達',
  reorg_required: '組織再編が必要',
  shutdown: '継続不能',
};

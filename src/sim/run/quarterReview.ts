/**
 * 四半期レビューと目標修正（SPEC 第4.6.1 / 第10章 / 第15章）。
 *
 * ボス突破可否・KPI 達成度・信頼・継続リソースから outcome を決定論で算出し、
 * 目標修正の効果・代償を純関数で適用する。
 */
import type { BossDef } from '../../data/bosses';
import { allGoalAdjustmentIds, getGoalAdjustment } from '../../data/goalAdjustments';
import type { GoalAdjustmentDef } from '../../data/goalAdjustments';
import { deriveTeamCapacities } from '../orgscale/teamState';
import type { TeamRunState } from '../orgscale/types';
import { TECH_DEBT_CAP, REVIEW_FREEZE_PEAK } from '../outcome';
import type { OrgState } from '../types';
import { SPRINTS_PER_QUARTER } from './constants';
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

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** 組織再編（reorgReset）時の即時 org 効果加算。 */
export const REORG_RESET_SENIOR_HP = 20;
export const REORG_RESET_TECH_DEBT = -8;

/** pauseAiDebuff 適用時の出荷速度倍率（次四半期）。 */
export const PAUSE_AI_DEBUFF_MUL = 0.85;

/**
 * ボス突破床（1スプリント）に対する通常スループット比（RI-68）。
 * playtest 実測の 1スプリント出荷（約250〜400）と minSprintDelivered（約40〜90）から設定。
 */
export const QUARTER_DELIVERY_THROUGHPUT_MUL = 5;

/** 1スプリント床 → 四半期累計目標への換算係数（下限・目標修正の基準）。 */
export const QUARTER_DELIVERY_SCALE = SPRINTS_PER_QUARTER * QUARTER_DELIVERY_THROUGHPUT_MUL;

/** 四半期のうち通常スプリント本数（最終1本がボス）。 */
export const NORMAL_SPRINTS_PER_QUARTER = SPRINTS_PER_QUARTER - 1;

/** 通常スプリントの Delivery 床（ボス種別によらない基準）。 */
export const BASELINE_SPRINT_DELIVERY_FLOOR = 60;

/** 新規四半期目標の Delivery 下限（旧 30 を四半期累計スケールへ）。 */
export const MIN_QUARTER_DELIVERY_TARGET = 30 * QUARTER_DELIVERY_SCALE;

/**
 * priorGoal 減衰時の Delivery 下限。
 * 緩和の積み重ねでも代表的な四半期実績帯（約2000〜2500）の半分付近を下回らないようにする。
 */
export const MIN_PRIOR_QUARTER_DELIVERY_TARGET = Math.round(
  BASELINE_SPRINT_DELIVERY_FLOOR * SPRINTS_PER_QUARTER * QUARTER_DELIVERY_THROUGHPUT_MUL * 0.7,
);

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
  easy: 1.15,
  normal: 1,
  hard: 1.12,
  nightmare: 1.2,
};

/** 難易度に応じた初期信頼。 */
export function buildInitialTrust(difficulty: DifficultyId): StakeholderTrust {
  const base =
    difficulty === 'easy' ? 70 : difficulty === 'normal' ? 60 : difficulty === 'hard' ? 50 : 45;
  return { management: base, customers: base, team: base + 5 };
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
    qualityTarget: c.minQuality ?? 45,
    techDebtLimit: c.maxTechDebt ?? 55,
    moraleTarget: c.minMorale ?? 40,
    incidentLimit: c.maxSpread !== undefined ? c.maxSpread + 3 : 6,
  };
  if (c.minAiPct !== undefined) goal.aiAdoptionTarget = c.minAiPct;

  if (priorGoal) {
    goal.deliveryTarget = Math.max(
      MIN_PRIOR_QUARTER_DELIVERY_TARGET,
      Math.round(priorGoal.deliveryTarget * 0.95),
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
      status: compareHigher(totals.delivered, goal.deliveryTarget),
    },
    {
      id: 'quality',
      label: 'Quality',
      target: goal.qualityTarget,
      actual: org.quality,
      status: compareHigher(org.quality, goal.qualityTarget),
    },
    {
      id: 'techDebt',
      label: 'Tech Debt',
      target: goal.techDebtLimit,
      actual: org.techDebt,
      status: compareLower(org.techDebt, goal.techDebtLimit),
    },
    {
      id: 'morale',
      label: 'Morale',
      target: goal.moraleTarget,
      actual: org.morale,
      status: compareHigher(org.morale, goal.moraleTarget),
    },
    {
      id: 'incident',
      label: 'Incident',
      target: goal.incidentLimit,
      actual: totals.incidents,
      status: compareLower(totals.incidents, goal.incidentLimit),
    },
  ];

  if (goal.aiAdoptionTarget !== undefined) {
    kpis.push({
      id: 'aiAdoption',
      label: 'AI Adoption',
      target: goal.aiAdoptionTarget,
      actual: aiPct,
      status: compareHigher(aiPct, goal.aiAdoptionTarget),
    });
  }
  return kpis;
}

function compareHigher(actual: number, target: number): GoalKpiProgress['status'] {
  if (actual >= target * 1.15) return 'exceeded';
  if (actual >= target) return 'met';
  return 'missed';
}

function compareLower(actual: number, target: number): GoalKpiProgress['status'] {
  if (actual <= target * 0.75) return 'exceeded';
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
  if (totals.reviewQueuePeak >= 32) reasons.push(REASON_LABELS.reviewJam);
  if (org.aiDependency >= 60 && totals.rework / Math.max(1, totals.completed) > 0.3) {
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
    minTrust <= 10 ||
    (budget <= 0 && org.morale <= 15) ||
    (org.seniorHp <= 5 && missedCount >= 2)
  ) {
    return 'shutdown';
  }
  if (quarterNumber >= 2 && missedCount >= 3) return 'reorg_required';
  if (minTrust <= 20 && missedCount >= 2) return 'reorg_required';
  if (minTrust <= 15 || budget <= 5 || missedCount >= 4) return 'missed_crisis';
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
    next.seniorHp = clamp(next.seniorHp + 20, 0, 100);
    next.techDebt = Math.max(0, next.techDebt - 8);
  }
  return next;
}

function wouldHardLose(org: OrgState, totals: RunTotals): boolean {
  if (org.seniorHp <= 1) return true;
  if (org.morale <= 1) return true;
  if (org.techDebt >= TECH_DEBT_CAP) return true;
  if (totals.reviewQueuePeak >= REVIEW_FREEZE_PEAK) return true;
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
    if (nextCustomers < 5 || nextManagement < 5 || nextTeam < 5) return false;
    if (Math.min(nextManagement, nextCustomers, nextTeam) <= 10) return false;
    if (nextBudget <= 5) return false;
    if (wouldHardLose(orgAfterAdjustment(org, def), totals)) return false;
    return true;
  });
}

/**
 * 目標修正選択後に次四半期へ持ち越される Delivery 目標のプレビュー（RI-68）。
 * 適用時下限と prior 減衰下限の両方を反映する。
 */
export function previewNextQuarterDeliveryTarget(
  currentDeliveryTarget: number,
  def: GoalAdjustmentDef,
): number {
  let next = currentDeliveryTarget;
  const ge = def.goalEffects;
  if (ge.deliveryMul !== undefined) {
    next = Math.max(MIN_ADJUSTED_QUARTER_DELIVERY_TARGET, Math.round(next * ge.deliveryMul));
  }
  if (ge.deliveryAdd !== undefined) {
    next = Math.max(MIN_ADJUSTED_QUARTER_DELIVERY_TARGET, next + ge.deliveryAdd);
  }
  return Math.max(MIN_PRIOR_QUARTER_DELIVERY_TARGET, Math.round(next * 0.95));
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

  const goal: QuarterGoal = { ...input.goal };
  const ge = def.goalEffects;
  if (ge.deliveryMul !== undefined) {
    goal.deliveryTarget = Math.max(
      MIN_ADJUSTED_QUARTER_DELIVERY_TARGET,
      Math.round(goal.deliveryTarget * ge.deliveryMul),
    );
  }
  if (ge.deliveryAdd !== undefined) {
    goal.deliveryTarget = Math.max(
      MIN_ADJUSTED_QUARTER_DELIVERY_TARGET,
      goal.deliveryTarget + ge.deliveryAdd,
    );
  }
  if (ge.qualityAdd !== undefined) goal.qualityTarget += ge.qualityAdd;
  if (ge.moraleAdd !== undefined) goal.moraleTarget += ge.moraleAdd;
  if (ge.techDebtLimitAdd !== undefined) goal.techDebtLimit += ge.techDebtLimitAdd;
  if (ge.incidentLimitAdd !== undefined) goal.incidentLimit += ge.incidentLimitAdd;
  if (ge.aiAdoptionAdd !== undefined && goal.aiAdoptionTarget !== undefined) {
    goal.aiAdoptionTarget = Math.max(0, goal.aiAdoptionTarget + ge.aiAdoptionAdd);
  }

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
    org.techDebt = Math.max(0, org.techDebt - Math.abs(REORG_RESET_TECH_DEBT));
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
      techDebt: Math.max(0, next.techDebt - Math.abs(REORG_RESET_TECH_DEBT)),
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
>;

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

  if (outcome === 'shutdown') {
    if (minTrust <= 10) return 'trustExhausted';
    if (input.budget <= 0 && input.org.morale <= 15) return 'budgetExhausted';
    if (input.org.seniorHp <= 5 && missedCount >= 2) return 'seniorBurnout';
    return 'trustExhausted';
  }

  // missed_crisis（空候補からの降格を含む）
  if (minTrust <= 15) return 'trustExhausted';
  if (input.budget <= 5) return 'budgetExhausted';
  if (missedCount >= 4) return 'kpiMissed';
  return 'trustExhausted';
}

export const OUTCOME_LABELS: Record<QuarterOutcome, string> = {
  exceeded: '超過達成',
  met: '目標達成',
  missed_adjustable: '未達（修正可能）',
  missed_crisis: '深刻な未達',
  reorg_required: '組織再編が必要',
  shutdown: '継続不能',
};

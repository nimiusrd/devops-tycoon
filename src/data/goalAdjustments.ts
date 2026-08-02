/**
 * 目標修正アクションの宣言的定義（SPEC 第4.6.1 / 第15章）。
 *
 * 効果・代償・表示文言をデータで持ち、シミュレーションは純関数で適用する（architecture §4.3）。
 */
import type { GoalAdjustmentId } from '../sim/run/types';

export interface GoalAdjustmentDef {
  id: GoalAdjustmentId;
  label: string;
  description: string;
  /** 即時の信頼変化。 */
  trustDelta: { management?: number; customers?: number; team?: number };
  /** 即時の予算変化。 */
  budgetDelta: number;
  /** 次期目標への効果（乗算・加算）。 */
  goalEffects: {
    deliveryMul?: number;
    deliveryAdd?: number;
    qualityAdd?: number;
    moraleAdd?: number;
    techDebtLimitAdd?: number;
    incidentLimitAdd?: number;
    aiAdoptionAdd?: number;
  };
  /** 即時の組織への効果。 */
  orgEffects?: {
    deliveryScoreMul?: number;
    techDebtDelta?: number;
    moraleDelta?: number;
    seniorHpDelta?: number;
    qualityDelta?: number;
  };
  /** 次四半期開始時の予算上限（request_budget 用）。 */
  nextBudgetCapDelta?: number;
  /** 次四半期の AI 成功率デバフを有効化（pause_ai_rollout 用）。 */
  pauseAiDebuff?: boolean;
  /** 組織再編: レビュー詰まり・属人化をリセット（reorg_teams 用）。 */
  reorgReset?: boolean;
}

export const GOAL_ADJUSTMENT_DEFS: GoalAdjustmentDef[] = [
  {
    id: 'cut_scope',
    label: 'スコープ削減',
    description: 'Delivery 目標を下げ、次期へ継続しやすくする。顧客の期待値を調整する。',
    trustDelta: { customers: -15 },
    budgetDelta: 0,
    // RI-68: 絶対減算は累計スケールで目標を潰すため、緩和は乗算のみにする。
    goalEffects: { deliveryMul: 0.8 },
  },
  {
    id: 'extend_deadline',
    label: '期限延長',
    description: '品質と士気を守って再挑戦する。経営の patience を消費し、予算も使う。',
    trustDelta: { management: -12 },
    budgetDelta: -10,
    goalEffects: { qualityAdd: 5, moraleAdd: 5, deliveryMul: 0.9 },
  },
  {
    id: 'quality_pivot',
    label: '品質改善ピボット',
    description: 'Tech Debt / Incident を下げる。短期の出荷評価は下がる。',
    trustDelta: { customers: -5 },
    budgetDelta: 0,
    goalEffects: { techDebtLimitAdd: 15, incidentLimitAdd: 3, deliveryMul: 0.85 },
    orgEffects: { deliveryScoreMul: 0.9, techDebtDelta: -8 },
  },
  {
    id: 'request_budget',
    label: '追加予算申請',
    description: '採用・AIツール・外部支援を得る。次期の予算制約が厳しくなる。',
    trustDelta: { management: -18 },
    budgetDelta: 20,
    // RI-68: deliveryAdd は四半期累計スケール（旧 10 × SPRINTS_PER_QUARTER × THROUGHPUT_MUL）。
    goalEffects: { deliveryAdd: 300 },
    nextBudgetCapDelta: -15,
  },
  {
    id: 'pause_ai_rollout',
    label: 'AI 導入一時停止',
    description: 'Review / Rework を安定化する。AI Adoption 評価と短期速度が下がる。',
    trustDelta: { management: -8 },
    budgetDelta: 0,
    goalEffects: { aiAdoptionAdd: -15, deliveryMul: 0.92 },
    pauseAiDebuff: true,
  },
  {
    id: 'reorg_teams',
    label: '組織再編',
    description: '属人化やレビュー停止をリセットする。士気とチーム信頼が下がる。',
    trustDelta: { team: -20 },
    budgetDelta: -5,
    goalEffects: { moraleAdd: -5 },
    orgEffects: { moraleDelta: -10, seniorHpDelta: 25, techDebtDelta: -5 },
    reorgReset: true,
  },
];

const BY_ID = new Map(GOAL_ADJUSTMENT_DEFS.map((d) => [d.id, d]));

/** 目標修正定義を ID で取得する。 */
export function getGoalAdjustment(id: GoalAdjustmentId): GoalAdjustmentDef | undefined {
  return BY_ID.get(id);
}

/** 全目標修正 ID（表示順）。 */
export function allGoalAdjustmentIds(): GoalAdjustmentId[] {
  return GOAL_ADJUSTMENT_DEFS.map((d) => d.id);
}

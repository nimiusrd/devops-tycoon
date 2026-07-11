/**
 * 勝敗判定（SPEC 第14章 / 第15章）。
 *
 * 敗北条件（シニア燃え尽き・負債超過・士気崩壊・レビュー凍結）と、ボス突破時の
 * 勝利種別（通常/健全/AI導入成功/経営/現場幸福/カオス/ノーダメ）を判定する純TS。
 */
import type { BossDef } from '../data/bosses';
import type { OrgState, SprintResult } from './types';
import type { LoseReason, RunTotals, WinType } from './run/types';

/** 技術的負債がこの値を超えると開発停止＝敗北。 */
export const TECH_DEBT_CAP = 90;
/** Review 待ち行列がこのピークに達すると PR 凍結＝敗北。 */
export const REVIEW_FREEZE_PEAK = 48;
/** 延焼を伴う Incident がこの連続スプリント数に達するとリリース停止＝敗北。 */
export const CONSECUTIVE_INCIDENT_SPRINT_CAP = 6;
/** AI 依存度がこの値に達すると仕様説明不能＝敗北。 */
export const AI_DEPENDENCY_CAP = 95;
/** AI 依存を安全に検証できないとみなす AI リテラシー上限。 */
export const AI_LITERACY_UNSAFE_CAP = 20;

export interface WinView {
  type: WinType;
  label: string;
  description: string;
}

const WIN_META: Record<WinType, { label: string; description: string }> = {
  normal: { label: '通常勝利', description: 'ボスを突破し、四半期を完遂した。' },
  healthy: { label: '健全勝利', description: '出荷・品質・士気をすべて高く保って突破した。' },
  aiSuccess: {
    label: 'AI 導入成功勝利',
    description: '高い AI 利用率を、手戻りとレビュー渋滞を抑えて両立した。',
  },
  management: { label: '経営勝利', description: '予算に余裕を残しながら成果を最大化した。' },
  happiness: { label: '現場幸福勝利', description: 'Morale とシニア体力を高く保ち続けた。' },
  chaos: { label: 'カオス勝利', description: '障害を連発しながら、なぜか出荷だけは最大化した。' },
  noDamage: {
    label: 'ノーダメージ勝利',
    description: '残業・アンドンを使わず、延焼を一度も許さずに突破した。',
  },
};

/** 勝利種別の表示情報を取得する。 */
export function winView(type: WinType): WinView {
  return { type, ...WIN_META[type] };
}

/** 敗北条件を評価する（該当なしは null）。スプリント完了ごとに呼ぶ。 */
export function evaluateLose(org: OrgState, totals: RunTotals): LoseReason | null {
  if (org.seniorHp <= 1) return 'seniorBurnout';
  if (org.morale <= 1) return 'moraleCollapse';
  if (org.techDebt >= TECH_DEBT_CAP) return 'techDebt';
  if (totals.reviewQueuePeak >= REVIEW_FREEZE_PEAK) return 'reviewFreeze';
  if ((totals.consecutiveIncidentSprints ?? 0) >= CONSECUTIVE_INCIDENT_SPRINT_CAP)
    return 'incidentCascade';
  if (org.aiDependency >= AI_DEPENDENCY_CAP && org.aiLiteracy <= AI_LITERACY_UNSAFE_CAP)
    return 'aiDependency';
  return null;
}

export interface BossEvalInput {
  boss: BossDef;
  result: SprintResult;
  org: OrgState;
  /** 難易度によるボス目標の倍率。 */
  bossTargetMul: number;
}

/** ボススプリントの突破可否を、定義の `clear` 条件で評価する。 */
export function evaluateBoss(input: BossEvalInput): boolean {
  const { boss, result, org, bossTargetMul } = input;
  const c = boss.clear;
  if (c.minSprintDelivered !== undefined) {
    if (result.delivered < c.minSprintDelivered * bossTargetMul) return false;
  }
  if (c.maxSpread !== undefined && result.spread > c.maxSpread) return false;
  if (c.maxTechDebt !== undefined && org.techDebt > c.maxTechDebt) return false;
  if (c.minAiPct !== undefined && result.aiAssistedPct < c.minAiPct) return false;
  if (c.minMorale !== undefined && org.morale < c.minMorale) return false;
  if (c.minQuality !== undefined && org.quality < c.minQuality) return false;
  return true;
}

export interface WinEvalInput {
  org: OrgState;
  totals: RunTotals;
  budget: number;
  usedHeavyActions: boolean;
}

/**
 * ボス突破時に達成した最上位の勝利種別を返す。
 * やり込み（ノーダメ）から順に評価し、最後に通常勝利へフォールバックする。
 */
export function evaluateWinType(input: WinEvalInput): WinType {
  const { org, totals, budget, usedHeavyActions } = input;
  const completed = Math.max(1, totals.completed);
  const reworkRatio = totals.rework / completed;
  const aiPct = totals.aiAssisted / completed;

  if (!usedHeavyActions && totals.spread === 0) return 'noDamage';
  if (org.quality >= 60 && org.morale >= 60 && reworkRatio < 0.25) return 'healthy';
  if (aiPct >= 0.5 && reworkRatio < 0.2 && totals.reviewQueuePeak < 16) return 'aiSuccess';
  if (org.morale >= 65 && org.seniorHp >= 50) return 'happiness';
  if (budget >= 40) return 'management';
  if (totals.incidents >= 8 && org.deliveryScore >= 300) return 'chaos';
  return 'normal';
}

/**
 * 勝敗判定（SPEC 第14章 / 第15章）。
 *
 * 敗北条件（シニア燃え尽き・負債超過・士気崩壊・レビュー凍結）と、ボス突破時の
 * 勝利種別（通常/健全/AI導入成功/経営/現場幸福/カオス/ノーダメ）を判定する純TS。
 *
 * RI-76: 勝利種別ラダーは診断・ビルド指標を反映し、受動プレイのノーダメ到達を防ぐ。
 */
import type { BossDef } from '../data/bosses';
import { diagnose } from './diagnosis';
import type { OrgState, SprintResult } from './types';
import type { DiagnosisType, LoseReason, RunTotals, WinType } from './run/types';

/** 技術的負債がこの値を超えると開発停止＝敗北。 */
export const TECH_DEBT_CAP = 90;
/** Review 待ち行列がこのピークに達すると PR 凍結＝敗北。 */
export const REVIEW_FREEZE_PEAK = 48;
/** 延焼を伴う Incident がこの連続スプリント数に達するとリリース停止＝敗北。 */
export const CONSECUTIVE_INCIDENT_SPRINT_CAP = 6;
/** AI 依存度がこの値に達すると仕様説明不能＝敗北。 */
export const AI_DEPENDENCY_CAP = 95;
/** 予算が尽きると AI ツールを維持できず、ランを継続できない。 */
export const BUDGET_EXHAUSTED_CAP = 0;
/**
 * AI 依存を安全に検証できないとみなす AI リテラシー上限。
 * Nightmare の初期値（25）では到達可能、Hard 以上の初期値（35+）では
 * リテラシーを下げない限り対象外になる。
 */
export const AI_LITERACY_UNSAFE_CAP = 30;

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
    description:
      '残業・アンドンを使わず延焼も許さず、品質・士気・シニア体力まで高水準で守り切った。',
  },
};

/** 勝利種別の表示情報を取得する。 */
export function winView(type: WinType): WinView {
  return { type, ...WIN_META[type] };
}

/** 敗北条件を評価する（該当なしは null）。状態が変化するごとに呼ぶ。 */
export function evaluateLose(org: OrgState, totals: RunTotals, budget: number): LoseReason | null {
  if (org.seniorHp <= 1) return 'seniorBurnout';
  if (org.morale <= 1) return 'moraleCollapse';
  if (org.techDebt >= TECH_DEBT_CAP) return 'techDebt';
  if (totals.reviewQueuePeak >= REVIEW_FREEZE_PEAK) return 'reviewFreeze';
  if ((totals.consecutiveIncidentSprints ?? 0) >= CONSECUTIVE_INCIDENT_SPRINT_CAP)
    return 'incidentCascade';
  if (org.aiDependency >= AI_DEPENDENCY_CAP && org.aiLiteracy <= AI_LITERACY_UNSAFE_CAP)
    return 'aiDependency';
  if (budget <= BUDGET_EXHAUSTED_CAP) return 'budgetExhausted';
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
  /** 省略時は org+totals から導出する（RI-76）。 */
  diagnosis?: DiagnosisType;
}

/**
 * ボス突破時に達成した最上位の勝利種別を返す（RI-76）。
 *
 * ノーダメはやり込み枠として高水準の健全指標と健全系診断を要求する。
 * ビルド差が出るよう AI / 幸福 / 経営 / カオスを健全の前に評価し、最後に通常勝利へ落とす。
 */
export function evaluateWinType(input: WinEvalInput): WinType {
  const { org, totals, budget, usedHeavyActions } = input;
  const diagnosis = input.diagnosis ?? diagnose(org, totals);
  // aiPct はラン全体の完了タスク数を分母にする（粗粒度チーム分も含む totals.completed が適切）。
  // reworkRatio は粗粒度チームの completed で希釈されないよう、選択チームの done を分母にする。
  // rework/(rework+done) だと閾値単位が変わるため、従来どおり rework/done を維持する。
  const completed = Math.max(1, totals.completed);
  const reworkRatio = totals.rework / Math.max(1, totals.done);
  const aiPct = totals.aiAssisted / completed;
  const healthyDiagnosis =
    diagnosis === 'healthyAcceleration' || diagnosis === 'documentationKingdom';

  // やり込み枠: 重介入なし・延焼0に加え、受動放置では届きにくい高水準を要求する。
  if (
    !usedHeavyActions &&
    totals.spread === 0 &&
    org.quality >= 70 &&
    org.morale >= 70 &&
    org.seniorHp >= 60 &&
    reworkRatio < 0.15 &&
    healthyDiagnosis
  ) {
    return 'noDamage';
  }

  // AI ビルド: 利用率と検証能力の両立。reviewHell（ピーク16+）・aiOverproduction とは重ならない。
  if (
    aiPct >= 0.55 &&
    reworkRatio < 0.22 &&
    totals.reviewQueuePeak < 16 &&
    org.aiLiteracy >= 40 &&
    diagnosis !== 'reviewHell' &&
    diagnosis !== 'aiOverproduction' &&
    diagnosis !== 'seniorSacrifice'
  ) {
    return 'aiSuccess';
  }

  // 人を守るビルド。
  if (org.morale >= 70 && org.seniorHp >= 55) {
    return 'happiness';
  }

  // 経営余裕。
  if (budget >= 35) {
    return 'management';
  }

  // 出荷はラン累計（totals.delivered）。選択中チームの org.deliveryScore では他チーム分を取りこぼす。
  if (totals.incidents >= 6 && totals.delivered >= 250) {
    return 'chaos';
  }

  // 品質・ドキュメント寄りの健全（診断が documentationKingdom なら閾値を緩める。士気下限は維持）。
  if (
    diagnosis === 'documentationKingdom' &&
    org.quality >= 55 &&
    org.morale >= 60 &&
    reworkRatio < 0.22
  ) {
    return 'healthy';
  }
  if (org.quality >= 65 && org.morale >= 65 && reworkRatio < 0.2) {
    return 'healthy';
  }

  return 'normal';
}

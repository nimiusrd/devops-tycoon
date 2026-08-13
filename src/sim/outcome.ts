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
  // RI-75: maxTicks 打ち切りは盤面未完了の時間切れ。出荷条件を満たしても突破しない。
  if (result.timedOut) return false;
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

/** 経営勝利に必要な予算下限。汎用キャッチオールにしないよう高めに置く（RI-76）。 */
export const MANAGEMENT_BUDGET_MIN = 50;
/**
 * カオス勝利に必要な累計障害数。
 * 完走ランは障害6件程度ではほぼ常に超えるため、連発のシグネチャとして高めに置く（RI-76）。
 */
export const CHAOS_INCIDENTS_MIN = 20;
/** カオス勝利に必要なラン累計出荷。 */
export const CHAOS_DELIVERED_MIN = 250;
/**
 * セキュリティ軽視のカオス。フルベットの低障害完走（実測18件・security 55+）を吸わないよう
 * 障害閾値は残差カオスより低く、セキュリティ上限は AI 成功の下限未満にする。
 */
export const CHAOS_NEGLECT_INCIDENTS_MIN = 16;
/** セキュリティ軽視カオスに必要なラン累計出荷。 */
export const CHAOS_NEGLECT_DELIVERED_MIN = 180;
/** 現場幸福勝利に必要な士気下限。 */
export const HAPPINESS_MORALE_MIN = 70;
/** 現場幸福勝利に必要なシニアHP下限。 */
export const HAPPINESS_SENIOR_HP_MIN = 45;
/** セキュリティ重視ビルドを健全へ上げる下限（実測の Focus 勝ちは 86 以上、FullBet は 81 以下）。 */
export const HEALTHY_SECURITY_MIN = 85;
/** 健全勝利に必要な士気下限（SPEC §14 の Quality と Morale）。 */
export const HEALTHY_MORALE_MIN = 65;
/** AI 成功に必要な利用率。 */
export const AI_SUCCESS_AI_PCT_MIN = 0.55;
/** AI 成功に必要なリテラシー。 */
export const AI_SUCCESS_LITERACY_MIN = 40;
/** AI 成功の手戻り率上限。 */
export const AI_SUCCESS_REWORK_MAX = 0.22;
/** セキュリティ軽視を AI 成功から外す下限（軽視の勝ちは 33、フルベットの勝ちは 55 以上）。 */
export const AI_SUCCESS_SECURITY_MIN = 50;
/** `diagnose()` の reviewHell と同じピーク。seniorSacrifice が先に付いても渋滞を隠さない。 */
export const AI_SUCCESS_REVIEW_QUEUE_PEAK_MAX = 16;

/**
 * ボス突破時に達成した最上位の勝利種別を返す（RI-76）。
 *
 * ノーダメはやり込み枠として高水準の健全指標と健全系診断を要求する。
 * ビルド差が出るよう、セキュリティ健全 → 低セキュリティカオス → AI → 幸福 → カオス → 品質健全を経営より前に評価する。
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

  // セキュリティ重視 + 全面 AI: 品質進化と検証投資の勝ち筋。AI 成功より先に健全へ。
  // 士気下限は通常の健全と同じ（SPEC §14: Quality と Morale）。
  if (
    org.securityLevel >= HEALTHY_SECURITY_MIN &&
    org.quality >= 65 &&
    org.morale >= HEALTHY_MORALE_MIN &&
    aiPct >= AI_SUCCESS_AI_PCT_MIN &&
    reworkRatio < AI_SUCCESS_REWORK_MAX
  ) {
    return 'healthy';
  }

  // 検証を省いた事故連発は AI 利用率が高くてもカオス（セキュリティ軽視のシグネチャ）。
  // security < AI 成功下限に限り、フルベット（security 55+）をカオスへ吸わない。
  if (
    totals.incidents >= CHAOS_NEGLECT_INCIDENTS_MIN &&
    totals.delivered >= CHAOS_NEGLECT_DELIVERED_MIN &&
    org.securityLevel < AI_SUCCESS_SECURITY_MIN
  ) {
    return 'chaos';
  }

  // AI フルベット: 利用率と Literacy。レビュー渋滞は診断名ではなくピークで見る。
  // seniorSacrifice が reviewHell より先に付くため、診断除外だけだと HP 低下で AI 成功へ改善する。
  if (
    aiPct >= AI_SUCCESS_AI_PCT_MIN &&
    reworkRatio < AI_SUCCESS_REWORK_MAX &&
    org.aiLiteracy >= AI_SUCCESS_LITERACY_MIN &&
    org.securityLevel >= AI_SUCCESS_SECURITY_MIN &&
    totals.reviewQueuePeak < AI_SUCCESS_REVIEW_QUEUE_PEAK_MAX &&
    diagnosis !== 'reworkSpiral' &&
    diagnosis !== 'reviewHell' &&
    diagnosis !== 'aiOverproduction'
  ) {
    return 'aiSuccess';
  }

  // ドキュメント盤石ビルドは幸福より先に健全へ（reviewHeavy 等の勝ち筋を幸福へ吸わせない）。
  if (
    diagnosis === 'documentationKingdom' &&
    org.quality >= 55 &&
    org.morale >= 60 &&
    reworkRatio < 0.22
  ) {
    return 'healthy';
  }

  // 人を守るビルド（障害多発より先に評価し、幸福勝ちをカオスへ吸わせない）。
  // documentationKingdom は上で健全へ分岐済み。
  if (org.morale >= HAPPINESS_MORALE_MIN && org.seniorHp >= HAPPINESS_SENIOR_HP_MIN) {
    return 'happiness';
  }

  // 出荷はラン累計（totals.delivered）。選択中チームの org.deliveryScore では他チーム分を取りこぼす。
  // 予算残りより先に評価し、障害連発ビルドが経営へ吸われないようにする。
  if (totals.incidents >= CHAOS_INCIDENTS_MIN && totals.delivered >= CHAOS_DELIVERED_MIN) {
    return 'chaos';
  }

  // 品質寄りの健全。経営（予算残り）より先に評価し、品質ビルドが予算だけで潰されないようにする。
  // レビュー渋滞のフルベットは健全へ落とさず、SPEC の AI 成功条件を迂回しない。
  if (
    org.quality >= 65 &&
    org.morale >= HEALTHY_MORALE_MIN &&
    reworkRatio < 0.2 &&
    totals.reviewQueuePeak < AI_SUCCESS_REVIEW_QUEUE_PEAK_MAX
  ) {
    return 'healthy';
  }

  // 経営余裕（残差）。閾値を高めにして汎用キャッチオールにしない。
  if (budget >= MANAGEMENT_BUDGET_MIN) {
    return 'management';
  }

  return 'normal';
}

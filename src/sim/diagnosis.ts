/**
 * 組織タイプ診断（SPEC 第13章）と AI 導入失敗図鑑（RI-34″ / §23）。
 *
 * ランを通じての累積メトリクスと現在の組織状態から、6 つの組織タイプの
 * いずれかを判定する純TS。「数字は出ているが内実は…」を可視化する。
 */
import type { OrgState } from './types';
import { OUTCOME_BALANCE } from '../data/balance';
import type { DiagnosisType, RunTotals } from './run/types';

export interface DiagnosisView {
  type: DiagnosisType;
  label: string;
  description: string;
}

/** AI 導入失敗図鑑の対象（健全系は除外）。 */
export const FAILURE_DIAGNOSIS_TYPES = [
  'reviewHell',
  'aiOverproduction',
  'reworkSpiral',
  'seniorSacrifice',
] as const satisfies readonly DiagnosisType[];

export type FailureDiagnosisType = (typeof FAILURE_DIAGNOSIS_TYPES)[number];

export interface FailureEncyclopediaDef {
  type: FailureDiagnosisType;
  label: string;
  description: string;
  /** 取得済み時に示す「避けるための教訓」。 */
  lesson: string;
  /** 未取得時の獲得ヒント。 */
  hint: string;
}

const META: Record<DiagnosisType, { label: string; description: string }> = {
  healthyAcceleration: {
    label: 'Healthy Acceleration 型',
    description:
      'AI の加速をレビューと品質が受け止め、手戻りも制御できています。理想的な状態です。',
  },
  reviewHell: {
    label: 'Review Hell 型',
    description: 'AI で PR は増えましたが、レビュー工程が崩壊しかけています。容量の増強を。',
  },
  aiOverproduction: {
    label: 'AI Overproduction 型',
    description: '実装量は増えましたが検証能力を超え、差し戻しと不安定さが目立ちます。',
  },
  reworkSpiral: {
    label: 'Rework Spiral 型',
    description: 'AI 出力の検証不足で手戻りが連鎖しています。品質とリテラシーの底上げを。',
  },
  seniorSacrifice: {
    label: 'Senior Sacrifice 型',
    description: 'シニアがすべてを支えています。短期は回りますが、長期的に破綻します。',
  },
  documentationKingdom: {
    label: 'Documentation Kingdom 型',
    description: 'テストとドキュメントが整い、AI が安定して機能しています。盤石です。',
  },
};

/** 診断種別の外部入力を検証する。 */
export function isDiagnosisType(value: unknown): value is DiagnosisType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(META, value);
}

const FAILURE_LESSONS: Record<FailureDiagnosisType, { lesson: string; hint: string }> = {
  reviewHell: {
    lesson: 'レビュー枠を先に確保し、割り込みレビューやレビュアー増強で渋滞を解消する。',
    hint: 'レビュー待ちが積み上がったランを完走する',
  },
  aiOverproduction: {
    lesson: '実装量より検証能力を優先し、テスト投資と AI 利用率のバランスを取る。',
    hint: 'AI 利用率が高く検証が追いつかないランを完走する',
  },
  reworkSpiral: {
    lesson: '差し戻しが連鎖する前に品質ゲートと AI リテラシーを底上げする。',
    hint: '手戻り比率が高いランを完走する',
  },
  seniorSacrifice: {
    lesson: 'シニアへの負荷集中を避け、レビューと炎上対応をチームへ分散する。',
    hint: 'シニア体力が危ない状態のランを完走する',
  },
};

/** 失敗診断かどうかを判定する。 */
export function isFailureDiagnosis(type: DiagnosisType): type is FailureDiagnosisType {
  return (FAILURE_DIAGNOSIS_TYPES as readonly DiagnosisType[]).includes(type);
}

/** AI 導入失敗図鑑の宣言的定義（コレクション表示用）。 */
export const FAILURE_ENCYCLOPEDIA_DEFS: readonly FailureEncyclopediaDef[] =
  FAILURE_DIAGNOSIS_TYPES.map((type) => ({
    type,
    ...META[type],
    ...FAILURE_LESSONS[type],
  }));

/** 診断種別の表示情報を取得する。 */
export function diagnosisView(type: DiagnosisType): DiagnosisView {
  return { type, ...META[type] };
}

/**
 * 組織状態と累積メトリクスから組織タイプを判定する。
 * 重い崩壊シグネチャから順に評価し、最後に健全/盤石へ分岐する。
 */
export function diagnose(org: OrgState, totals: RunTotals): DiagnosisType {
  const completed = Math.max(1, totals.completed);
  // 手戻り率は選択チームのスプリント完了数（done）を分母にする。
  // totals.completed は粗粒度チーム分を含むため希釈され、rework/(rework+done) は
  // 分母変更だけで既存閾値の境界がずれる。done なら従来単位を保ったまま希釈を避ける。
  const reworkRatio = totals.rework / Math.max(1, totals.done);
  const aiPct = totals.aiAssisted / completed;
  const queuePeak = totals.reviewQueuePeak;

  if (
    org.seniorHp < OUTCOME_BALANCE.diagnosisSeniorHpMax.value &&
    queuePeak >= OUTCOME_BALANCE.diagnosisReviewQueueMin.value
  ) {
    return 'seniorSacrifice';
  }
  if (
    queuePeak >= OUTCOME_BALANCE.winReviewQueuePeakMax.value &&
    reworkRatio < OUTCOME_BALANCE.diagnosisReviewHellReworkRatioMax.value
  ) {
    return 'reviewHell';
  }
  if (reworkRatio >= OUTCOME_BALANCE.diagnosisReworkSpiralReworkRatioMin.value) {
    return 'reworkSpiral';
  }
  if (
    aiPct >= OUTCOME_BALANCE.diagnosisAiOverproductionAiPctMin.value &&
    (queuePeak >= OUTCOME_BALANCE.diagnosisReviewQueueMin.value ||
      reworkRatio >= OUTCOME_BALANCE.diagnosisAiOverproductionReworkRatioMin.value)
  ) {
    return 'aiOverproduction';
  }
  if (
    org.testCoverage >= OUTCOME_BALANCE.diagnosisDocumentationTestCoverageMin.value &&
    org.documentation >= OUTCOME_BALANCE.diagnosisDocumentationMin.value &&
    reworkRatio < OUTCOME_BALANCE.diagnosisDocumentationReworkRatioMax.value
  ) {
    return 'documentationKingdom';
  }
  return 'healthyAcceleration';
}

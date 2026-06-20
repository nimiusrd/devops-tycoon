/**
 * 組織タイプ診断（SPEC 第13章）。
 *
 * ランを通じての累積メトリクスと現在の組織状態から、6 つの組織タイプの
 * いずれかを判定する純TS。「数字は出ているが内実は…」を可視化する。
 */
import type { OrgState } from './types';
import type { DiagnosisType, RunTotals } from './run/types';

export interface DiagnosisView {
  type: DiagnosisType;
  label: string;
  description: string;
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
  const reworkRatio = totals.rework / completed;
  const aiPct = totals.aiAssisted / completed;
  const queuePeak = totals.reviewQueuePeak;

  if (org.seniorHp < 30 && queuePeak >= 12) return 'seniorSacrifice';
  if (queuePeak >= 16 && reworkRatio < 0.3) return 'reviewHell';
  if (reworkRatio >= 0.32) return 'reworkSpiral';
  if (aiPct >= 0.5 && (queuePeak >= 12 || reworkRatio >= 0.2)) return 'aiOverproduction';
  if (org.testCoverage >= 65 && org.documentation >= 55 && reworkRatio < 0.18) {
    return 'documentationKingdom';
  }
  return 'healthyAcceleration';
}

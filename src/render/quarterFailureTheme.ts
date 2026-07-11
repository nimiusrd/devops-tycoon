/**
 * 四半期レビュー由来の継続不能をラン結果の演出へ変換する（SPEC 第15 / 第18.3）。
 *
 * 即時敗北の LoseReason とは分離し、レビュー outcome が残る場合だけ固有の表示を返す。
 */
import type { QuarterOutcome } from '../sim/run/types';

export interface QuarterFailureTheme {
  toneClass: string;
  icon: string;
  eyebrow: string;
  label: string;
  description: string;
}

const THEMES: Partial<Record<QuarterOutcome, QuarterFailureTheme>> = {
  missed_crisis: {
    toneClass: 'quarter-failure-missed-crisis',
    icon: '⚠️',
    eyebrow: 'CRITICAL GOALS MISSED',
    label: '深刻な未達',
    description: '重要な目標の未達が重なり、プロジェクトの継続判断を下せませんでした。',
  },
  reorg_required: {
    toneClass: 'quarter-failure-reorg-required',
    icon: '🔀',
    eyebrow: 'ORGANIZATION RESTRUCTURE',
    label: '組織再編が必要',
    description: '目標未達が重なり、大規模な組織再編のためプロジェクトを終了しました。',
  },
  shutdown: {
    toneClass: 'quarter-failure-shutdown',
    icon: '⏹️',
    eyebrow: 'PROJECT SHUTDOWN',
    label: '継続不能',
    description: '信頼と継続資源を維持できず、プロジェクトの停止が決定されました。',
  },
};

/** 四半期レビューの継続不能種別に対応する終了演出を取得する。 */
export function quarterFailureTheme(
  outcome: QuarterOutcome | undefined,
): QuarterFailureTheme | null {
  return outcome ? (THEMES[outcome] ?? null) : null;
}

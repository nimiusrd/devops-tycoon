import type { LoseReason } from '../sim/run/types';

export const LOSE_LABEL: Record<LoseReason, { label: string; desc: string }> = {
  seniorBurnout: { label: 'シニア燃え尽き', desc: 'レビューがシニアに集中し、体力が尽きました。' },
  techDebt: { label: '技術的負債の崩壊', desc: '負債が上限を超え、開発が立ち行かなくなりました。' },
  moraleCollapse: { label: 'チーム崩壊', desc: '士気が尽き、チームが機能しなくなりました。' },
  reviewFreeze: {
    label: 'PR 凍結',
    desc: 'レビュー待ち行列が限界に達し、出荷ラインが止まりました。',
  },
  incidentCascade: {
    label: '障害連鎖によるリリース停止',
    desc: '障害が連続し、安定したリリースを継続できなくなりました。',
  },
  aiDependency: {
    label: 'AI 依存の限界',
    desc: 'AI 依存が高まりすぎて、チームが仕様を説明・検証できなくなりました。',
  },
  budgetExhausted: {
    label: '予算枯渇',
    desc: '予算が尽き、AI ツールを維持できなくなりました。',
  },
  bossFailed: { label: 'ボス突破失敗', desc: '四半期末の試練を突破できませんでした。' },
  trustExhausted: {
    label: '信頼枯渇',
    desc: 'ステークホルダーの信頼が尽き、プロジェクトを継続できませんでした。',
  },
  reorgRequired: {
    label: '組織再編',
    desc: '目標未達が重なり、大規模再編としてプロジェクトが終了しました。',
  },
  kpiMissed: {
    label: 'KPI未達の累積',
    desc: '四半期目標の未達が重なり、継続判断を下せませんでした。',
  },
};

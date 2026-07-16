import type { LoseReason, WhatIfPreview as WhatIfPreviewData } from '../sim/run/types';

const IMMEDIATE_LOSE_LABEL: Partial<Record<LoseReason, string>> = {
  seniorBurnout: 'シニア燃え尽き',
  techDebt: '技術的負債の崩壊',
  moraleCollapse: 'チーム崩壊',
  reviewFreeze: 'PR 凍結',
  incidentCascade: '障害連鎖',
  aiDependency: 'AI 依存の限界',
  budgetExhausted: '予算枯渇',
};

export function WhatIfPreview({
  preview,
  computing = false,
  testId,
  compact = false,
  label = '次スプリント予測',
}: {
  preview?: WhatIfPreviewData | null;
  /** Worker 試算中（RI-13）。preview が無いときローディングを出す。 */
  computing?: boolean;
  testId?: string;
  compact?: boolean;
  label?: string;
}) {
  if (!preview) {
    if (!computing) return null;
    return (
      <div
        className={`what-if-preview computing${compact ? ' compact' : ''}`}
        data-testid={testId}
        data-what-if-status="computing"
      >
        <span className="what-if-label">{label}</span>
        <span className="what-if-computing">試算中…</span>
      </div>
    );
  }

  if (preview.immediateLose) {
    const reason = IMMEDIATE_LOSE_LABEL[preview.immediateLose] ?? preview.immediateLose;
    return (
      <div
        className={`what-if-preview lose${compact ? ' compact' : ''}`}
        data-testid={testId}
        data-immediate-lose={preview.immediateLose}
      >
        <span className="what-if-label">即時敗北</span>
        <span>{reason}</span>
      </div>
    );
  }

  if (preview.loseOnPlay) {
    const reason = IMMEDIATE_LOSE_LABEL[preview.loseOnPlay] ?? preview.loseOnPlay;
    return (
      <div
        className={`what-if-preview lose${compact ? ' compact' : ''}`}
        data-testid={testId}
        data-lose-on-play={preview.loseOnPlay}
      >
        <span className="what-if-label">発動で敗北</span>
        <span>{reason}</span>
      </div>
    );
  }

  const deliveredMin = Math.floor(preview.delivered.min);
  const deliveredMax = Math.ceil(preview.delivered.max);
  const spreadMin = Math.floor(preview.spread.min);
  const spreadMax = Math.ceil(preview.spread.max);
  return (
    <div className={`what-if-preview${compact ? ' compact' : ''}`} data-testid={testId}>
      <span className="what-if-label">{label}</span>
      <span>
        出荷 {deliveredMin}〜{deliveredMax}
      </span>
      <span>
        延焼 {spreadMin}〜{spreadMax}
      </span>
      <span className="what-if-trials">{preview.trials}回試算</span>
    </div>
  );
}

/**
 * 完了済み四半期の時系列（RI-126）。
 *
 * 件数は `reviewHistoryView` に任せ、状態は読むだけ（第22.2）。
 */
import { useMemo } from 'react';
import { reviewHistoryView } from '../render/reviewHistoryView';
import type { QuarterOutcome, QuarterReview } from '../sim/run/types';

export interface ReviewHistoryListProps {
  reviewHistory: readonly QuarterOutcome[];
  quarterReview?: Pick<QuarterReview, 'outcome' | 'progress'> | null;
  /** 末尾行の主要KPI。ランリザルト向け。四半期レビューは既存表があるので出さない。 */
  showKpis?: boolean;
}

export function ReviewHistoryList({
  reviewHistory,
  quarterReview = null,
  showKpis = false,
}: ReviewHistoryListProps) {
  const rows = useMemo(
    () => reviewHistoryView({ reviewHistory, quarterReview }),
    [reviewHistory, quarterReview],
  );
  if (rows.length === 0) return null;

  return (
    <section className="review-history" data-testid="review-history" aria-label="四半期履歴">
      <p className="result-section-label">四半期履歴</p>
      <ol className="review-history-list">
        {rows.map((row) => (
          <li
            key={row.quarterNumber}
            className={row.current ? 'review-history-row current' : 'review-history-row'}
            data-testid="review-history-row"
            data-quarter={row.quarterNumber}
            data-outcome={row.outcome}
            data-current={row.current ? 'true' : undefined}
          >
            <span className="review-history-quarter">Q{row.quarterNumber}</span>
            <span className="review-history-label">{row.label}</span>
            {row.current ? <span className="review-history-current">今回</span> : null}
            {showKpis && row.kpis && row.kpis.length > 0 ? (
              <span className="review-history-kpis" data-testid="review-history-kpis">
                {row.kpis.map((kpi) => (
                  <span key={kpi.id} className={`kpi-badge kpi-${kpi.status}`} data-kpi={kpi.id}>
                    {kpi.label} {kpi.statusLabel}
                  </span>
                ))}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

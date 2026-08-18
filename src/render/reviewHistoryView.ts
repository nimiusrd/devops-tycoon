/**
 * 四半期レビュー履歴の表示用導出（RI-126）。
 *
 * 件数の正本は `reviewHistory` のみ。`quarterReview` は末尾詳細（KPI）であり、
 * 別レコードとして足さない。sim・保存・勝敗契約は知らない純関数。
 */
import { OUTCOME_LABELS } from '../sim/run/quarterReview';
import type { GoalKpiProgress, QuarterOutcome, QuarterReview } from '../sim/run/types';

export const KPI_STATUS_LABELS: Record<GoalKpiProgress['status'], string> = {
  exceeded: '超過',
  met: '達成',
  missed: '未達',
};

export interface ReviewHistoryKpi {
  id: string;
  label: string;
  status: GoalKpiProgress['status'];
  statusLabel: string;
}

export interface ReviewHistoryRow {
  quarterNumber: number;
  outcome: QuarterOutcome;
  label: string;
  current: boolean;
  kpis?: ReviewHistoryKpi[];
}

export interface ReviewHistoryViewInput {
  reviewHistory: readonly QuarterOutcome[];
  quarterReview?: Pick<QuarterReview, 'outcome' | 'progress'> | null;
}

function toKpis(progress: readonly GoalKpiProgress[]): ReviewHistoryKpi[] {
  return progress.map((kpi) => ({
    id: kpi.id,
    label: kpi.label,
    status: kpi.status,
    statusLabel: KPI_STATUS_LABELS[kpi.status],
  }));
}

/** `reviewHistory` から時系列行を作る。末尾 KPI は outcome が一致するときだけ付ける。 */
export function reviewHistoryView(input: ReviewHistoryViewInput): ReviewHistoryRow[] {
  const review = input.quarterReview ?? null;
  const lastIndex = input.reviewHistory.length - 1;

  return input.reviewHistory.map((outcome, index) => {
    const current = index === lastIndex && review !== null && review.outcome === outcome;
    return {
      quarterNumber: index + 1,
      outcome,
      label: OUTCOME_LABELS[outcome],
      current,
      ...(current ? { kpis: toKpis(review.progress) } : {}),
    };
  });
}

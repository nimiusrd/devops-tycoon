/** 四半期新聞。表示中の期に保存されたKPIだけを読み、現在値や前後差から因果を作らない。 */
import { KPI_STATUS_LABELS } from './reviewHistoryView';
import type { GoalKpiProgress, QuarterTrendSnapshot } from '../sim/run/types';

type ArticleId = 'delivery' | 'morale';

export interface QuarterNewspaperArticle {
  id: ArticleId;
  headline: string;
  basis: string;
  status?: GoalKpiProgress['status'];
}

export interface QuarterNewspaperInput {
  quarterNumber: number;
  trendHistory?: readonly QuarterTrendSnapshot[];
}

const HEADLINES = {
  delivery: {
    exceeded: '出荷目標を超過達成',
    met: '出荷目標を達成',
    missed: '出荷目標に届かず',
  },
  morale: {
    exceeded: '士気が目標を上回る',
    met: '士気目標を達成',
    missed: '士気が目標を下回る',
  },
} as const;

export function quarterNewspaperView({ quarterNumber, trendHistory }: QuarterNewspaperInput) {
  const snapshot = trendHistory?.find((entry) => entry.quarterNumber === quarterNumber);
  const articles: QuarterNewspaperArticle[] = (['delivery', 'morale'] as const).map((id) => {
    const label = id === 'delivery' ? '出荷' : '士気';
    const kpi = snapshot?.kpis?.find((entry) => entry.id === id);
    if (!kpi) {
      return {
        id,
        headline: `${label}の記事は記録不足`,
        basis: snapshot
          ? `Q${quarterNumber} の保存履歴に${label}KPIがないため、実績・目標・達否を確認できません。`
          : `Q${quarterNumber} の四半期履歴がないため、${label}の実績・目標・達否を確認できません。`,
      };
    }
    return {
      id,
      headline: HEADLINES[id][kpi.status],
      basis: `Q${quarterNumber} ${label} — 実績 ${kpi.actual} / 目標 ${kpi.target}（${KPI_STATUS_LABELS[kpi.status]}）`,
      status: kpi.status,
    };
  });
  return { quarterNumber, articles };
}

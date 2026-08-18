/**
 * 四半期レビュー履歴の表示導出（RI-126）。
 *
 * 件数は reviewHistory のみ。quarterReview を末尾へ足して二重表示しない。
 */
import { describe, expect, it } from 'vitest';
import { reviewHistoryView } from '../../../src/render/reviewHistoryView';
import { OUTCOME_LABELS } from '../../../src/sim/run/quarterReview';
import type { GoalKpiProgress, QuarterReview } from '../../../src/sim/run/types';

function progress(overrides: Partial<GoalKpiProgress> = {}): GoalKpiProgress {
  return {
    id: 'delivery',
    label: '出荷',
    target: 90,
    actual: 90,
    status: 'met',
    ...overrides,
  };
}

function review(overrides: Partial<Pick<QuarterReview, 'outcome' | 'progress'>> = {}) {
  return {
    outcome: 'met' as const,
    progress: [progress()],
    ...overrides,
  };
}

describe('reviewHistoryView (RI-126)', () => {
  it('第1四半期レビュー中は1件だけ出し、quarterReview を足して二重表示しない', () => {
    const rows = reviewHistoryView({
      reviewHistory: ['met'],
      quarterReview: review({
        outcome: 'met',
        progress: [
          progress(),
          progress({ id: 'quality', label: '品質', target: 50, actual: 60, status: 'exceeded' }),
        ],
      }),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      quarterNumber: 1,
      outcome: 'met',
      label: OUTCOME_LABELS.met,
      current: true,
      kpis: [
        { id: 'delivery', label: '出荷', status: 'met', statusLabel: '達成' },
        { id: 'quality', label: '品質', status: 'exceeded', statusLabel: '超過' },
      ],
    });
  });

  it('複数四半期は番号順に並べ、末尾だけ KPI を付ける', () => {
    const rows = reviewHistoryView({
      reviewHistory: ['exceeded', 'missed_adjustable', 'met'],
      quarterReview: review({
        outcome: 'met',
        progress: [
          progress({ id: 'morale', label: '士気', target: 45, actual: 40, status: 'missed' }),
        ],
      }),
    });

    expect(rows.map((row) => row.quarterNumber)).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.outcome)).toEqual(['exceeded', 'missed_adjustable', 'met']);
    expect(rows.map((row) => row.label)).toEqual([
      OUTCOME_LABELS.exceeded,
      OUTCOME_LABELS.missed_adjustable,
      OUTCOME_LABELS.met,
    ]);
    expect(rows[0].current).toBe(false);
    expect(rows[0].kpis).toBeUndefined();
    expect(rows[1].current).toBe(false);
    expect(rows[1].kpis).toBeUndefined();
    expect(rows[2]).toMatchObject({
      current: true,
      kpis: [{ id: 'morale', label: '士気', status: 'missed', statusLabel: '未達' }],
    });
  });

  it('quarterReview が無い完了済み履歴は件数を保ち KPI を付けない', () => {
    const rows = reviewHistoryView({
      reviewHistory: ['exceeded', 'missed_adjustable'],
      quarterReview: null,
    });

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.current === false)).toBe(true);
    expect(rows.every((row) => row.kpis === undefined)).toBe(true);
  });

  it('空の reviewHistory は quarterReview があっても0件のまま', () => {
    expect(
      reviewHistoryView({
        reviewHistory: [],
        quarterReview: review({ outcome: 'shutdown' }),
      }),
    ).toEqual([]);
  });

  it('末尾 outcome が一致しない quarterReview は行を増やさず KPI も付けない', () => {
    const rows = reviewHistoryView({
      reviewHistory: ['met'],
      quarterReview: review({ outcome: 'exceeded' }),
    });

    expect(rows).toEqual([
      {
        quarterNumber: 1,
        outcome: 'met',
        label: OUTCOME_LABELS.met,
        current: false,
      },
    ]);
  });
});

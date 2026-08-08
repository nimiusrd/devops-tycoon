import { describe, expect, it } from 'vitest';
import { planBaselineComparison } from '../../../src/render/sprintBaselineComparison';
import type { SprintResult } from '../../../src/sim/types';

function makeResult(overrides: Partial<SprintResult> = {}): SprintResult {
  return {
    done: 10,
    delivered: 50,
    maxCombo: 5,
    aiAssistedPct: 30,
    reviewQueueMax: 4,
    rework: 1,
    incidents: 2,
    contained: 2,
    spread: 0,
    seniorHpDelta: -10,
    actionCounts: {},
    grade: 'B',
    title: '見かけ上の生産性王',
    diagnosis: 'テスト用',
    timeline: [],
    events: [],
    fireEvents: [],
    focusRemaining: 5,
    focusMax: 8,
    autoContainCount: 0,
    ...overrides,
  };
}

describe('sprintBaselineComparison（RI-55）', () => {
  it('ベースラインがない場合は比較を表示しない', () => {
    const view = planBaselineComparison(makeResult({ actionCounts: { overtime: 1 } }));
    expect(view.showSection).toBe(false);
    expect(view.rows).toEqual([]);
  });

  it('介入なしの場合はベースラインがあっても比較を表示しない', () => {
    const view = planBaselineComparison(
      makeResult({ baseline: { delivered: 50, spread: 0, maxCombo: 5 } }),
    );
    expect(view.showSection).toBe(false);
  });

  it('実績との差分と指標ごとの良し悪しを導出する', () => {
    const view = planBaselineComparison(
      makeResult({
        actionCounts: { interruptReview: 1 },
        baseline: { delivered: 42, spread: 2, maxCombo: 3 },
      }),
    );

    expect(view.showSection).toBe(true);
    expect(view.rows).toEqual([
      {
        key: 'delivered',
        label: '出荷',
        baseline: '42 pt',
        actual: '50 pt',
        delta: '+8 pt',
        tone: 'positive',
      },
      {
        key: 'spread',
        label: '延焼',
        baseline: '2 件',
        actual: '0 件',
        delta: '-2 件',
        tone: 'positive',
      },
      {
        key: 'maxCombo',
        label: 'Max Combo',
        baseline: 'x3',
        actual: 'x5',
        delta: '+2',
        tone: 'positive',
      },
    ]);
  });

  it('乱数列が変わるため推定であることを明記する', () => {
    const view = planBaselineComparison(makeResult());
    expect(view.disclaimer).toContain('同一 seed・同一開始条件');
    expect(view.disclaimer).toContain('厳密な同一世界線ではありません');
  });
});

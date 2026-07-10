/**
 * 無介入ベースラインとの比較表示（RI-55）。
 *
 * `SprintResult` を読むだけの純関数。差分は実績 - 無介入推定で表す。
 */
import type { SprintResult } from '../sim/types';

export type BaselineDeltaTone = 'positive' | 'negative' | 'neutral';

export interface BaselineComparisonRow {
  key: 'delivered' | 'spread' | 'maxCombo';
  label: string;
  baseline: string;
  actual: string;
  delta: string;
  tone: BaselineDeltaTone;
}

export interface BaselineComparisonView {
  rows: BaselineComparisonRow[];
  disclaimer: string;
  showSection: boolean;
}

const DISCLAIMER =
  '同一 seed・同一開始条件で介入なしに再実行した推定です。介入により乱数の流れは変わるため、厳密な同一世界線ではありません。';

function signed(value: number, suffix: string): string {
  if (value === 0) return `±0${suffix}`;
  return `${value > 0 ? '+' : ''}${value}${suffix}`;
}

function tone(delta: number, lowerIsBetter = false): BaselineDeltaTone {
  if (delta === 0) return 'neutral';
  const improved = lowerIsBetter ? delta < 0 : delta > 0;
  return improved ? 'positive' : 'negative';
}

/** 実績と無介入推定からリザルト表示用の比較行を導出する。 */
export function planBaselineComparison(result: SprintResult): BaselineComparisonView {
  const baseline = result.baseline;
  const hasInterventions = Object.values(result.actionCounts).some((count) => (count ?? 0) > 0);
  if (!baseline) {
    return { rows: [], disclaimer: DISCLAIMER, showSection: false };
  }

  const deliveredDelta = result.delivered - baseline.delivered;
  const spreadDelta = result.spread - baseline.spread;
  const comboDelta = result.maxCombo - baseline.maxCombo;

  return {
    rows: [
      {
        key: 'delivered',
        label: '出荷',
        baseline: `${baseline.delivered} pt`,
        actual: `${result.delivered} pt`,
        delta: signed(deliveredDelta, ' pt'),
        tone: tone(deliveredDelta),
      },
      {
        key: 'spread',
        label: '延焼',
        baseline: `${baseline.spread} 件`,
        actual: `${result.spread} 件`,
        delta: signed(spreadDelta, ' 件'),
        tone: tone(spreadDelta, true),
      },
      {
        key: 'maxCombo',
        label: 'Max Combo',
        baseline: `x${baseline.maxCombo}`,
        actual: `x${result.maxCombo}`,
        delta: signed(comboDelta, ''),
        tone: tone(comboDelta),
      },
    ],
    disclaimer: DISCLAIMER,
    showSection: hasInterventions,
  };
}

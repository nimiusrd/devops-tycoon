/**
 * 均衡編成とコーディング偏重編成の代表 seed 比較（RI-19）。
 *
 * 同一 seed の初回スプリントを RunEngine の公開 API だけで実行し、
 * レビュアー `m2` を coding へ移したときの結果差を計測する。
 */
import { RunEngine } from '../../../src/sim/run/engine';
import type { SprintResult } from '../../../src/sim/types';
import { summarizeNumeric, type NumericMetricSummary } from './monteCarlo';

/** 代表 seed の接頭辞（各試行は `${RI19_SEED_PREFIX}-${i}`）。 */
export const RI19_SEED_PREFIX = 'ri19-formation';

/** 候補 seed の先頭 12 本を代表群として固定する。 */
export const RI19_SEED_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

/** 代表 seed 文字列一覧。 */
export const RI19_SEEDS = RI19_SEED_INDICES.map((i) => `${RI19_SEED_PREFIX}-${i}`);

/** 同一 seed の均衡編成・コーディング偏重編成ペア。 */
export interface FormationComparison {
  seed: string;
  balanced: SprintResult;
  codingHeavy: SprintResult;
}

/** コーディング偏重 − 均衡編成の差分サマリー。 */
export interface FormationComparisonSummary {
  trials: number;
  deliveredDelta: NumericMetricSummary;
  reviewQueueDelta: NumericMetricSummary;
  reworkDelta: NumericMetricSummary;
}

/** 初回計測前の探索用レンジ。計測後に極端崩壊検知用の値へ狭める。 */
export const RI19_RANGES = {
  deliveredDelta: { meanMin: -10_000, meanMax: 10_000, minFloor: -10_000, maxCeil: 10_000 },
  reviewQueueDelta: { meanMin: -10_000, meanMax: 10_000, minFloor: -10_000, maxCeil: 10_000 },
  reworkDelta: { meanMin: -10_000, meanMax: 10_000, minFloor: -10_000, maxCeil: 10_000 },
} as const;

/**
 * 初回スプリントを完走する。
 *
 * codingHeavy では、初期レビュアー `m2` を coding へ移す。
 * AI 配布フラグは変更せず、レーン配置だけを比較軸にする。
 */
export function runFirstSprint(seed: string, codingHeavy: boolean): SprintResult {
  const engine = new RunEngine({ seed, difficulty: 'normal' });
  engine.startRun();
  if (codingHeavy) engine.assignMember('m2', 'coding');
  engine.beginSetupSprint();
  engine.step(1_000_000);

  const state = engine.snapshot();
  if (state.phase !== 'result' || state.lastResult === null) {
    throw new Error(`${seed}: 初回スプリントが完了しませんでした (phase=${state.phase})`);
  }
  return state.lastResult;
}

/** 同一 seed で均衡編成とコーディング偏重編成を比較する。 */
export function compareFormations(seed: string): FormationComparison {
  return {
    seed,
    balanced: runFirstSprint(seed, false),
    codingHeavy: runFirstSprint(seed, true),
  };
}

/** 代表 seed 群を一括比較する。 */
export function runFormationComparisons(
  seeds: readonly string[] = RI19_SEEDS,
): FormationComparison[] {
  return seeds.map((seed) => compareFormations(seed));
}

/** 同一 seed ペアから編成差を集計する。 */
export function summarizeFormationComparisons(
  comparisons: readonly FormationComparison[],
): FormationComparisonSummary {
  return {
    trials: comparisons.length,
    deliveredDelta: summarizeNumeric(
      comparisons.map((c) => c.codingHeavy.delivered - c.balanced.delivered),
    ),
    reviewQueueDelta: summarizeNumeric(
      comparisons.map((c) => c.codingHeavy.reviewQueueMax - c.balanced.reviewQueueMax),
    ),
    reworkDelta: summarizeNumeric(comparisons.map((c) => c.codingHeavy.rework - c.balanced.rework)),
  };
}

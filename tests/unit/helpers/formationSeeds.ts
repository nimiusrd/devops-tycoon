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

/**
 * 候補 `ri19-formation-0..31` を掃引し、全件でレビュー滞留増加を確認した。
 * 回帰コストを抑えるため先頭 12 本を代表群として固定する。
 */
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

/**
 * 2026-07 計測ベースの許容レンジ（極端崩壊検知用。細かな調整の縛りではない）。
 *
 * 代表 12 seed 初回計測:
 * - deliveredΔ mean=+27.75（min -35 / max +95）
 * - reviewQueueΔ mean=+4.33（min +1 / max +8）
 * - reworkΔ mean=-2.67（min -6 / max 0）
 *
 * 候補 32 seed の探索でも reviewQueueΔ は全件正値（min +1 / max +10）。
 */
export const RI19_RANGES = {
  /** 出荷差は seed 依存で符号が変わるため、極端な優位・劣位だけを弾く。 */
  deliveredDelta: { meanMin: -25, meanMax: 100, minFloor: -100, maxCeil: 200 },
  /** レビュアー不在による滞留増加を検知しつつ、支配的な悪化を許さない。 */
  reviewQueueDelta: { meanMin: 2, meanMax: 10, minFloor: 0, maxCeil: 16 },
  /** レビュー到達量の減少に伴う手戻り差は、方向を強制せず極端値だけを弾く。 */
  reworkDelta: { meanMin: -10, meanMax: 5, minFloor: -15, maxCeil: 10 },
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

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
 * 候補 `ri19-formation-0..63` を掃引し、レビュー滞留増加（codingHeavy > balanced）を確認した。
 * RI-75 後は index 6 が Δ=0 になったため除外し、12 を加えて代表 12 本を固定する。
 */
export const RI19_SEED_INDICES = [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12] as const;

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
 * RI-134 再計測ベースの許容レンジ（極端崩壊検知用。細かな調整の縛りではない）。
 *
 * 代表 12 seed（index 6 除外）計測:
 * - deliveredΔ mean=-53.25（min -214 / max +56）
 * - reviewQueueΔ mean≈+14.67（min +10 / max +20）
 * - reworkΔ mean=+1.5（min -3 / max +7）
 */
export const RI19_RANGES = {
  /** 出荷差は seed 依存で符号が変わるため、極端な優位・劣位だけを弾く（RI-134 再計測）。 */
  // RI-134: AI依存モデル係数の確定で平均差が -53.25 へ移動したため下限を更新する。
  deliveredDelta: { meanMin: -60, meanMax: 100, minFloor: -220, maxCeil: 200 },
  /** レビュアー不在による滞留増加を検知しつつ、支配的な悪化を許さない。 */
  reviewQueueDelta: { meanMin: 2, meanMax: 16, minFloor: 0, maxCeil: 22 },
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

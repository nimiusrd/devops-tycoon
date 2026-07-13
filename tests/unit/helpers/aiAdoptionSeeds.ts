/**
 * AI あり/なし差分の代表 seed（RI-41）。
 *
 * 同一 seed で `aiAdoptionShare` 1 vs 0 の無介入スプリントを比較し、
 * Review 渋滞・Rework・AI 利用率の方向性が安定して観測できる seed を固定する。
 * 編成個体値（`foldFormationEffects`）は含めず、コア因果（`decideAiAssisted`）側を検証する。
 *
 * シミュレーション係数が変わって差分が崩れた場合は `ri41-ai-0..31` を同条件で再探索し、
 * ここを更新する。
 */
import { IDENTITY_CARD_EFFECTS } from '../../../src/sim/model';
import { createOrgState } from '../../../src/sim/org';
import {
  runSprintSimulationFull,
  type SprintBaselineInput,
} from '../../../src/sim/run/sprintBaseline';
import { resolveSprintConfig } from '../../../src/sim/sprint';
import type { SprintResult } from '../../../src/sim/types';
import { summarizeNumeric, type NumericMetricSummary } from './monteCarlo';

/** 代表 seed の接頭辞（各試行は `${RI41_SEED_PREFIX}-${i}`）。 */
export const RI41_SEED_PREFIX = 'ri41-ai';

/**
 * 探索で選別した代表 index（`ri41-ai-0..11`）。
 *
 * 候補 `0..31` を掃引したところ全件でコア因果（AI 利用率・Review / Rework 増加）が成立した。
 * 回帰コストを抑えるため先頭 12 本を代表群として固定する。除外 index なし。
 */
export const RI41_SEED_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

/** 代表 seed 文字列一覧。 */
export const RI41_SEEDS = RI41_SEED_INDICES.map((i) => `${RI41_SEED_PREFIX}-${i}`);

/** 同一 seed の AI あり/なしペア。 */
export interface AiAdoptionComparison {
  seed: string;
  withAi: SprintResult;
  withoutAi: SprintResult;
}

/** AI あり − なし の差分サマリー（正値が AI あり側の増加）。 */
export interface AiAdoptionComparisonSummary {
  trials: number;
  reviewQueueDelta: NumericMetricSummary;
  reworkDelta: NumericMetricSummary;
  deliveredDelta: NumericMetricSummary;
  aiAssistedPctWith: NumericMetricSummary;
  aiAssistedPctWithout: NumericMetricSummary;
}

/**
 * 2026-07 計測ベースの許容レンジ（極端崩壊検知用。細かな調整の縛りではない）。
 *
 * 代表 12 seed 初回計測:
 * - reviewQueueΔ mean≈+9.7（min 6 / max 13）
 * - reworkΔ mean≈+6.1（min 3 / max 10）
 * - deliveredΔ mean≈-94（min -155 / max -23）※渋滞増に伴い出荷は低下側
 * - aiAssistedPct with mean≈87（min 82 / max 96）、without 常に 0
 */
export const RI41_RANGES = {
  /** AI ありの reviewQueueMax − なし。 */
  reviewQueueDelta: { meanMin: 3, meanMax: 20, minFloor: 1, maxCeil: 30 },
  /** AI ありの rework − なし。 */
  reworkDelta: { meanMin: 1, meanMax: 20, minFloor: 0, maxCeil: 30 },
  /** 出荷差は方向を強制せず、極端な片寄りだけ弾く。 */
  deliveredDelta: { meanMin: -300, meanMax: 50, minFloor: -400, maxCeil: 100 },
  /** AI ありの利用率（%）。 */
  aiAssistedPctWith: { min: 50, max: 100 },
  /** AI なしは常に 0%。 */
  aiAssistedPctWithout: { min: 0, max: 0 },
} as const;

/** RI-41 比較用の共通ベースライン入力。 */
export function makeAiAdoptionBaselineInput(
  seed: string,
  aiAdoptionShare: number,
): SprintBaselineInput {
  return {
    seed,
    config: resolveSprintConfig('default'),
    org: createOrgState('default', true),
    cardEffects: { ...IDENTITY_CARD_EFFECTS },
    aiAdoptionShare,
  };
}

/** 同一 seed で AI あり（share=1）となし（share=0）を無介入実行する。 */
export function compareAiAdoption(seed: string): AiAdoptionComparison {
  return {
    seed,
    withAi: runSprintSimulationFull(makeAiAdoptionBaselineInput(seed, 1)),
    withoutAi: runSprintSimulationFull(makeAiAdoptionBaselineInput(seed, 0)),
  };
}

/** 代表 seed 群を一括比較する。 */
export function runAiAdoptionComparisons(
  seeds: readonly string[] = RI41_SEEDS,
): AiAdoptionComparison[] {
  return seeds.map((seed) => compareAiAdoption(seed));
}

/** コア因果（Review / Rework 増加・AI 利用率）を満たすか。 */
export function meetsAiAdoptionCausalDoD(comparison: AiAdoptionComparison): boolean {
  const { withAi, withoutAi } = comparison;
  return (
    withoutAi.aiAssistedPct === 0 &&
    withAi.aiAssistedPct > 0 &&
    withAi.reviewQueueMax > withoutAi.reviewQueueMax &&
    withAi.rework > withoutAi.rework
  );
}

/** 同一 seed ペアから AI あり/なし差分を集計する。 */
export function summarizeAiAdoptionComparisons(
  comparisons: readonly AiAdoptionComparison[],
): AiAdoptionComparisonSummary {
  return {
    trials: comparisons.length,
    reviewQueueDelta: summarizeNumeric(
      comparisons.map((c) => c.withAi.reviewQueueMax - c.withoutAi.reviewQueueMax),
    ),
    reworkDelta: summarizeNumeric(comparisons.map((c) => c.withAi.rework - c.withoutAi.rework)),
    deliveredDelta: summarizeNumeric(
      comparisons.map((c) => c.withAi.delivered - c.withoutAi.delivered),
    ),
    aiAssistedPctWith: summarizeNumeric(comparisons.map((c) => c.withAi.aiAssistedPct)),
    aiAssistedPctWithout: summarizeNumeric(comparisons.map((c) => c.withoutAi.aiAssistedPct)),
  };
}

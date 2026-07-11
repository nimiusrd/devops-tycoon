/**
 * 次スプリントの確率 what-if 試算（RI-46）。
 *
 * 本番の RunEngine 状態には触れず、同じ開始条件を派生 seed で複数回実行して
 * プレイヤー向けの期待値と観測レンジを返す。
 */
import { runSprintSimulation } from './sprintBaseline';
import type { SprintBaselineInput } from './sprintBaseline';
import type { WhatIfMetric, WhatIfPreview } from './types';

/** UI で待たせずに実行でき、かつ振れ幅を示せる試行数。 */
export const WHAT_IF_TRIALS = 24;

function summarize(values: readonly number[]): WhatIfMetric {
  if (values.length === 0) return { mean: 0, min: 0, max: 0 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  return { mean, min, max };
}

/**
 * 同一条件を派生 seed で掃引する。
 *
 * `SprintBaselineInput` は呼び出し側で構築済みの独立データなので、入力・本番 state
 * を変更しない。試行ごとの乱数は seed を差し替え、候補間で同じ seed 群を使う。
 */
export function previewNextSprint(
  input: SprintBaselineInput,
  trials: number = WHAT_IF_TRIALS,
): WhatIfPreview {
  if (!Number.isInteger(trials) || trials <= 0) {
    throw new Error(
      `previewNextSprint: trials は 1 以上の整数である必要があります (got ${trials})`,
    );
  }

  const delivered: number[] = [];
  const spread: number[] = [];
  for (let i = 0; i < trials; i += 1) {
    const result = runSprintSimulation({ ...input, seed: `${input.seed}:what-if:${i}` });
    delivered.push(result.delivered);
    spread.push(result.spread);
  }

  return {
    trials,
    delivered: summarize(delivered),
    spread: summarize(spread),
  };
}

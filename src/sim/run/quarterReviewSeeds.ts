/**
 * E2E / 回帰テスト用の四半期レビュー seed（探索して固定）。
 *
 * オートプレイ前提は `tests/unit/helpers/runFlow.ts` の `advance` 既定
 * （draft 先頭採用・beat は即時採用を避けた選択・rest=heal・手札全発動・
 * missed_adjustable は先頭の目標修正）。
 * シミュレーションやドラフトプールが変わると outcome がずれることがあるため、
 * 崩れた場合は同条件で再探索し、ここを更新する。
 *
 * RI-26（採用入口拡張）導入後に再探索した seed 群。
 */
import type { DifficultyId, QuarterOutcome } from './types';

export const E2E_MISSED_ADJUSTABLE_SEED = 'q8-find-55';

/**
 * hard で四半期レビューに到達すると継続不能のいずれかになる互換 seed。
 * 種別固定が必要なら `E2E_TERMINAL_*` を使う。
 */
export const E2E_SHUTDOWN_SEED = 'ri26b-hard-23';

/** 継続不能 outcome ごとの固定 seed（RI-26 再探索 / hard）。 */
export interface TerminalQuarterSeed {
  seed: string;
  difficulty: DifficultyId;
  outcome: Extract<QuarterOutcome, 'shutdown' | 'reorg_required' | 'missed_crisis'>;
  /** 終端レビューに到達する四半期番号（1 起点）。 */
  quarterNumber: number;
}

/** Q1 で shutdown。 */
export const E2E_TERMINAL_SHUTDOWN: TerminalQuarterSeed = {
  seed: 'ri26b-hard-23',
  difficulty: 'hard',
  outcome: 'shutdown',
  quarterNumber: 1,
};

/**
 * Q5 で missed_crisis。
 * 途中の missed_adjustable は先頭の目標修正で継続した先。
 */
export const E2E_TERMINAL_MISSED_CRISIS: TerminalQuarterSeed = {
  seed: 'ri26b-hard-13',
  difficulty: 'hard',
  outcome: 'missed_crisis',
  quarterNumber: 5,
};

/**
 * Q2 で reorg_required。
 * 途中の missed_adjustable は先頭の目標修正で継続した先。
 */
export const E2E_TERMINAL_REORG_REQUIRED: TerminalQuarterSeed = {
  seed: 'ri26b-hard-53',
  difficulty: 'hard',
  outcome: 'reorg_required',
  quarterNumber: 2,
};

export const E2E_TERMINAL_SEEDS: readonly TerminalQuarterSeed[] = [
  E2E_TERMINAL_SHUTDOWN,
  E2E_TERMINAL_MISSED_CRISIS,
  E2E_TERMINAL_REORG_REQUIRED,
];

/**
 * E2E / 回帰テスト用の四半期レビュー seed（探索して固定）。
 *
 * オートプレイ前提は `tests/unit/helpers/runFlow.ts` の `advance` 既定
 * （draft 先頭採用・beat は即時採用を避けた選択・rest=heal・手札全発動・
 * missed_adjustable は先頭の目標修正）。
 * シミュレーションやドラフトプールが変わると outcome がずれることがあるため、
 * 崩れた場合は同条件で再探索し、ここを更新する。
 *
 * RI-62（ボス長尾調整）後に再探索した seed 群。
 * RI-64 で四半期 KPI を全社集約しても、士気・シニアHPは選択中チーム基準のため
 * これらの seed 契約は維持する。
 */
import type { DifficultyId, QuarterOutcome } from './types';

export const E2E_MISSED_ADJUSTABLE_SEED = 'ri62e-ma-17';

/**
 * hard で四半期レビューに到達すると継続不能のいずれかになる互換 seed。
 * 種別固定が必要なら `E2E_TERMINAL_*` を使う。
 */
export const E2E_SHUTDOWN_SEED = 'ri62e-hard-80';

/** 継続不能 outcome ごとの固定 seed（RI-62 再探索 / hard）。 */
export interface TerminalQuarterSeed {
  seed: string;
  difficulty: DifficultyId;
  outcome: Extract<QuarterOutcome, 'shutdown' | 'reorg_required' | 'missed_crisis'>;
  /** 終端レビューに到達する四半期番号（1 起点）。 */
  quarterNumber: number;
}

/** Q1 で shutdown。 */
export const E2E_TERMINAL_SHUTDOWN: TerminalQuarterSeed = {
  seed: 'ri62e-hard-80',
  difficulty: 'hard',
  outcome: 'shutdown',
  quarterNumber: 1,
};

/**
 * Q4 で missed_crisis。
 * 途中の missed_adjustable は先頭の目標修正で継続した先。
 */
export const E2E_TERMINAL_MISSED_CRISIS: TerminalQuarterSeed = {
  seed: 'ri62e-hard-0',
  difficulty: 'hard',
  outcome: 'missed_crisis',
  quarterNumber: 4,
};

/**
 * Q2 で reorg_required。
 * 途中の missed_adjustable は先頭の目標修正で継続した先。
 * RI-68（目標修正の再選択禁止）後に再探索。
 */
export const E2E_TERMINAL_REORG_REQUIRED: TerminalQuarterSeed = {
  seed: 'ri68t-34',
  difficulty: 'hard',
  outcome: 'reorg_required',
  quarterNumber: 2,
};

export const E2E_TERMINAL_SEEDS: readonly TerminalQuarterSeed[] = [
  E2E_TERMINAL_SHUTDOWN,
  E2E_TERMINAL_MISSED_CRISIS,
  E2E_TERMINAL_REORG_REQUIRED,
];

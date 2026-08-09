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
 * RI-81（初期カードプール拡張）後に再探索して更新。
 * RI-75（スプリント pacing / タスク量・床・minCompleteTick / abandonInFlight）後に再探索して更新。
 * RI-84（安定中の高価値上振れ抑制・Delivery目標再校正）後に再探索して更新。
 * RI-73（easy/normal の seniorHpCostMul）後に missed_adjustable seed を再探索して更新。
 * RI-78（休息投資・カード発動費分離）後に missed_adjustable seed を再探索して更新。
 */
import type { DifficultyId, QuarterOutcome } from './types';

export const E2E_MISSED_ADJUSTABLE_SEED = 'ri78-ma-90';

/**
 * hard で四半期レビューに到達すると継続不能のいずれかになる互換 seed。
 * 種別固定が必要なら `E2E_TERMINAL_*` を使う。
 */
export const E2E_SHUTDOWN_SEED = 'ri75h-hard-883';

/** 継続不能 outcome ごとの固定 seed（RI-75 再探索 / hard）。 */
export interface TerminalQuarterSeed {
  seed: string;
  difficulty: DifficultyId;
  outcome: Extract<QuarterOutcome, 'shutdown' | 'reorg_required' | 'missed_crisis'>;
  /** 終端レビューに到達する四半期番号（1 起点）。 */
  quarterNumber: number;
}

/** Q1 で shutdown。 */
export const E2E_TERMINAL_SHUTDOWN: TerminalQuarterSeed = {
  seed: 'ri75h-hard-883',
  difficulty: 'hard',
  outcome: 'shutdown',
  quarterNumber: 1,
};

/**
 * Q4 で missed_crisis。
 * 途中の missed_adjustable は先頭の目標修正で継続した先。
 */
export const E2E_TERMINAL_MISSED_CRISIS: TerminalQuarterSeed = {
  seed: 'ri75k-hard-343',
  difficulty: 'hard',
  outcome: 'missed_crisis',
  quarterNumber: 4,
};

/**
 * Q3 で reorg_required。
 * 途中の missed_adjustable は先頭の目標修正で継続した先。
 */
export const E2E_TERMINAL_REORG_REQUIRED: TerminalQuarterSeed = {
  seed: 'ri75f-hard-298',
  difficulty: 'hard',
  outcome: 'reorg_required',
  quarterNumber: 3,
};

export const E2E_TERMINAL_SEEDS: readonly TerminalQuarterSeed[] = [
  E2E_TERMINAL_SHUTDOWN,
  E2E_TERMINAL_MISSED_CRISIS,
  E2E_TERMINAL_REORG_REQUIRED,
];

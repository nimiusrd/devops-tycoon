/**
 * RunBar のスプリント進行表示（SPEC 第4.7 パンくずの簡易版）。
 *
 * `sprintIndexInQuarter` は「直近に開始したスプリント」（0=未開始）なので、
 * スプリント中はその番号、スプリント間は次に入る番号を出す。
 * 編成導線の「次: スプリント N/M」と同じ番号になる。
 */
import type { RunPhase } from '../sim/run/types';

export interface RunBarSprintView {
  /** 表示する当四半期スプリント番号（1 起点）。 */
  current: number;
  /** 1 四半期あたりのスプリント数。 */
  total: number;
  /** 表示中の次がボス（最終枠）のとき。 */
  bossNext: boolean;
}

export function runBarSprintView(input: {
  phase: RunPhase;
  sprintIndexInQuarter: number;
  sprintsPerQuarter: number;
}): RunBarSprintView {
  const total = Math.max(1, input.sprintsPerQuarter);
  const lastStarted = input.sprintIndexInQuarter;
  const raw = input.phase === 'sprint' ? lastStarted : lastStarted + 1;
  const current = Math.min(Math.max(raw, 1), total);
  return {
    current,
    total,
    bossNext: current === total - 1,
  };
}

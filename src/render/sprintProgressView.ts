/**
 * 四半期トラックの表示用スプリント番号（HUD / ドラフト共有）。
 *
 * `sprintIndexInQuarter` は launchSprint 時点で進む（0=未開始）。
 * `sprintsPlayed` はラン通算の完了数で、四半期表示とは別物。
 * ドラフトは次スプリント向けの選択なので、通算ではなく当四半期の次番号を出す。
 */
import type { RunPhase } from '../sim/run/types';

export interface QuarterSprintProgress {
  phase: RunPhase;
  sprintIndexInQuarter: number;
  sprintsPerQuarter: number;
}

/** 当四半期の次スプリント番号（1 起点。最終枠を超えない）。 */
export function nextSprintIndexInQuarter(
  sprintIndexInQuarter: number,
  sprintsPerQuarter: number,
): number {
  if (sprintsPerQuarter < 1) return 1;
  return Math.min(Math.max(sprintIndexInQuarter + 1, 1), sprintsPerQuarter);
}

/**
 * HUD とカードドラフトで揃える表示用スプリント番号。
 * ドラフト中は次スプリント、それ以外は直近に開始した番号（従来の HUD）。
 */
export function displayedQuarterSprintIndex(state: QuarterSprintProgress): number {
  if (state.sprintsPerQuarter < 1) return 1;
  if (state.phase === 'draft') {
    return nextSprintIndexInQuarter(state.sprintIndexInQuarter, state.sprintsPerQuarter);
  }
  return Math.min(Math.max(state.sprintIndexInQuarter, 0), state.sprintsPerQuarter);
}

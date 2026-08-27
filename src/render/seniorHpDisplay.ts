/**
 * プレイヤー向けシニアHP（残量）の表示クランプ。
 *
 * 内部の `seniorHpDelta` は増減（多くは負）のまま残す。結果画面の「Senior HP」行と
 * HUD の体力%は残量であり、0 未満を出さない。
 */
import type { SprintResult } from '../sim/types';

/** プレイヤー向けシニアHP残量の下限。 */
export const SENIOR_HP_DISPLAY_MIN = 0;
/** プレイヤー向けシニアHP残量の上限。 */
export const SENIOR_HP_DISPLAY_MAX = 100;

/** 残量表示用に 0..100 へ丸めてクランプする。 */
export function clampSeniorHpDisplay(value: number): number {
  return Math.min(SENIOR_HP_DISPLAY_MAX, Math.max(SENIOR_HP_DISPLAY_MIN, Math.round(value)));
}

/**
 * スプリント結果のシニアHP残量。タイムライン最終サンプルを優先し、無ければ 0。
 * 差分 `seniorHpDelta` は残量ではないため、負数のまま表示しない。
 */
export function sprintResultSeniorHpRemaining(result: SprintResult): number {
  const last = result.timeline[result.timeline.length - 1];
  if (last === undefined) return SENIOR_HP_DISPLAY_MIN;
  return clampSeniorHpDisplay(last.seniorHp);
}

/** 結果画面の Senior HP 行に出す文字列。 */
export function formatSprintResultSeniorHp(result: SprintResult): string {
  return String(sprintResultSeniorHpRemaining(result));
}

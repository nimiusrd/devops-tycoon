/**
 * プレイヤー向けシニアHP（残量）の表示クランプ。
 *
 * 内部の `seniorHpDelta` は未クランプ終値からの増減（end - start）のまま残す。
 * 結果画面の「Senior HP」行と HUD の体力%は残量であり、0 未満を出さない。
 * タイムラインが空で残量を復元できないときは 0 を捏造せず不明表示にする。
 */
import type { SprintResult } from '../sim/types';

/** プレイヤー向けシニアHP残量の下限。 */
export const SENIOR_HP_DISPLAY_MIN = 0;
/** プレイヤー向けシニアHP残量の上限。 */
export const SENIOR_HP_DISPLAY_MAX = 100;
/** 残量を復元できないときの表示。 */
export const SENIOR_HP_DISPLAY_UNKNOWN = '—';

/** 残量表示用に 0..100 へ丸めてクランプする。 */
export function clampSeniorHpDisplay(value: number): number {
  return Math.min(SENIOR_HP_DISPLAY_MAX, Math.max(SENIOR_HP_DISPLAY_MIN, Math.round(value)));
}

/**
 * スプリント結果のシニアHP残量。タイムライン最終サンプルを 0..100 にクランプする。
 * 空の timeline では残量不明なので null。差分 `seniorHpDelta` は残量ではない。
 */
export function sprintResultSeniorHpRemaining(result: SprintResult): number | null {
  const last = result.timeline[result.timeline.length - 1];
  if (last === undefined) return null;
  return clampSeniorHpDisplay(last.seniorHp);
}

/** 結果画面の Senior HP 行に出す文字列。 */
export function formatSprintResultSeniorHp(result: SprintResult): string {
  const remaining = sprintResultSeniorHpRemaining(result);
  return remaining === null ? SENIOR_HP_DISPLAY_UNKNOWN : String(remaining);
}

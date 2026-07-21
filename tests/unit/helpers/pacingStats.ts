/**
 * RI-66: §3.1 ペーシング統計の集計ヘルパ（テスト用）。
 *
 * 壁時計換算は `sprintTempo` の定数を正とし、スプリント間・レビューは
 * 帯中央の固定秒を加算する自動操作モデルで回帰検知する。
 */
import { getAction } from '../../../src/data/actions';
import {
  BETWEEN_SPRINT_WALL_SEC,
  QUARTER_REVIEW_WALL_SEC,
  wallSecondsAt1x,
} from '../../../src/ui/sprintTempo';

/** 利用可能回数見積もりの代表アクション（最安・最短 CD）。 */
const CAPACITY_ACTION_ID = 'firefight' as const;

/**
 * スプリント長と focusMax から、代表介入（firefight）の利用可能回数を見積もる。
 * コンボ返却や複数アクションの併用は見ない（余地の下界に近い回帰指標）。
 */
export function estimateAvailableInterventions(ticks: number, focusMax: number): number {
  if (ticks <= 0 || focusMax <= 0) return 0;
  const def = getAction(CAPACITY_ACTION_ID);
  if (!def) return 0;
  const byCooldown = Math.floor((ticks - 1) / def.cooldownTicks) + 1;
  const byFocus = Math.floor(focusMax / def.cost);
  return Math.min(byCooldown, byFocus);
}

/**
 * 完了スプリント列の 1x 壁時計分をモデル化する。
 * フル四半期（6 本）ごとにスプリント間×5＋レビューを加算し、端数スプリントは間だけ加算する。
 */
export function modelRunWallMinutes(sprintTicks: readonly number[]): number {
  if (sprintTicks.length === 0) return 0;
  const sprintSec = sprintTicks.reduce((sum, ticks) => sum + wallSecondsAt1x(ticks), 0);
  const fullQuarters = Math.floor(sprintTicks.length / 6);
  const remainder = sprintTicks.length % 6;
  let betweenSec = fullQuarters * (5 * BETWEEN_SPRINT_WALL_SEC + QUARTER_REVIEW_WALL_SEC);
  if (remainder > 0) {
    betweenSec += Math.max(0, remainder - 1) * BETWEEN_SPRINT_WALL_SEC;
  }
  return (sprintSec + betweenSec) / 60;
}

/** ちょうど 6 スプリントの四半期壁時計分。 */
export function modelQuarterWallMinutes(sprintTicks: readonly number[]): number {
  if (sprintTicks.length !== 6) {
    throw new Error(`expected 6 sprint ticks, got ${sprintTicks.length}`);
  }
  const sprintSec = sprintTicks.reduce((sum, ticks) => sum + wallSecondsAt1x(ticks), 0);
  return (sprintSec + 5 * BETWEEN_SPRINT_WALL_SEC + QUARTER_REVIEW_WALL_SEC) / 60;
}

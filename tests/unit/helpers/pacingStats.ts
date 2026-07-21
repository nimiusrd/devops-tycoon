/**
 * RI-66: §3.1 ペーシング統計の集計ヘルパ（テスト用）。
 *
 * 壁時計換算は `sprintTempo` の定数を正とし、スプリント間・レビューは
 * 帯内の固定秒を加算する自動操作モデルで回帰検知する。
 */
import {
  BETWEEN_SPRINT_WALL_SEC,
  QUARTER_REVIEW_WALL_SEC,
  wallSecondsAt1x,
} from '../../../src/ui/sprintTempo';

/**
 * 完了スプリント列の 1x 壁時計分をモデル化する。
 *
 * - 四半期レビューに到達した回数だけレビュー秒を加算する（ボス直後敗北は加算しない）。
 * - レビュー済み四半期はスプリント間×5、その後の端数スプリントは間だけ加算する。
 */
export function modelRunWallMinutes(
  sprintTicks: readonly number[],
  quarterReviewsReached = 0,
): number {
  if (sprintTicks.length === 0) return 0;
  const sprintSec = sprintTicks.reduce((sum, ticks) => sum + wallSecondsAt1x(ticks), 0);
  const reviews = Math.max(0, quarterReviewsReached);
  const reviewedSprints = Math.min(sprintTicks.length, reviews * 6);
  const trailing = sprintTicks.length - reviewedSprints;

  let betweenSec = reviews * 5 * BETWEEN_SPRINT_WALL_SEC;
  if (trailing > 0) {
    if (reviews > 0) betweenSec += BETWEEN_SPRINT_WALL_SEC; // レビュー後 → 次スプリント
    betweenSec += Math.max(0, trailing - 1) * BETWEEN_SPRINT_WALL_SEC;
  } else if (reviews === 0) {
    betweenSec += Math.max(0, sprintTicks.length - 1) * BETWEEN_SPRINT_WALL_SEC;
  }

  const reviewSec = reviews * QUARTER_REVIEW_WALL_SEC;
  return (sprintSec + betweenSec + reviewSec) / 60;
}

/**
 * ちょうど 6 スプリントかつ四半期レビュー到達済みの壁時計分。
 * 呼び出し側で `quarterReview` 到達を保証すること。
 */
export function modelQuarterWallMinutes(sprintTicks: readonly number[]): number {
  if (sprintTicks.length !== 6) {
    throw new Error(`expected 6 sprint ticks, got ${sprintTicks.length}`);
  }
  const sprintSec = sprintTicks.reduce((sum, ticks) => sum + wallSecondsAt1x(ticks), 0);
  return (sprintSec + 5 * BETWEEN_SPRINT_WALL_SEC + QUARTER_REVIEW_WALL_SEC) / 60;
}

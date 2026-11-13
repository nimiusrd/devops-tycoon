/**
 * 狭幅盤面で見分け拡大した粒が、別工程の粒と重ならないよう山の基準点を寄せる（#995）。
 *
 * 320 / 390 の内側寸法（枠線を除いた盤面）での contain-fit 縮尺を使い、
 * `presentBoardDots` 後の円同士の交差を数える。Review の静止山だけを動かす。
 */
import type { Lane } from '../sim/types';
import type { BoardDotPlan } from './boardScene';
import { presentBoardDots, presentedDotRadius } from './boardPixiView';
import { DESIGN_SPACES, designToHostTransform } from './visualTokens';

const BOARD_VIEW = DESIGN_SPACES.sprint;

/** 320 / 390 幅の盤面キャンバス内側（#978 の実測）。 */
export const BOARD_PHONE_HOST_SIZES = [
  { width: 288, height: 115.2, name: '320' },
  { width: 358, height: 143.73, name: '390' },
] as const;

export interface BoardPileShift {
  dx: number;
  dy: number;
}

/** 狭幅で粒の見分けが広がるときの判定縮尺（枠線内側の contain-fit）。 */
export function boardPhonePresentationScales(): number[] {
  return BOARD_PHONE_HOST_SIZES.map(
    (host) => designToHostTransform(host.width, host.height, BOARD_VIEW).scale,
  );
}

function circlesOverlap(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
): boolean {
  return Math.hypot(ax - bx, ay - by) < ar + br - 0.01;
}

/**
 * 提示縮尺ごとに、Review 静止粒と他工程粒（フロー含む）の円交差の組数を数える。
 */
export function countReviewCrossStationOverlaps(
  dots: readonly BoardDotPlan[],
  scales: readonly number[] = boardPhonePresentationScales(),
): number {
  let count = 0;
  for (const scale of scales) {
    const presented = presentBoardDots(dots, scale);
    const review = presented.filter((dot) => dot.lane === 'review' && !dot.motion);
    const others = presented.filter((dot) => dot.lane !== 'review');
    for (const left of review) {
      const lr = presentedDotRadius(left.size, scale);
      for (const right of others) {
        const rr = presentedDotRadius(right.size, scale);
        if (circlesOverlap(left.x, left.y, lr, right.x, right.y, rr)) count += 1;
      }
    }
  }
  return count;
}

export function applyLanePileShift(
  dots: readonly BoardDotPlan[],
  lane: Lane,
  shift: BoardPileShift,
): BoardDotPlan[] {
  if (shift.dx === 0 && shift.dy === 0) return [...dots];
  return dots.map((dot) => {
    if (
      dot.lane !== lane ||
      dot.motion ||
      dot.clusterX === undefined ||
      dot.clusterY === undefined
    ) {
      return dot;
    }
    const offsetX = dot.x - dot.clusterX;
    const offsetY = dot.y - dot.clusterY;
    const clusterX = dot.clusterX + shift.dx;
    const clusterY = dot.clusterY + shift.dy;
    return {
      ...dot,
      clusterX,
      clusterY,
      x: clusterX + offsetX,
      y: clusterY + offsetY,
    };
  });
}

/** 移動後も設計盤面の内側に粒の中心が収まるか。 */
function pilesStayOnBoard(dots: readonly BoardDotPlan[], scales: readonly number[]): boolean {
  const { w, h } = DESIGN_SPACES.sprint;
  for (const scale of scales) {
    const presented = presentBoardDots(dots, scale);
    for (const dot of presented) {
      if (dot.lane !== 'review' || dot.motion) continue;
      const radius = presentedDotRadius(dot.size, scale);
      if (
        dot.x - radius < -0.5 ||
        dot.y - radius < -0.5 ||
        dot.x + radius > w + 0.5 ||
        dot.y + radius > h + 0.5
      ) {
        return false;
      }
    }
  }
  return true;
}

const REVIEW_SHIFT_RANGES = [
  {
    dxMin: -12,
    dxMax: 96,
    dyMin: -72,
    dyMax: 12,
    step: 2,
  },
  {
    dxMin: -12,
    dxMax: 148,
    dyMin: -120,
    dyMax: 12,
    step: 2,
  },
] as const;

function pickBetterShift(
  best: (BoardPileShift & { dist: number }) | null,
  dx: number,
  dy: number,
): (BoardPileShift & { dist: number }) | null {
  const dist = Math.hypot(dx, dy);
  const better =
    !best ||
    dist < best.dist - 1e-6 ||
    (Math.abs(dist - best.dist) <= 1e-6 && (dy < best.dy || (dy === best.dy && dx > best.dx)));
  return better ? { dx, dy, dist } : best;
}

function findReviewPileShiftInRange(
  dots: readonly BoardDotPlan[],
  scales: readonly number[],
  range: (typeof REVIEW_SHIFT_RANGES)[number],
): BoardPileShift | null {
  let best: (BoardPileShift & { dist: number }) | null = null;
  for (let dx = range.dxMin; dx <= range.dxMax; dx += range.step) {
    for (let dy = range.dyMin; dy <= range.dyMax; dy += range.step) {
      const shifted = applyLanePileShift(dots, 'review', { dx, dy });
      if (!pilesStayOnBoard(shifted, scales)) continue;
      if (countReviewCrossStationOverlaps(shifted, scales) > 0) continue;
      best = pickBetterShift(best, dx, dy);
    }
  }
  return best ? { dx: best.dx, dy: best.dy } : null;
}

/**
 * Review 山を他工程と重ならない位置へ寄せる最小シフトを決定論的に探す。
 * 交差ゼロのうち移動量が最小。同距離なら上（-y）・右（+x）を優先してフロー通路を空ける。
 */
export function findReviewPileShift(
  dots: readonly BoardDotPlan[],
  scales: readonly number[] = boardPhonePresentationScales(),
): BoardPileShift {
  if (countReviewCrossStationOverlaps(dots, scales) === 0) {
    return { dx: 0, dy: 0 };
  }
  for (const range of REVIEW_SHIFT_RANGES) {
    const shift = findReviewPileShiftInRange(dots, scales, range);
    if (shift) return shift;
  }
  return { dx: 0, dy: 0 };
}

/** Review 静止山があれば、重なりがあるときだけ基準点を寄せた粒配列を返す。 */
export function adjustReviewPileLayout(dots: readonly BoardDotPlan[]): BoardDotPlan[] {
  const reviewPileDots = dots.filter((dot) => dot.lane === 'review' && !dot.motion);
  if (reviewPileDots.length === 0) return [...dots];
  if (countReviewCrossStationOverlaps(dots) === 0) return [...dots];
  const shift = findReviewPileShift(dots);
  return applyLanePileShift(dots, 'review', shift);
}

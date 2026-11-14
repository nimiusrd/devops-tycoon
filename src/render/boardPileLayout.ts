/**
 * 狭幅盤面で見分け拡大した粒が、別工程の粒と重ならないよう山の基準点を寄せる（#995）。
 *
 * 320 / 390 の内側寸法（枠線を除いた盤面）での contain-fit 縮尺を使い、
 * `presentBoardDots` 後の円同士の交差を数える。Review の静止山だけを動かす。
 */
import type { Lane } from '../sim/types';
import type { BoardDotPlan } from './boardScene';
import { BOARD_STATION_CENTERS } from './boardStationCenters';
import {
  presentBoardDots,
  presentBoardDotsWithShiftedReview,
  presentedDotHitsOtherStation,
  presentedDotRadius,
} from './boardPixiView';
import { DESIGN_SPACES, designToHostTransform } from './visualTokens';

const BOARD_STATION_MARKERS = (Object.keys(BOARD_STATION_CENTERS) as Lane[]).map((lane) => ({
  lane,
  x: BOARD_STATION_CENTERS[lane].x,
  y: BOARD_STATION_CENTERS[lane].y,
}));

const BOARD_VIEW = DESIGN_SPACES.sprint;

/** Review 山の横位置合わせで見る提示縮尺（受け入れ 320 / 390 / 1024）。 */
export function reviewPilePresentationScales(
  phoneScales: readonly number[] = boardPhonePresentationScales(),
): number[] {
  const desktop = designToHostTransform(1024, 409.6, BOARD_VIEW).scale;
  if (phoneScales.includes(desktop)) return [...phoneScales];
  return [...phoneScales, desktop];
}

/** 320 / 390 幅の盤面キャンバス内側（#978 の実測）。 */
export const BOARD_PHONE_HOST_SIZES = [
  { width: 288, height: 115.2, name: '320' },
  { width: 358, height: 143.73, name: '390' },
] as const;

/** 320 幅で splitPr 武装＋対象ピッカー表示時の Pixi mount（#918 E2E 実測）。見分け倍率が最大になる。 */
export const BOARD_PHONE_ARMED_HOST = { width: 246.5, height: 98.234375 } as const;

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

/** 工程キャラへのはみ出し判定に足す、武装時の最大見分け縮尺。 */
export function boardPhoneContainmentScales(
  scales: readonly number[] = boardPhonePresentationScales(),
): number[] {
  const armedScale = designToHostTransform(
    BOARD_PHONE_ARMED_HOST.width,
    BOARD_PHONE_ARMED_HOST.height,
    BOARD_VIEW,
  ).scale;
  return scales.some((scale) => Math.abs(scale - armedScale) < 1e-9)
    ? [...scales]
    : [...scales, armedScale];
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

interface ReviewOverlapCache {
  scale: number;
  basePresented: BoardDotPlan[];
  others: Array<{ x: number; y: number; size: BoardDotPlan['size'] }>;
  reviewIndexes: number[];
}

function buildReviewOverlapCaches(
  dots: readonly BoardDotPlan[],
  scales: readonly number[],
): ReviewOverlapCache[] {
  return scales.map((scale) => {
    const basePresented = presentBoardDots(dots, scale);
    const reviewIndexes: number[] = [];
    const others: ReviewOverlapCache['others'] = [];
    dots.forEach((dot, index) => {
      if (dot.lane === 'review' && !dot.motion) reviewIndexes.push(index);
      else if (dot.lane !== 'review') {
        const presented = basePresented[index];
        others.push({ x: presented.x, y: presented.y, size: presented.size });
      }
    });
    return { scale, basePresented, others, reviewIndexes };
  });
}

function countOverlapsFromPresented(
  reviewDots: readonly BoardDotPlan[],
  others: ReviewOverlapCache['others'],
  scale: number,
): number {
  let count = 0;
  for (const left of reviewDots) {
    const lr = presentedDotRadius(left.size, scale);
    for (const right of others) {
      const rr = presentedDotRadius(right.size, scale);
      if (circlesOverlap(left.x, left.y, lr, right.x, right.y, rr)) count += 1;
    }
  }
  return count;
}

/**
 * 提示縮尺ごとに、Review 静止粒と他工程粒（フロー含む）の円交差の組数を数える。
 */
export function countReviewCrossStationOverlaps(
  dots: readonly BoardDotPlan[],
  scales: readonly number[] = boardPhonePresentationScales(),
): number {
  const caches = buildReviewOverlapCaches(dots, scales);
  return countReviewCrossStationOverlapsWithCaches(dots, caches);
}

function countReviewCrossStationOverlapsWithCaches(
  dots: readonly BoardDotPlan[],
  caches: readonly ReviewOverlapCache[],
): number {
  let count = 0;
  for (const cache of caches) {
    const presented = presentBoardDotsWithShiftedReview(dots, cache.basePresented, cache.scale);
    const review = cache.reviewIndexes.map((index) => presented[index]);
    count += countOverlapsFromPresented(review, cache.others, cache.scale);
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

/** 提示後の Review 静止粒が別工程キャラにはみ出さないか（#918 と同じ基準）。 */
function reviewDotsAvoidOtherStations(
  dots: readonly BoardDotPlan[],
  scales: readonly number[],
): boolean {
  for (const scale of scales) {
    for (const dot of dots) {
      if (dot.lane !== 'review' || dot.motion) continue;
      if (presentedDotHitsOtherStation(dot, scale, BOARD_STATION_MARKERS)) return false;
    }
  }
  return true;
}

function pilesStayOnBoardWithCaches(
  dots: readonly BoardDotPlan[],
  caches: readonly ReviewOverlapCache[],
): boolean {
  const { w, h } = DESIGN_SPACES.sprint;
  for (const cache of caches) {
    const presented = presentBoardDotsWithShiftedReview(dots, cache.basePresented, cache.scale);
    for (const index of cache.reviewIndexes) {
      const dot = presented[index];
      const radius = presentedDotRadius(dot.size, cache.scale);
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

const REVIEW_SHIFT_COMPACT = {
  dxMin: -40,
  dxMax: 96,
  dyMin: -72,
  dyMax: 12,
  step: 2,
} as const;

const REVIEW_SHIFT_EXTENDED_COARSE = {
  dxMin: -40,
  dxMax: 148,
  dyMin: -200,
  dyMax: 12,
  step: 4,
} as const;

type RankedReviewShift = BoardPileShift & { dist: number; centerOff: number };

/** 山の寄せ探索用。提示計算なしで計画座標の重心から CSS 横ずれを見積もる。 */
function reviewPilePlannedCenteringOffset(
  shifted: readonly BoardDotPlan[],
  scales: readonly number[] = reviewPilePresentationScales(),
): number {
  const review = shifted.filter((dot) => dot.lane === 'review' && !dot.motion);
  if (review.length === 0) return 0;
  const centroidX = review.reduce((sum, dot) => sum + dot.x, 0) / review.length;
  const stationX = BOARD_STATION_CENTERS.review.x;
  let maxOff = 0;
  for (const scale of scales) {
    maxOff = Math.max(maxOff, Math.abs(centroidX - stationX) * scale);
  }
  return maxOff;
}

function reviewPilePresentedCentroidX(
  dots: readonly BoardDotPlan[],
  scale: number,
  basePresented?: readonly BoardDotPlan[],
): number | null {
  const review = dots.filter((dot) => dot.lane === 'review' && !dot.motion);
  if (review.length === 0) return null;
  const presented =
    basePresented && basePresented.length === dots.length
      ? presentBoardDotsWithShiftedReview(dots, basePresented, scale)
      : presentBoardDots(dots, scale);
  const shown = presented.filter((dot) => dot.lane === 'review' && !dot.motion);
  if (shown.length === 0) return null;
  return shown.reduce((sum, dot) => sum + dot.x, 0) / shown.length;
}

/** 提示後の Review 重心とステーション中心との最大 CSS 横ずれ。 */
function reviewPilePresentedCenteringOffset(
  shifted: readonly BoardDotPlan[],
  scales: readonly number[],
  caches?: readonly ReviewOverlapCache[],
): number {
  const stationX = BOARD_STATION_CENTERS.review.x;
  let maxOff = 0;
  for (const scale of scales) {
    const cache = caches?.find((entry) => Math.abs(entry.scale - scale) < 1e-9);
    const centroidX = reviewPilePresentedCentroidX(shifted, scale, cache?.basePresented);
    if (centroidX === null) continue;
    maxOff = Math.max(maxOff, Math.abs(centroidX - stationX) * scale);
  }
  return maxOff;
}

function refineReviewPilePresentedCentering(
  dots: readonly BoardDotPlan[],
  scales: readonly number[],
  caches: readonly ReviewOverlapCache[],
  containmentScales: readonly number[],
  base: BoardPileShift,
): BoardPileShift {
  let bestShift = base;
  let bestOff = reviewPilePresentedCenteringOffset(
    applyLanePileShift(dots, 'review', base),
    scales,
    caches,
  );
  for (let dx = base.dx - 16; dx <= base.dx + 16; dx += 4) {
    for (let dy = base.dy - 8; dy <= base.dy + 8; dy += 4) {
      const shift = { dx, dy };
      const shifted = applyLanePileShift(dots, 'review', shift);
      if (!pilesStayOnBoardWithCaches(shifted, caches)) continue;
      if (!reviewDotsAvoidOtherStations(shifted, containmentScales)) continue;
      if (countReviewCrossStationOverlapsWithCaches(shifted, caches) > 0) continue;
      const off = reviewPilePresentedCenteringOffset(shifted, scales, caches);
      const dist = Math.hypot(dx, dy);
      const bestDist = Math.hypot(bestShift.dx, bestShift.dy);
      const better =
        off < bestOff - 1e-6 ||
        (Math.abs(off - bestOff) <= 1e-6 &&
          (dist < bestDist - 1e-6 || (Math.abs(dist - bestDist) <= 1e-6 && dy < bestShift.dy)));
      if (better) {
        bestOff = off;
        bestShift = shift;
      }
    }
  }
  return bestShift;
}

function pickBetterShift(
  best: RankedReviewShift | null,
  dx: number,
  dy: number,
  centerOff: number,
): RankedReviewShift | null {
  const dist = Math.hypot(dx, dy);
  const better =
    !best ||
    centerOff < best.centerOff - 1e-6 ||
    (Math.abs(centerOff - best.centerOff) <= 1e-6 &&
      (dist < best.dist - 1e-6 ||
        (Math.abs(dist - best.dist) <= 1e-6 &&
          (dy < best.dy || (dy === best.dy && dx > best.dx)))));
  return better ? { dx, dy, dist, centerOff } : best;
}

function findReviewPileShiftInRange(
  dots: readonly BoardDotPlan[],
  scales: readonly number[],
  caches: readonly ReviewOverlapCache[],
  containmentScales: readonly number[],
  range: { dxMin: number; dxMax: number; dyMin: number; dyMax: number; step: number },
): BoardPileShift | null {
  let best: RankedReviewShift | null = null;
  for (let dx = range.dxMin; dx <= range.dxMax; dx += range.step) {
    for (let dy = range.dyMin; dy <= range.dyMax; dy += range.step) {
      const shifted = applyLanePileShift(dots, 'review', { dx, dy });
      if (!pilesStayOnBoardWithCaches(shifted, caches)) continue;
      if (!reviewDotsAvoidOtherStations(shifted, containmentScales)) continue;
      if (countReviewCrossStationOverlapsWithCaches(shifted, caches) > 0) continue;
      const centerOff = reviewPilePlannedCenteringOffset(shifted, scales);
      best = pickBetterShift(best, dx, dy, centerOff);
    }
  }
  return best ? { dx: best.dx, dy: best.dy } : null;
}

/** 粗探索で見つけた解を、2px 刻みでより小さい移動へ寄せる。 */
function refineReviewPileShift(
  dots: readonly BoardDotPlan[],
  scales: readonly number[],
  caches: readonly ReviewOverlapCache[],
  containmentScales: readonly number[],
  coarse: BoardPileShift,
): BoardPileShift {
  const coarseOffset = reviewPilePlannedCenteringOffset(
    applyLanePileShift(dots, 'review', coarse),
    scales,
  );
  let best = pickBetterShift(null, coarse.dx, coarse.dy, coarseOffset)!;
  for (
    let dx = Math.max(REVIEW_SHIFT_COMPACT.dxMin, coarse.dx - 4);
    dx <= Math.min(REVIEW_SHIFT_EXTENDED_COARSE.dxMax, coarse.dx + 4);
    dx += 2
  ) {
    for (
      let dy = Math.max(REVIEW_SHIFT_EXTENDED_COARSE.dyMin, coarse.dy - 4);
      dy <= Math.min(REVIEW_SHIFT_COMPACT.dyMax, coarse.dy + 4);
      dy += 2
    ) {
      const shifted = applyLanePileShift(dots, 'review', { dx, dy });
      if (!pilesStayOnBoardWithCaches(shifted, caches)) continue;
      if (!reviewDotsAvoidOtherStations(shifted, containmentScales)) continue;
      if (countReviewCrossStationOverlapsWithCaches(shifted, caches) > 0) continue;
      const centerOff = reviewPilePlannedCenteringOffset(shifted, scales);
      best = pickBetterShift(best, dx, dy, centerOff)!;
    }
  }
  return { dx: best.dx, dy: best.dy };
}

/**
 * Review 山を他工程と重ならない位置へ寄せる最小シフトを決定論的に探す。
 * 交差ゼロのうち移動量が最小。同距離なら上（-y）・右（+x）を優先してフロー通路を空ける。
 */
export function findReviewPileShift(
  dots: readonly BoardDotPlan[],
  scales: readonly number[] = boardPhonePresentationScales(),
): BoardPileShift {
  const caches = buildReviewOverlapCaches(dots, scales);
  const containmentScales = boardPhoneContainmentScales(scales);
  if (countReviewCrossStationOverlapsWithCaches(dots, caches) === 0) {
    return { dx: 0, dy: 0 };
  }
  const centeringScales = reviewPilePresentationScales(scales);
  const compact = findReviewPileShiftInRange(
    dots,
    scales,
    caches,
    containmentScales,
    REVIEW_SHIFT_COMPACT,
  );
  if (compact) {
    return refineReviewPilePresentedCentering(
      dots,
      centeringScales,
      caches,
      containmentScales,
      compact,
    );
  }
  const coarse = findReviewPileShiftInRange(
    dots,
    scales,
    caches,
    containmentScales,
    REVIEW_SHIFT_EXTENDED_COARSE,
  );
  if (coarse) {
    return refineReviewPilePresentedCentering(
      dots,
      centeringScales,
      caches,
      containmentScales,
      refineReviewPileShift(dots, scales, caches, containmentScales, coarse),
    );
  }
  return { dx: 0, dy: 0 };
}

function reviewPileShiftCacheKey(dots: readonly BoardDotPlan[]): string {
  const review = dots.filter((dot) => dot.lane === 'review' && !dot.motion);
  if (review.length === 0) return '';
  const anchor = review[0];
  const reviewSignature = review
    .map((dot) => `${dot.id}:${dot.size}@${Math.round(dot.x)},${Math.round(dot.y)}`)
    .sort()
    .join(';');
  const othersSignature = dots
    .filter((dot) => dot.lane !== 'review')
    .map((dot) => `${dot.id}:${dot.size}@${Math.round(dot.x)},${Math.round(dot.y)}`)
    .sort()
    .join(';');
  return `${review.length}:${anchor.clusterX}:${anchor.clusterY}:${reviewSignature}|${othersSignature}`;
}

const reviewPileShiftCache = new Map<string, BoardPileShift>();

/** Review 静止山があれば、重なりがあるときだけ基準点を寄せた粒配列を返す。 */
export function adjustReviewPileLayout(dots: readonly BoardDotPlan[]): BoardDotPlan[] {
  const reviewPileDots = dots.filter((dot) => dot.lane === 'review' && !dot.motion);
  if (reviewPileDots.length === 0) return [...dots];
  if (countReviewCrossStationOverlaps(dots) === 0) return [...dots];
  const cacheKey = reviewPileShiftCacheKey(dots);
  const cached = reviewPileShiftCache.get(cacheKey);
  if (cached) {
    const shifted = applyLanePileShift(dots, 'review', cached);
    if (countReviewCrossStationOverlaps(shifted) === 0) return shifted;
  }
  const shift = findReviewPileShift(dots);
  reviewPileShiftCache.set(cacheKey, shift);
  return applyLanePileShift(dots, 'review', shift);
}

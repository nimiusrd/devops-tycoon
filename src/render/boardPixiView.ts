/**
 * スプリント盤面 PixiJS レンダラの純ヘルパ（RI-11 / RI-07 / SPEC 第22.4）。
 *
 * GPU に触らない数値計算だけを置き、Vitest で検証する（第22.5）。
 * - ドラッグ介入（RI-30）の粒ヒット判定（DOM の pointerdown ターゲット特定の Pixi 代替）
 * - CSS keyframes（flowBobDrift / flybob / fireShake）と同じ見え方の時間関数
 * - 焼き込みテクスチャ（RenderTexture）のキャッシュキー
 * contain-fit は部署ビューと同じ `containFitTransform`（deptPixiView.ts）を使う。
 */
import type { Lane } from '../sim/types';
import {
  BOARD_STATION_CENTERS,
  type BoardDotPlan,
  type BoardReviewTrailPlan,
  type StationMood,
} from './boardScene';
import { BOARD_RENDER_BUDGETS } from './boardRenderBudget';
import type { TaskSize, TaskVariant } from './taskView';
import { TASK_DIAMETER } from './taskView';
import { DESIGN_SPACES, VISUAL_TOKENS } from './visualTokens';

/** 設計座標の点。 */
export interface BoardPoint {
  x: number;
  y: number;
}

/** reduced motion では全ての盤面アニメを決定論的な位相 0 に固定する。 */
export function boardAnimationElapsedMs(elapsedMs: number, reducedMotion: boolean): number {
  return reducedMotion ? 0 : elapsedMs;
}

/** DOM と同じ粒の重なり順。 */
export function boardDotLayer(
  dot: BoardDotPlan,
  draggable: boolean,
  dragging: boolean,
  preview = false,
): number {
  const layers = VISUAL_TOKENS.layers.sprint;
  if (dragging) return layers.dragging;
  if (preview) return layers.targetPreview;
  if (draggable) return layers.dragCandidate;
  if (dot.motion || dot.fire) return layers.foreground;
  return layers.task;
}

export interface BoardDotRenderPlan {
  dots: BoardDotPlan[];
  requested: number;
  dropped: number;
}

function dotRetentionPriority(
  dot: BoardDotPlan,
  draggable: boolean,
  dragging: boolean,
  preview: boolean,
): number {
  if (dragging) return 6;
  if (preview) return 5;
  if (dot.fire) return 4;
  if (draggable) return 3;
  if (dot.motion) return 2;
  return 1;
}

/**
 * 上限超過時も操作中・確定前対象・炎上・操作候補を優先し、最後に画家順へ戻す。
 * 同順位は scene 順で安定化するため、同一状態から同じ描画結果になる。
 */
export function planBoardDotsForRender(
  dots: readonly BoardDotPlan[],
  draggableIds: ReadonlySet<number> = new Set<number>(),
  dragTaskId: number | null = null,
  budget = BOARD_RENDER_BUDGETS.dots,
  previewTaskId: number | null = null,
): BoardDotRenderPlan {
  const capacity = Math.max(0, Math.floor(budget));
  const annotated = dots.map((dot, index) => {
    const draggable = draggableIds.has(dot.id);
    const dragging = dot.id === dragTaskId;
    const preview = dot.id === previewTaskId;
    return {
      dot,
      index,
      layer: boardDotLayer(dot, draggable, dragging, preview),
      priority: dotRetentionPriority(dot, draggable, dragging, preview),
    };
  });
  const selected = annotated
    .sort((a, b) => b.priority - a.priority || a.index - b.index)
    .slice(0, capacity)
    .sort((a, b) => a.layer - b.layer || a.index - b.index);
  return {
    dots: selected.map(({ dot }) => dot),
    requested: dots.length,
    dropped: Math.max(0, dots.length - selected.length),
  };
}

/** 選択対象の静止二重リング。縮尺が小さくても CSS px の輪郭幅と径を保つ。 */
export function boardDotPreviewRing(size: TaskSize, scale: number) {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const tokens = VISUAL_TOKENS.dimensions.sprint.dotPreview;
  const strokeWidth = tokens.strokeCssWidth / safeScale;
  return {
    radius: Math.max(TASK_DIAMETER[size] / 2 + 6, tokens.minCssDiameter / 2 / safeScale),
    strokeWidth,
    outlineWidth: strokeWidth + (2 * tokens.outlineCssWidth) / safeScale,
  };
}

/** ヒット判定の許容マージン（設計px。指先で小粒も掴めるように少し広げる）。 */
export const DOT_HIT_MARGIN = VISUAL_TOKENS.dimensions.sprint.dotHitMargin;

/**
 * 小さい粒の画面上直径が最小値を下回るとき、粒と山の間隔へかける倍率。
 * 広い盤面（contain-fit 0.5 以上）では 1 で、構える前の配置を変えない。
 */
export function boardDotReadabilityMagnification(cssScale: number): number {
  if (!Number.isFinite(cssScale) || cssScale <= 0) return 1;
  const minCss = VISUAL_TOKENS.dimensions.sprint.taskDotMinCssDiameter;
  const natural = VISUAL_TOKENS.dimensions.sprint.taskDiameter.small * cssScale;
  if (natural >= minCss) return 1;
  return minCss / natural;
}

/** 画面上の粒直径。倍率 1 のときは設計直径×縮尺のまま。 */
export function boardDotCssDiameter(size: TaskSize, cssScale: number): number {
  return TASK_DIAMETER[size] * cssScale * boardDotReadabilityMagnification(cssScale);
}

/** 拡大後の粒半径（設計 px）。倍率 1 のときは設計半径のまま。 */
export function presentedDotRadius(size: TaskSize, cssScale: number): number {
  return (TASK_DIAMETER[size] / 2) * boardDotReadabilityMagnification(cssScale);
}

/** ステーションキャラの半幅・半高（設計 px）。描画の anchor 0.5 と同じ箱。 */
export function boardActorHalfExtents(): BoardPoint {
  const sprint = VISUAL_TOKENS.dimensions.sprint;
  const width = (DESIGN_SPACES.sprint.w * sprint.stationWidthPercent) / 100;
  const height = (width * sprint.actor.dom.h) / sprint.actor.dom.w;
  return { x: width / 2, y: height / 2 };
}

const BOARD_ACTORS = (Object.keys(BOARD_STATION_CENTERS) as Lane[]).map((lane) => ({
  lane,
  x: BOARD_STATION_CENTERS[lane].x,
  y: BOARD_STATION_CENTERS[lane].y,
}));

/**
 * 山の基準点が自分の工程の中心からこの距離以内なら、その工程の粒として収める。
 * 完了の山が工程中心から約 80 設計px 離れるため、それより広く、任意座標の判定用の粒は含めない。
 */
const OWN_STATION_PILE_REACH = 120;

function belongsToOwnStationPile(dot: BoardDotPlan): boolean {
  if (dot.clusterX === undefined || dot.clusterY === undefined) return false;
  const station = BOARD_STATION_CENTERS[dot.lane];
  return Math.hypot(dot.clusterX - station.x, dot.clusterY - station.y) <= OWN_STATION_PILE_REACH;
}

/** 粒の円が設計盤面の外に出て、端で切れるか。 */
function circleLeavesDesignBoard(x: number, y: number, radius: number): boolean {
  const { w, h } = DESIGN_SPACES.sprint;
  return x - radius < -0.5 || y - radius < -0.5 || x + radius > w + 0.5 || y + radius > h + 0.5;
}

/**
 * 円が別工程のキャラ枠に入るか。
 * 自分の工程は山の置き場なので見ない。半径 0.5px 未満の食い込みは接触とみなさない。
 */
function circleHitsOtherStation(
  x: number,
  y: number,
  radius: number,
  lane: Lane,
  stations: readonly { lane: Lane; x: number; y: number }[],
): boolean {
  const limit = radius - 0.5;
  if (limit <= 0) return false;
  const half = boardActorHalfExtents();
  return stations.some((station) => {
    if (station.lane === lane) return false;
    const nearestX = Math.max(station.x - half.x, Math.min(x, station.x + half.x));
    const nearestY = Math.max(station.y - half.y, Math.min(y, station.y + half.y));
    const dx = x - nearestX;
    const dy = y - nearestY;
    return dx * dx + dy * dy < limit * limit;
  });
}

/** その中心なら、盤面の内側に収まり、静止粒は別工程のキャラに入らない。 */
function pointFits(dot: BoardDotPlan, x: number, y: number, cssScale: number): boolean {
  const radius = presentedDotRadius(dot.size, cssScale);
  if (circleLeavesDesignBoard(x, y, radius)) return false;
  // フロー上の粒は工程の間を通る。基準点が工程の山でない粒は、判定用の任意座標なので動かさない。
  if (dot.motion || !belongsToOwnStationPile(dot)) return true;
  return !circleHitsOtherStation(x, y, radius, dot.lane, BOARD_ACTORS);
}

/**
 * 広げた位置が盤面の外、または静止粒が別工程に入るとき、基準点へ戻す割合（0..1）。
 * 収まるときは 1。見た目の直径は変えず、中心だけを戻す。
 */
function containmentScale(
  dot: BoardDotPlan,
  anchorX: number,
  anchorY: number,
  spreadX: number,
  spreadY: number,
  cssScale: number,
): number {
  const fits = (t: number) =>
    pointFits(dot, anchorX + spreadX * t, anchorY + spreadY * t, cssScale);
  if (fits(1)) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 16; i += 1) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * 山の基準点でも別工程に入るとき、自分の工程の中心へ必要分だけ寄せる。
 * 直径は変えない。自分のキャラに乗るのは山の置き場なので許容する。
 */
function retreatTowardOwnStation(
  dot: BoardDotPlan,
  x: number,
  y: number,
  cssScale: number,
): BoardPoint {
  const station = BOARD_STATION_CENTERS[dot.lane];
  let dirX = station.x - x;
  let dirY = station.y - y;
  let len = Math.hypot(dirX, dirY);
  if (len < 1) {
    let nearest = Infinity;
    dirX = 0;
    dirY = -1;
    for (const actor of BOARD_ACTORS) {
      if (actor.lane === dot.lane) continue;
      const dx = x - actor.x;
      const dy = y - actor.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 0 && distance < nearest) {
        nearest = distance;
        dirX = dx / distance;
        dirY = dy / distance;
      }
    }
    len = 1;
  }
  dirX /= len;
  dirY /= len;
  const maxDist = Math.hypot(DESIGN_SPACES.sprint.w, DESIGN_SPACES.sprint.h);
  const at = (distance: number): BoardPoint => ({
    x: x + dirX * distance,
    y: y + dirY * distance,
  });
  if (!pointFits(dot, at(maxDist).x, at(maxDist).y, cssScale)) {
    let best = { x, y };
    for (let distance = 0; distance <= maxDist; distance += 4) {
      const point = at(distance);
      if (circleLeavesDesignBoard(point.x, point.y, presentedDotRadius(dot.size, cssScale))) break;
      best = point;
      if (pointFits(dot, point.x, point.y, cssScale)) return point;
    }
    return best;
  }
  let lo = 0;
  let hi = maxDist;
  for (let i = 0; i < 16; i += 1) {
    const mid = (lo + hi) / 2;
    const point = at(mid);
    if (pointFits(dot, point.x, point.y, cssScale)) hi = mid;
    else lo = mid;
  }
  return at(hi);
}

function nearestOtherActor(lane: Lane, point: BoardPoint): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestDistance = Infinity;
  for (const actor of BOARD_ACTORS) {
    if (actor.lane === lane) continue;
    const distance = Math.hypot(point.x - actor.x, point.y - actor.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = actor;
    }
  }
  return best;
}

/** 原点から (dx, dy) 方向へ、収まる最長距離。上限は maxDist。 */
function maxFitDistance(
  dot: BoardDotPlan,
  origin: BoardPoint,
  dx: number,
  dy: number,
  maxDist: number,
  cssScale: number,
): number {
  const fits = (distance: number) =>
    pointFits(dot, origin.x + dx * distance, origin.y + dy * distance, cssScale);
  if (maxDist <= 0 || !fits(0)) return 0;
  if (fits(maxDist)) return maxDist;
  let lo = 0;
  let hi = maxDist;
  for (let i = 0; i < 16; i += 1) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * 基準点方向へ戻して捨てた分を、隣の工程から離れる横方向へ移す。
 * 同じ境界へ独立に寄せると中心が重なり、奥の粒を選べなくなる。
 */
function shiftOverflowAside(
  dot: BoardDotPlan,
  clamped: BoardPoint,
  overflowX: number,
  overflowY: number,
  cssScale: number,
): BoardPoint {
  const overflow = Math.hypot(overflowX, overflowY);
  if (overflow < 0.5) return clamped;
  let sideX = -overflowY / overflow;
  let sideY = overflowX / overflow;
  const nearest = nearestOtherActor(dot.lane, clamped);
  if (nearest) {
    const awayX = clamped.x - nearest.x;
    const awayY = clamped.y - nearest.y;
    if (sideX * awayX + sideY * awayY < 0) {
      sideX = -sideX;
      sideY = -sideY;
    }
  }
  // 隣の工程から離れる側を優先する。反対側の方が長く動けるときも、山を横切って
  // 別の段へ被さらないよう、離れる側が少しでも空いていればそちらへ寄せる。
  const preferred = maxFitDistance(dot, clamped, sideX, sideY, overflow, cssScale);
  const opposite = maxFitDistance(dot, clamped, -sideX, -sideY, overflow, cssScale);
  const distance = preferred >= 0.5 ? preferred : opposite;
  if (distance < 0.5) return clamped;
  const sign = preferred >= 0.5 ? 1 : -1;
  return {
    x: clamped.x + sideX * sign * distance,
    y: clamped.y + sideY * sign * distance,
  };
}

/**
 * 見分けの倍率で、山（またはフロー）の基準点から粒を広げた座標。
 * 盤面の外へ出る粒と、別工程のキャラに入る静止粒は、収まるところまで基準点へ戻す。
 * 戻して余った分は横へずらし、同じ境界に粒が重ならないようにする。
 * 倍率 1 のときは同じオブジェクトを返す。
 */
export function presentBoardDot(dot: BoardDotPlan, cssScale: number): BoardDotPlan {
  const magnification = boardDotReadabilityMagnification(cssScale);
  if (magnification === 1) return dot;
  const anchorX = dot.clusterX ?? dot.x;
  const anchorY = dot.clusterY ?? dot.y;
  const spreadX = (dot.x - anchorX) * magnification;
  const spreadY = (dot.y - anchorY) * magnification;
  const t = containmentScale(dot, anchorX, anchorY, spreadX, spreadY, cssScale);
  let x = anchorX + spreadX * t;
  let y = anchorY + spreadY * t;
  // 山の中心自体が隣の工程に入る大きい粒は、自分の工程の中心側へ寄せる。
  if (!dot.motion && belongsToOwnStationPile(dot) && !pointFits(dot, x, y, cssScale)) {
    const retreated = retreatTowardOwnStation(dot, x, y, cssScale);
    x = retreated.x;
    y = retreated.y;
  } else if (!dot.motion && belongsToOwnStationPile(dot) && t < 1) {
    const shifted = shiftOverflowAside(
      dot,
      { x, y },
      spreadX * (1 - t),
      spreadY * (1 - t),
      cssScale,
    );
    x = shifted.x;
    y = shifted.y;
  }
  if (x === dot.x && y === dot.y) return dot;
  return { ...dot, x, y };
}

function fullSpreadPoint(dot: BoardDotPlan, cssScale: number): BoardPoint {
  const magnification = boardDotReadabilityMagnification(cssScale);
  const anchorX = dot.clusterX ?? dot.x;
  const anchorY = dot.clusterY ?? dot.y;
  return {
    x: anchorX + (dot.x - anchorX) * magnification,
    y: anchorY + (dot.y - anchorY) * magnification,
  };
}

/** 別工程や盤面の外を避けて、広げきった位置から戻した粒か。 */
function wasPulledBack(dot: BoardDotPlan, presented: BoardDotPlan, cssScale: number): boolean {
  const full = fullSpreadPoint(dot, cssScale);
  return Math.hypot(presented.x - full.x, presented.y - full.y) > 0.5;
}

/**
 * 戻した粒を、相手の円の外へ押し出す。
 * 戻した側が動けない分は、収まる相手が引き受ける。
 */
function nudgePulledPair(
  presented: BoardDotPlan[],
  planned: readonly BoardDotPlan[],
  i: number,
  j: number,
  cssScale: number,
): boolean {
  const a = presented[i];
  const b = presented[j];
  const iPulled = wasPulledBack(planned[i], a, cssScale);
  const jPulled = wasPulledBack(planned[j], b, cssScale);
  if (!iPulled && !jPulled) return false;
  const need =
    Math.max(presentedDotRadius(a.size, cssScale), presentedDotRadius(b.size, cssScale)) + 0.5;
  const presentedDx = b.x - a.x;
  const presentedDy = b.y - a.y;
  const presentedDist = Math.hypot(presentedDx, presentedDy);
  if (presentedDist >= need) return false;
  let dx = presentedDx;
  let dy = presentedDy;
  let axisLen = presentedDist;
  if (axisLen < 0.5) {
    dx = planned[j].x - planned[i].x;
    dy = planned[j].y - planned[i].y;
    axisLen = Math.hypot(dx, dy);
    if (axisLen < 0.5) {
      dx = 0;
      dy = 1;
      axisLen = 1;
    }
  }
  const ux = dx / axisLen;
  const uy = dy / axisLen;
  const deficit = need - presentedDist;
  const iRoom = maxFitDistance(planned[i], a, -ux, -uy, deficit, cssScale);
  const jRoom = maxFitDistance(planned[j], b, ux, uy, deficit, cssScale);
  const iCap = iPulled ? iRoom : 0;
  const jCap = jPulled ? jRoom : 0;
  let iDist = Math.min(iCap, deficit / 2);
  let jDist = Math.min(jCap, deficit - iDist);
  if (iDist + jDist + 0.01 < deficit) iDist = Math.min(iCap, deficit - jDist);
  let remain = deficit - iDist - jDist;
  if (remain > 0.5 && !iPulled) {
    const extra = Math.min(iRoom, remain);
    iDist += extra;
    remain -= extra;
  }
  if (remain > 0.5 && !jPulled) {
    jDist += Math.min(jRoom, remain);
  }
  if (iDist < 0.5 && jDist < 0.5) return false;
  if (iDist >= 0.5) presented[i] = { ...a, x: a.x - ux * iDist, y: a.y - uy * iDist };
  if (jDist >= 0.5) presented[j] = { ...b, x: b.x + ux * jDist, y: b.y + uy * jDist };
  return true;
}

/**
 * 同じ山で境界へ戻した粒が、互いの中心を選べなくなっているときだけ押し離す。
 * 広げきった粒は、戻した粒の逃げ場がないときだけ必要分を譲る。
 */
function separatePulledPileDots(
  presented: BoardDotPlan[],
  planned: readonly BoardDotPlan[],
  cssScale: number,
): void {
  const indexesByPile = new Map<string, number[]>();
  for (let i = 0; i < planned.length; i += 1) {
    const dot = planned[i];
    if (dot.motion || !belongsToOwnStationPile(dot)) continue;
    const key = `${dot.lane}:${dot.clusterX}:${dot.clusterY}`;
    const list = indexesByPile.get(key);
    if (list) list.push(i);
    else indexesByPile.set(key, [i]);
  }
  for (const indexes of indexesByPile.values()) {
    const pulled = indexes.filter((index) =>
      wasPulledBack(planned[index], presented[index], cssScale),
    );
    if (pulled.length === 0) continue;
    for (let iter = 0; iter < 12; iter += 1) {
      let moved = false;
      for (let left = 0; left < indexes.length; left += 1) {
        for (let right = left + 1; right < indexes.length; right += 1) {
          if (nudgePulledPair(presented, planned, indexes[left], indexes[right], cssScale)) {
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
  }
}

/**
 * 山の粒を、見分けの倍率で広げてから互いに重ならない中心へ置く。
 * 倍率 1 のときは粒ごとの結果だけを返す。
 */
export function presentBoardDots(dots: readonly BoardDotPlan[], cssScale: number): BoardDotPlan[] {
  const presented = dots.map((dot) => presentBoardDot(dot, cssScale));
  if (boardDotReadabilityMagnification(cssScale) === 1) return presented;
  separatePulledPileDots(presented, dots, cssScale);
  return presented;
}

/**
 * 演出が保存した計画座標を、今の粒と同じ表示位置へ移す。
 * 押し離しは入力順に依存するため、描画順へ並べ替える前の scene 順で求めた結果を渡す。
 * 倍率 1、または山から離れたフロー上の点は、計画のまま返す。
 */
export function presentBoardEffectPoint(
  point: BoardPoint,
  planned: readonly BoardDotPlan[],
  presented: readonly BoardDotPlan[],
  cssScale: number,
): BoardPoint {
  if (boardDotReadabilityMagnification(cssScale) === 1 || planned.length !== presented.length) {
    return point;
  }
  let best = -1;
  let bestDist = 0.75;
  for (let i = 0; i < planned.length; i += 1) {
    const dist = Math.hypot(planned[i].x - point.x, planned[i].y - point.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  if (best >= 0) return { x: presented[best].x, y: presented[best].y };

  let host: BoardDotPlan | null = null;
  let hostDist = Infinity;
  for (const dot of planned) {
    if (dot.motion || dot.clusterX === undefined || dot.clusterY === undefined) continue;
    const dist = Math.hypot(dot.clusterX - point.x, dot.clusterY - point.y);
    if (dist < hostDist) {
      hostDist = dist;
      host = dot;
    }
  }
  if (!host || host.clusterX === undefined || host.clusterY === undefined) return point;
  if (hostDist > OWN_STATION_PILE_REACH) return point;
  const synthetic = presentBoardDot(
    { ...host, x: point.x, y: point.y, motion: undefined },
    cssScale,
  );
  return { x: synthetic.x, y: synthetic.y };
}

/** 軌跡の根元を、同じ粒の拡大後の中心へ合わせる。倍率 1 のときは計画のまま。 */
export function presentBoardReviewTrail(
  trail: BoardReviewTrailPlan,
  dot: BoardDotPlan | undefined,
  cssScale: number,
): BoardReviewTrailPlan {
  if (!dot || dot.id !== trail.taskId) return trail;
  const presented = presentBoardDot(dot, cssScale);
  if (presented.x === trail.x && presented.y === trail.y) return trail;
  return { ...trail, x: presented.x, y: presented.y };
}

/** 表示後の粒の円が設計盤面の外にはみ出し、端で切れるか。 */
export function presentedDotLeavesBoard(dot: BoardDotPlan, cssScale: number): boolean {
  const presented = presentBoardDot(dot, cssScale);
  return circleLeavesDesignBoard(presented.x, presented.y, presentedDotRadius(dot.size, cssScale));
}

/**
 * 表示後の静止した粒が、別工程のキャラに重なるか。
 * フロー上の粒は工程間を通るので対象外。自分の工程のキャラに乗るのは山の置き場なので許容する。
 */
export function presentedDotHitsOtherStation(
  dot: BoardDotPlan,
  cssScale: number,
  stations: readonly { lane: Lane; x: number; y: number }[],
): boolean {
  if (dot.motion) return false;
  const presented = presentBoardDot(dot, cssScale);
  return circleHitsOtherStation(
    presented.x,
    presented.y,
    presentedDotRadius(dot.size, cssScale),
    dot.lane,
    stations,
  );
}

/**
 * 設計座標の点から、掴めるタスク粒を特定する（RI-30 のドラッグ開始判定）。
 *
 * 粒半径＋設計マージンを保ちつつ、各軸で画面上24px以上の操作領域を確保する。
 * 実際の円内なら後から描かれた粒を優先する。円外の拡張領域だけが重なった場合は
 * 画面上の中心距離が最短の粒、同距離なら後から描かれた粒を返す。
 * scale は設計座標から CSS px への軸ごとの縮尺。
 * 縮小盤面では描画と同じ倍率で中心と見た目の半径を広げる。
 */
export function hitTestBoardDot(
  pt: BoardPoint,
  dots: readonly BoardDotPlan[],
  draggableIds: ReadonlySet<number>,
  scale: BoardPoint = { x: 1, y: 1 },
): number | null {
  if (!Number.isFinite(scale.x) || !Number.isFinite(scale.y) || scale.x <= 0 || scale.y <= 0) {
    return null;
  }
  // 実盤面は等方の contain-fit。軸が違う矩形は実機の盤面ではないので拡大しない。
  const minor = Math.min(scale.x, scale.y);
  const major = Math.max(scale.x, scale.y);
  const cssScale = major <= minor * 1.05 ? minor : 1;
  const magnification = boardDotReadabilityMagnification(cssScale);
  const minimumRadius = VISUAL_TOKENS.dimensions.sprint.dotHitMinCssDiameter / 2;
  const presentedDots = presentBoardDots(dots, cssScale);
  let nearestId: number | null = null;
  let nearestDistance = Infinity;
  for (let i = dots.length - 1; i >= 0; i -= 1) {
    const dot = dots[i];
    if (!draggableIds.has(dot.id)) continue;
    const presented = presentedDots[i];
    const visibleRadius = (TASK_DIAMETER[dot.size] / 2) * magnification;
    const designDx = pt.x - presented.x;
    const designDy = pt.y - presented.y;
    if (designDx * designDx + designDy * designDy <= visibleRadius * visibleRadius) {
      return dot.id;
    }
    const r = visibleRadius + DOT_HIT_MARGIN;
    const rx = Math.max(r * scale.x, minimumRadius);
    const ry = Math.max(r * scale.y, minimumRadius);
    const dx = designDx * scale.x;
    const dy = designDy * scale.y;
    const distance = dx * dx + dy * dy;
    if ((dx / rx) ** 2 + (dy / ry) ** 2 <= 1 && distance < nearestDistance) {
      nearestId = dot.id;
      nearestDistance = distance;
    }
  }
  return nearestId;
}

/** flowBobDrift の 1 周期（ms）。CSS `--flow-duration: 1.15s / speedMul` と同値。 */
export function flowDriftPeriodMs(speedMul: number): number {
  return 1150 / Math.max(speedMul, 0.01);
}

/**
 * 工程間フロー粒の微小ドリフト（CSS `flowBobDrift` の Pixi 代替）。
 *
 * CSS は 0%→50%→100% で「進行方向へ (cos,sin)×5px ＋ 上へ 3px」揺れて戻る。
 * cos 波（(1-cos)/2）で同じ 0→1→0 を再現し、位相 0（elapsedMs=0）で必ず (0,0) を
 * 返す（freezeForScreenshot 時に決定論のフレームへ収束させるため）。
 */
export function flowDriftOffset(angleDeg: number, speedMul: number, elapsedMs: number): BoardPoint {
  const period = flowDriftPeriodMs(speedMul);
  const phase = ((elapsedMs % period) + period) % period;
  const wave = (1 - Math.cos((2 * Math.PI * phase) / period)) / 2;
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: Math.cos(rad) * 5 * wave,
    y: Math.sin(rad) * 5 * wave - 3 * wave,
  };
}

/**
 * 静止物の上下 bob（CSS `flybob`（粒 2.4s）/ `bob`（キャラ）と同形）。
 * 位相 0 で 0 を返す。戻り値は y オフセット（負が上）。
 */
export function bobOffsetY(elapsedMs: number, periodMs = 2400, amplitude = 3): number {
  if (periodMs <= 0) return 0;
  const phase = ((elapsedMs % periodMs) + periodMs) % periodMs;
  // `-amplitude * 0` の -0 を避けて位相 0 を厳密に 0 へ正規化する。
  return -amplitude * ((1 - Math.cos((2 * Math.PI * phase) / periodMs)) / 2) + 0;
}

/** fireShake の 1 周期（ms）。CSS の 0.25s / burn-warn 0.18s / burn-critical 0.12s と同値。 */
export function fireShakePeriodMs(burnUrgency?: number): number {
  if (burnUrgency === undefined) return 250;
  return burnUrgency < 0.35 ? 120 : 180;
}

/**
 * 炎上粒のジッタ（CSS `fireShake` の Pixi 代替）。
 * 0/25/50/75% の 4 段階ステップ（±0.7px）で、位相 0 は (0,0)。
 */
export function fireShakeOffset(elapsedMs: number, burnUrgency?: number): BoardPoint {
  const period = fireShakePeriodMs(burnUrgency);
  const phase = ((elapsedMs % period) + period) % period;
  const step = Math.floor((phase / period) * 4);
  switch (step) {
    case 1:
      return { x: 0.7, y: -0.7 };
    case 2:
      return { x: -0.7, y: 0.7 };
    case 3:
      return { x: 0.7, y: 0.7 };
    default:
      return { x: 0, y: 0 };
  }
}

/** 直線の破線 1 区間（始点→終点）。 */
export type DashSegment = readonly [BoardPoint, BoardPoint];

/**
 * 直線を破線区間へ分割する（SVG stroke-dasharray + dashoffset の Pixi 代替）。
 *
 * `offset` は CSS `stroke-dashoffset` と同じ向き（負で進行方向へ流れる）。
 * CSS `dash` アニメ（1s で 1 周期ぶん移動）を ticker から offset 連続変化で再現し、
 * offset=0 は SVG の静止状態と一致する（freezeForScreenshot の決定論）。
 */
export function lineDashSegments(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dash: number,
  gap: number,
  offset = 0,
): DashSegment[] {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len === 0 || dash <= 0 || gap < 0) return [];
  const period = dash + gap;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const at = (s: number): BoardPoint => ({ x: x1 + ux * s, y: y1 + uy * s });
  // SVG は「パス距離 s + dashoffset ≡ 0 (mod period)」から dash 区間が始まる。
  const start = -(((offset % period) + period) % period);
  const out: DashSegment[] = [];
  for (let s = start - period; s < len; s += period) {
    const a = Math.max(s, 0);
    const b = Math.min(s + dash, len);
    if (b > a) out.push([at(a), at(b)]);
  }
  return out;
}

/**
 * タスク粒テクスチャのキャッシュキー（RI-07: variant×size で焼き込み共有）。
 * 同じキーの粒は同一 RenderTexture を使い回す。
 */
export function dotTextureKey(variant: TaskVariant, size: TaskSize): string {
  return `dot:${variant}:${size}`;
}

/**
 * ステーションキャラテクスチャのキャッシュキー（RI-07/RI-08: lane×mood で焼き込み共有）。
 */
export function actorTextureKey(lane: Lane, mood: StationMood): string {
  return `actor:${lane}:${mood}`;
}

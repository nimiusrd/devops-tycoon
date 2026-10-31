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
import type { BoardDotPlan, StationMood } from './boardScene';
import { BOARD_RENDER_BUDGETS } from './boardRenderBudget';
import type { TaskSize, TaskVariant } from './taskView';
import { TASK_DIAMETER } from './taskView';
import { VISUAL_TOKENS } from './visualTokens';

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

/**
 * 見分けの倍率で、山（またはフロー）の基準点から粒を広げた座標。
 * 倍率 1 のときは同じオブジェクトを返す。
 */
export function presentBoardDot(dot: BoardDotPlan, cssScale: number): BoardDotPlan {
  const magnification = boardDotReadabilityMagnification(cssScale);
  if (magnification === 1) return dot;
  const anchorX = dot.clusterX ?? dot.x;
  const anchorY = dot.clusterY ?? dot.y;
  return {
    ...dot,
    x: anchorX + (dot.x - anchorX) * magnification,
    y: anchorY + (dot.y - anchorY) * magnification,
  };
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
  let nearestId: number | null = null;
  let nearestDistance = Infinity;
  for (let i = dots.length - 1; i >= 0; i -= 1) {
    const dot = dots[i];
    if (!draggableIds.has(dot.id)) continue;
    const presented = presentBoardDot(dot, cssScale);
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

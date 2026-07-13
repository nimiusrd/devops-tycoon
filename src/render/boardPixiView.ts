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
import type { TaskSize, TaskVariant } from './taskView';
import { TASK_DIAMETER } from './taskView';

/** 設計座標の点。 */
export interface BoardPoint {
  x: number;
  y: number;
}

/** ヒット判定の許容マージン（設計px。指先で小粒も掴めるように少し広げる）。 */
export const DOT_HIT_MARGIN = 6;

/**
 * 設計座標の点から、掴めるタスク粒を特定する（RI-30 のドラッグ開始判定）。
 *
 * DOM 版は draggable な span の pointerdown で粒が決まるが、Pixi 版は canvas 1 枚
 * なので座標から逆引きする。plan の後方（後から描かれた粒＝手前）を優先し、
 * 半径（直径/2）＋マージンの円判定で最初に当たった draggable 粒の id を返す。
 */
export function hitTestBoardDot(
  pt: BoardPoint,
  dots: readonly BoardDotPlan[],
  draggableIds: ReadonlySet<number>,
  margin: number = DOT_HIT_MARGIN,
): number | null {
  for (let i = dots.length - 1; i >= 0; i -= 1) {
    const dot = dots[i];
    if (!draggableIds.has(dot.id)) continue;
    const r = TASK_DIAMETER[dot.size] / 2 + margin;
    const dx = pt.x - dot.x;
    const dy = pt.y - dot.y;
    if (dx * dx + dy * dy <= r * r) return dot.id;
  }
  return null;
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

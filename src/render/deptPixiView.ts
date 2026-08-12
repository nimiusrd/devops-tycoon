/**
 * 部署ビュー PixiJS レンダラの純ヘルパ（RI-11 / SPEC 第22.4）。
 *
 * GPU に触らない数値計算だけを置き、Vitest で検証する（第22.5）。
 * - シーン計画のフローパス（SVG の M/Q 文字列）を数値へ解析し、破線用に折れ線分割する
 * - 設計座標空間（1404×573）を canvas へ contain-fit する変換を導く
 * - バナー/ラベルのトーン配色（styles.css の DOM 実装と同値）
 */
import type { TeamHealth } from '../sim/orgscale/types';
import { designToHostTransform, VISUAL_TOKENS, type VisualTone } from './visualTokens';

/** 2 次ベジェ 1 本ぶんの制御点（`M sx,sy Q cx,cy ex,ey`）。 */
export interface QuadPath {
  sx: number;
  sy: number;
  cx: number;
  cy: number;
  ex: number;
  ey: number;
}

/** 設計座標の点。 */
export interface Point {
  x: number;
  y: number;
}

/**
 * `deptBoardScene` のフローパス文字列を解析する。
 * 対応形式は `Mx,y Qcx,cy ex,ey`（負数・小数を含む）。不正な形式は null。
 */
export function parseQuadPath(d: string): QuadPath | null {
  const m = d.match(
    /^M\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s+Q\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s+(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*$/,
  );
  if (!m) return null;
  const [sx, sy, cx, cy, ex, ey] = m.slice(1).map(Number);
  if ([sx, sy, cx, cy, ex, ey].some((n) => !Number.isFinite(n))) return null;
  return { sx, sy, cx, cy, ex, ey };
}

/** 2 次ベジェ上の t (0..1) の点。 */
export function quadPointAt(p: QuadPath, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * p.sx + 2 * u * t * p.cx + t * t * p.ex,
    y: u * u * p.sy + 2 * u * t * p.cy + t * t * p.ey,
  };
}

/** 2 次ベジェ終端の接線角（度）。矢じりの向きに使う。 */
export function quadEndAngleDeg(p: QuadPath): number {
  // B'(1) = 2 (E - C)。制御点と終点が一致する退化時は始点→終点で代用。
  let dx = p.ex - p.cx;
  let dy = p.ey - p.cy;
  if (dx === 0 && dy === 0) {
    dx = p.ex - p.sx;
    dy = p.ey - p.sy;
  }
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/**
 * 2 次ベジェを破線の折れ線列へ分割する（SVG stroke-dasharray の Pixi 代替）。
 *
 * 曲線を `samples` 分割で弧長近似し、[dash, gap] パターンで on 区間だけを
 * 折れ線（点列）として返す。決定論（同一入力＝同一出力）なので視覚回帰が安定する。
 */
export function quadDashPolylines(p: QuadPath, dash: number, gap: number, samples = 64): Point[][] {
  if (dash <= 0 || gap < 0 || samples < 1) return [];
  const pts: Point[] = [];
  const arc: number[] = [0];
  for (let i = 0; i <= samples; i += 1) {
    pts.push(quadPointAt(p, i / samples));
    if (i > 0) {
      const a = pts[i - 1];
      const b = pts[i];
      arc.push(arc[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
    }
  }
  const total = arc[samples];
  if (total === 0) return [];

  const out: Point[][] = [];
  let current: Point[] | null = null;
  const period = dash + gap;
  for (let i = 0; i <= samples; i += 1) {
    const phase = arc[i] % period;
    const on = phase < dash || period === 0;
    if (on) {
      if (!current) current = [];
      current.push(pts[i]);
    } else if (current) {
      if (current.length >= 2) out.push(current);
      current = null;
    }
  }
  if (current && current.length >= 2) out.push(current);
  return out;
}

/** contain-fit の変換（root Container の scale と中央寄せオフセット）。 */
export interface ContainFitTransform {
  scale: number;
  x: number;
  y: number;
}

/**
 * 設計空間 viewW×viewH を host（canvas 実寸）へ「両軸 contain」で収める変換。
 * DOM 側の `useContainFit`（aspect-ratio + width 調整）と同じ見え方になる。
 */
export function containFitTransform(
  hostW: number,
  hostH: number,
  viewW: number,
  viewH: number,
): ContainFitTransform {
  return designToHostTransform(hostW, hostH, { w: viewW, h: viewH });
}

/**
 * チームミニ盤面へのズームイン変換（RI-04: 部署ビューのドリルダウン演出）。
 * contain-fit を基準に zoomMul 倍へ寄り、設計座標 (teamX, teamY) が
 * host（canvas 実寸）の中央へ来る root 変換を返す。
 */
export function teamZoomTransform(
  fit: ContainFitTransform,
  teamX: number,
  teamY: number,
  hostW: number,
  hostH: number,
  zoomMul = 1.6,
): ContainFitTransform {
  const scale = fit.scale * zoomMul;
  return {
    scale,
    x: hostW / 2 - teamX * scale,
    y: hostH / 2 - teamY * scale,
  };
}

/**
 * ズームトゥイーンの補間（easeOutCubic）。t は 0..1 にクランプする。
 * viewport を持たない部署レンダラが root の scale/position を手動で
 * 動かすための純関数（Vitest で端点・単調性を固定する）。
 */
export function zoomTransformAt(
  t: number,
  from: ContainFitTransform,
  to: ContainFitTransform,
): ContainFitTransform {
  const clamped = Math.max(0, Math.min(1, t));
  const k = 1 - (1 - clamped) ** 3;
  return {
    scale: from.scale + (to.scale - from.scale) * k,
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k,
  };
}

/** バナー/タグのトーン配色（styles.css `.dept-team-banner.tone-*` と同値）。 */
export interface BannerToneColors {
  border: string;
  borderAlpha: number;
  bg: string;
  backgroundAlpha: number;
  text: string;
  tagBg: string;
  tagText: string;
}

export const BANNER_TONE: Record<VisualTone, BannerToneColors> = VISUAL_TOKENS.colors.bannerTone;

/** ミニ盤面の床色（DOM `DeptTeamMini` と同値）。 */
export function teamFloorColor(health: TeamHealth): string {
  if (health === 'reviewHell') return VISUAL_TOKENS.colors.department.floorHell;
  if (health === 'congested') return VISUAL_TOKENS.colors.department.floorWarn;
  return VISUAL_TOKENS.colors.department.floorHealthy;
}

/** DOM の SVG 表示幅（layoutW）と Pixi の SVG ローカル幅（svgW）を揃える倍率。 */
export function teamMiniRenderScale(planScale: number): number {
  const { layoutW, svgW } = VISUAL_TOKENS.dimensions.department.teamMini;
  return planScale * (svgW > 0 ? layoutW / svgW : 1);
}

/**
 * 粒の山オフセット（DOM `pileDots` と同値: 4 個/行・上限 12・9px 段積み）。
 * 返り値はアンカー中心からの相対座標と半径。
 */
export function pileDotOffsets(count: number): { x: number; y: number; r: number }[] {
  const { cap, perRow, dx, dy, largeThreshold, largeRadius, radius } =
    VISUAL_TOKENS.dimensions.department.teamMini.pile;
  const visible = Math.min(count, cap);
  const r = count > largeThreshold ? largeRadius : radius;
  const out: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < visible; i += 1) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    out.push({ x: (col - (perRow - 1) / 2) * dx, y: -row * dy, r });
  }
  return out;
}

/**
 * 全社マップのカメラ目標（Pixi viewport 同期用。SPEC 第22.5）。
 *
 * 部門・チーム・全体の world 座標 bounds を純 TS で決める。GPU 不要なので
 * Vitest で bbox を固定できる。PixiOrgRenderer はここで得た矩形を animate へ渡す。
 */
import type { Team } from '../sim/orgscale/types';
import { isoProject, type IsoOptions } from './iso';
import { LOD_BADGE_MAX } from './orgIslandView';
import { isoLayoutOrigin, layoutIso, ORG_CARD_W, ORG_PAD } from './orgView';

/** world 空間の矩形（左上 + サイズ）。 */
export interface WorldBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** bounds の中心点。 */
export function boundsCenter(b: WorldBounds): { x: number; y: number } {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** 全チーム島を収める bounds（layoutIso と同じ world 原点）。 */
export function worldBoundsForAll(
  teams: readonly Team[],
  iso: IsoOptions,
  pad: number,
): WorldBounds | null {
  if (teams.length === 0) return null;
  const layout = layoutIso(teams, iso, pad);
  return { x: 0, y: 0, width: layout.width, height: layout.height };
}

/** 部門に属するチーム群の bounds。 */
export function worldBoundsForDept(
  teams: readonly Team[],
  deptId: string,
  iso: IsoOptions,
  pad: number,
  margin = 132,
): WorldBounds | null {
  const subset = teams.filter((t) => t.deptId === deptId);
  return worldBoundsForSubset(teams, subset, iso, pad, margin);
}

/** 任意サブセットの bounds（投影点 ± margin）。 */
export function worldBoundsForSubset(
  teams: readonly Team[],
  subset: readonly Team[],
  iso: IsoOptions,
  pad: number,
  margin: number,
): WorldBounds | null {
  if (subset.length === 0) return null;
  const origin = isoLayoutOrigin(teams, iso, pad);
  const isoFull = { ...iso, ...origin };
  const points = subset.map((t) => isoProject(t.gridX, t.gridY, isoFull));
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs) - margin;
  const maxX = Math.max(...xs) + margin;
  const minY = Math.min(...ys) - margin;
  const maxY = Math.max(...ys) + margin;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** 1 チームの world 座標（島中心）。 */
export function worldPointForTeam(
  teams: readonly Team[],
  teamId: string,
  iso: IsoOptions,
  pad: number,
): { x: number; y: number } | null {
  const team = teams.find((t) => t.id === teamId);
  if (!team) return null;
  const origin = isoLayoutOrigin(teams, iso, pad);
  return isoProject(team.gridX, team.gridY, { ...iso, ...origin });
}

/** チーム島クリック時の world 幅（card + 余白。tileW*2 だと fit が縮小方向になる）。 */
export const TEAM_FOCUS_SPAN = ORG_CARD_W + ORG_PAD;

/** 1 回のフォーカスで拡大しすぎない上限（現在 scale への倍率）。 */
export const TEAM_FOCUS_MAX_ZOOM_IN = 1.35;
export const DEPT_FOCUS_MAX_ZOOM_IN = 1.5;

/**
 * fit scale を現在 scale からの上限倍率で抑え、縮小はしない。
 */
export function dampedFocusScale(
  currentScale: number,
  fitScale: number,
  maxZoomInFactor: number,
  minScale = 0,
): number {
  const cappedFit = Math.min(fitScale, currentScale * maxZoomInFactor);
  let target = Math.max(currentScale, cappedFit);
  if (minScale > 0) target = Math.max(target, minScale);
  return target;
}

/**
 * チームフォーカスの目標 scale。card LOD 下限を守りつつ拡大は控えめにする。
 */
export function teamFocusTargetScale(
  currentScale: number,
  fitScale: number,
  minScale = LOD_BADGE_MAX,
): number {
  return dampedFocusScale(currentScale, fitScale, TEAM_FOCUS_MAX_ZOOM_IN, minScale);
}

/** 部門フォーカスの目標 scale（縮小しない・拡大は DEPT 上限まで）。 */
export function deptFocusTargetScale(currentScale: number, fitScale: number): number {
  return dampedFocusScale(currentScale, fitScale, DEPT_FOCUS_MAX_ZOOM_IN);
}

/** チームフォーカス用の近接 bounds（card LOD が読める程度の幅）。 */
export function worldBoundsForTeamFocus(
  teams: readonly Team[],
  teamId: string,
  iso: IsoOptions,
  pad: number,
  span = TEAM_FOCUS_SPAN,
): WorldBounds | null {
  const point = worldPointForTeam(teams, teamId, iso, pad);
  if (!point) return null;
  const half = span / 2;
  return {
    x: point.x - half,
    y: point.y - half,
    width: span,
    height: span,
  };
}

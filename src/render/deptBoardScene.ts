/**
 * 部署ビューの「シーン計画」（SPEC 第4.9 準拠）。
 *
 * 部門内の各チームを Coding▸Review▸Done のミニパイプラインとして等角配置し、
 * チーム間依存（連鎖炎上）をフロー矢印で返す。純 TS → Vitest 検証（第22.5）。
 */
import type { DepartmentState, Team } from '../sim/orgscale/types';
import { HEALTH_COLOR } from './orgView';
import { islandDepth, islandMood, zoneLabelTone } from './orgBoardScene';
import { badgeTone, healthTag } from './teamHealthTheme';
import { DESIGN_SPACES, VISUAL_TOKENS } from './visualTokens';

/** 設計座標空間（旧モック dept-screen の viewBox 由来）。 */
export const DEPT_VIEW = DESIGN_SPACES.department;

const TEAM_MINI_W = VISUAL_TOKENS.dimensions.department.teamMini.layoutW;
const TEAM_MINI_H = VISUAL_TOKENS.dimensions.department.teamMini.layoutH;
const BANNER_ABOVE = VISUAL_TOKENS.dimensions.department.bannerAbove;

/** 旧モック由来の 3 チーム配置。 */
const TEAM_LAYOUTS_3: readonly { x: number; y: number }[] = [
  { x: 300, y: 264 },
  { x: 702, y: 374 },
  { x: 1104, y: 264 },
];

/** 4 チーム部門（product 等）は横一列。中心間隔をフロー矢印が逆向きにならない幅に確保。 */
const TEAM_LAYOUTS_4: readonly { x: number; y: number }[] = [
  { x: 230, y: 318 },
  { x: 560, y: 318 },
  { x: 890, y: 318 },
  { x: 1174, y: 318 },
];

/** ミニパイプラインの設計幅（CSS % 換算用）。 */
export const TEAM_MINI_DESIGN_W = TEAM_MINI_W;

/** 旧モック由来の 3 チーム間依存パス（上流→下流）。 */
const FLOW_PATHS_3: readonly { from: number; to: number; d: string }[] = [
  { from: 0, to: 1, d: 'M450,274 Q576,314 702,364' },
  { from: 1, to: 2, d: 'M852,374 Q978,314 1104,274' },
];

/** 工程ラベル（前面レイヤ）。 */
const STAGE_LABELS_3: readonly { lane: DeptLaneId; x: number; y: number }[] = [
  { lane: 'coding', x: 546, y: 314 },
  { lane: 'review', x: 702, y: 296 },
  { lane: 'done', x: 852, y: 314 },
];

export type DeptLaneId = 'coding' | 'review' | 'done';

export type DeptTeamMood = ReturnType<typeof islandMood>;

export interface DeptLanePlan {
  lane: DeptLaneId;
  x: number;
  y: number;
  count: number;
  hot: boolean;
}

export interface DeptTeamPlan {
  teamId: string;
  team: Team;
  x: number;
  y: number;
  depth: number;
  tint: string;
  mood: DeptTeamMood;
  chained: boolean;
  /** チーム数が多いときミニ盤面を縮小（1 = 既定幅）。 */
  scale: number;
  lanes: DeptLanePlan[];
  banner: {
    x: number;
    y: number;
    title: string;
    subtitle: string;
    tag: string;
    tone: 'ok' | 'warn' | 'hell';
  };
}

export interface DeptFlowPlan {
  id: string;
  fromTeamId: string;
  toTeamId: string;
  d: string;
  hot: boolean;
  stroke: string;
  strokeWidth: number;
  opacity: number;
}

export interface DeptStageLabelPlan {
  lane: DeptLaneId;
  x: number;
  y: number;
  label: string;
  hot: boolean;
}

export interface DeptPlatePlan {
  color: string;
  tone: 'ok' | 'warn' | 'hell';
  glow: { x: number; y: number; rx: number; ry: number; kind: 'ok' | 'hell' } | null;
}

export interface DeptBoardScene {
  plate: DeptPlatePlan;
  teams: DeptTeamPlan[];
  flows: DeptFlowPlan[];
  stageLabels: DeptStageLabelPlan[];
}

/** チーム内の工程粒数（現行 DeptScreen と一致）。 */
export function teamLaneCounts(team: Team): Record<DeptLaneId, number> {
  return {
    coding: Math.max(1, Math.round(team.engineers * 0.6)),
    review: team.reviewQueue,
    done: Math.round(team.shipping / 100),
  };
}

/** ミニパイプライン内の工程アンカー（チームローカル 380×220）。 */
function teamLaneAnchors(): DeptLanePlan[] {
  return [
    { lane: 'coding', x: 78, y: 116, count: 0, hot: false },
    { lane: 'review', x: 190, y: 130, count: 0, hot: false },
    { lane: 'done', x: 312, y: 116, count: 0, hot: false },
  ];
}

/** チーム数に応じたミニ盤面縮小率。 */
export function teamLayoutScale(teamCount: number): number {
  if (teamCount <= 4) return 1;
  if (teamCount === 5) return 0.72;
  if (teamCount === 6) return 0.65;
  return Math.max(0.52, 0.78 - teamCount * 0.04);
}

/** フロー矢印の水平アンカー offset（チーム間距離に応じて調整）。 */
export function flowAnchorOffset(dx: number): number {
  const gap = Math.abs(dx);
  return Math.min(140, Math.max(36, gap * 0.32));
}
/** 連鎖炎上: 炎上チームの下流（配列の次チーム）を延焼リスクとして印す。 */
export function planChainedIndices(teams: readonly Team[]): Set<number> {
  const fireIndices = teams
    .map((t, i) => (t.health === 'reviewHell' ? i : -1))
    .filter((i) => i >= 0);
  const chained = new Set<number>();
  for (const i of fireIndices) if (i + 1 < teams.length) chained.add(i + 1);
  return chained;
}

/** チーム数に応じた中心座標を導出する。 */
export function teamDesignPosition(teamIndex: number, teamCount: number): { x: number; y: number } {
  if (teamCount === 3) return TEAM_LAYOUTS_3[teamIndex] ?? TEAM_LAYOUTS_3[0];
  if (teamCount === 4) return TEAM_LAYOUTS_4[teamIndex] ?? TEAM_LAYOUTS_4[0];
  if (teamCount === 1) return { x: 702, y: 320 };
  if (teamCount === 2) {
    return teamIndex === 0 ? { x: 450, y: 320 } : { x: 954, y: 320 };
  }

  return layoutManyTeams(teamIndex, teamCount);
}

/** 5+ チームは 2 段配置＋縮小スケールで重なりを避ける。 */
function layoutManyTeams(teamIndex: number, teamCount: number): { x: number; y: number } {
  const topCount = Math.ceil(teamCount / 2);
  const row = teamIndex < topCount ? 0 : 1;
  const col = row === 0 ? teamIndex : teamIndex - topCount;
  const colsInRow = row === 0 ? topCount : teamCount - topCount;
  const xMin = 220;
  const xMax = 1184;
  const scale = teamLayoutScale(teamCount);
  const yTop = 268;
  const yBot = Math.min(440, DEPT_VIEW.h - (TEAM_MINI_H * scale) / 2 - 28);
  const x = colsInRow === 1 ? 702 : xMin + ((col + 0.5) / colsInRow) * (xMax - xMin);
  const y = row === 0 ? yTop : yBot;
  return clampTeamCenter(x, y);
}

function clampTeamCenter(x: number, y: number): { x: number; y: number } {
  const halfW = TEAM_MINI_W / 2;
  const halfH = TEAM_MINI_H / 2;
  const minY = halfH + BANNER_ABOVE + 24;
  const maxY = DEPT_VIEW.h - halfH - 20;
  return {
    x: Math.min(DEPT_VIEW.w - halfW - 16, Math.max(halfW + 16, x)),
    y: Math.min(maxY, Math.max(minY, y)),
  };
}

function flowPathBetween(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const offset = flowAnchorOffset(dx);
  const sx = from.x + (dx >= 0 ? offset : -offset);
  const ex = to.x - (dx >= 0 ? offset : -offset);
  const sy = from.y + dy * 0.08;
  const ey = to.y - dy * 0.08;
  const cx = (sx + ex) / 2;
  const cy = Math.min(sy, ey) - 40 - Math.abs(dy) * 0.12;
  return `M${sx},${sy} Q${cx},${cy} ${ex},${ey}`;
}

/** フローパスの始点・終点 X（テスト用）。 */
export function flowEndpoints(d: string): { sx: number; ex: number } {
  const start = d.match(/^M([\d.]+),/);
  const end = d.match(/([\d.]+),([\d.]+)$/);
  return { sx: Number(start?.[1] ?? 0), ex: Number(end?.[1] ?? 0) };
}

function planFlows(
  teams: readonly Team[],
  positions: readonly { x: number; y: number }[],
  chained: Set<number>,
): DeptFlowPlan[] {
  const flows: DeptFlowPlan[] = [];
  for (let i = 0; i < teams.length - 1; i++) {
    const from = teams[i];
    const to = teams[i + 1];
    const hot = chained.has(i + 1) || from.health === 'reviewHell';
    const d =
      teams.length === 3
        ? (FLOW_PATHS_3.find((f) => f.from === i && f.to === i + 1)?.d ??
          flowPathBetween(positions[i], positions[i + 1]))
        : flowPathBetween(positions[i], positions[i + 1]);
    flows.push({
      id: `dept-flow-${i}`,
      fromTeamId: from.id,
      toTeamId: to.id,
      d,
      hot,
      stroke: hot ? VISUAL_TOKENS.colors.flow.hot : VISUAL_TOKENS.colors.flow.normal,
      strokeWidth: hot ? 2.6 : 2.2,
      opacity: hot ? 0.85 : 0.65,
    });
  }
  return flows;
}

function planStageLabels(dept: DepartmentState): DeptStageLabelPlan[] {
  const reviewHot = dept.teams.some((t) => t.reviewQueue >= 6);
  if (dept.teams.length === 3) {
    return STAGE_LABELS_3.map((s) => ({
      lane: s.lane,
      x: s.x,
      y: s.y,
      label: s.lane === 'coding' ? '💻 Coding' : s.lane === 'review' ? '🔍 Review' : '📦 Done',
      hot: s.lane === 'review' && reviewHot,
    }));
  }
  const cx = 702;
  const cy = 300;
  return [
    { lane: 'coding', x: cx - 156, y: cy + 14, label: '💻 Coding', hot: false },
    {
      lane: 'review',
      x: cx,
      y: cy - 4,
      label: '🔍 Review',
      hot: reviewHot,
    },
    { lane: 'done', x: cx + 150, y: cy + 14, label: '📦 Done', hot: false },
  ];
}

function plateGlow(dept: DepartmentState): DeptPlatePlan['glow'] {
  const tone = zoneLabelTone(dept);
  if (tone === 'warn') return null;
  return {
    x: 702,
    y: 320,
    rx: 520,
    ry: 220,
    kind: tone === 'hell' ? 'hell' : 'ok',
  };
}

/** 部署ビューのシーン計画を組み立てる。 */
export function planDeptBoardScene(dept: DepartmentState): DeptBoardScene {
  const chained = planChainedIndices(dept.teams);
  const teamCount = dept.teams.length;
  const scale = teamLayoutScale(teamCount);
  const positions = dept.teams.map((_, i) => teamDesignPosition(i, teamCount));

  const teams: DeptTeamPlan[] = dept.teams.map((team, i) => {
    const pos = positions[i];
    const counts = teamLaneCounts(team);
    const lanes = teamLaneAnchors().map((lane) => ({
      ...lane,
      count: counts[lane.lane],
      hot: lane.lane === 'review' && team.reviewQueue >= 6,
    }));
    const tone = badgeTone(team.health);
    return {
      teamId: team.id,
      team,
      x: pos.x,
      y: pos.y,
      depth: islandDepth(pos.x, pos.y),
      tint: HEALTH_COLOR[team.health],
      mood: islandMood(team),
      chained: chained.has(i),
      scale,
      lanes,
      banner: {
        x: pos.x,
        y: pos.y - BANNER_ABOVE,
        title: team.isPlayer ? `★ ${team.name}` : team.name,
        subtitle: `出荷 ${team.shipping} ／ AI依存 ${team.aiDependency}% ／ ${team.engineers}人`,
        tag: healthTag(team.health),
        tone,
      },
    };
  });

  const flows = planFlows(dept.teams, positions, chained);

  return {
    plate: {
      color: dept.def.color,
      tone: zoneLabelTone(dept),
      glow: plateGlow(dept),
    },
    teams,
    flows,
    stageLabels: planStageLabels(dept),
  };
}

/** 設計座標が DEPT_VIEW 範囲内か（テスト用）。 */
export function isInDeptView(x: number, y: number, margin = 80): boolean {
  return x >= -margin && x <= DEPT_VIEW.w + margin && y >= -margin && y <= DEPT_VIEW.h + margin;
}

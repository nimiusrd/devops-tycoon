/**
 * 全社マップの「シーン計画」（SPEC 第4.8 / mockups/org-screen 準拠）。
 *
 * 何を・どこに描くかを純TSで決める（GPU 不要 → Vitest で数値検証できる。第22.5）。
 * 浮遊プレート・部門ゾーン・チーム島・フローレーン・共通基盤ハブを、
 * 設計座標空間（1404×573）で返し、レンダラ（DOM/SVG → 将来 PixiJS）は
 * 「読んで描くだけ」にする（第22.2）。
 */
import { diagnosisView } from '../sim/diagnosis';
import type { DepartmentState, OrgScaleState, Team, TeamHealth } from '../sim/orgscale/types';
import { HEALTH_COLOR, HEALTH_LABEL } from './orgView';
import { displayName, fireLabel, islandTitle } from './orgIslandView';

/** 設計座標空間（mockups/org-screen.html の viewBox と一致）。 */
export const ORG_VIEW = { w: 1404, h: 573 } as const;

/** 部門ゾーンの静的レイアウト（mockup の縦ストライプ領域）。 */
interface ZoneLayout {
  /** 床クリップ内の矩形（設計px）。 */
  x: number;
  width: number;
  /** チーム島を配置する領域。 */
  teamXMin: number;
  teamXMax: number;
  teamYMin: number;
  teamYMax: number;
  /** 部門ラベル位置。 */
  labelX: number;
  labelY: number;
  /** 健全 glow の中心（null なら glow なし）。 */
  glowCenter: { x: number; y: number; rx: number; ry: number; kind: 'ok' | 'hell' } | null;
}

/** mockup 準拠の 3 部門ゾーン配置。 */
const ZONE_LAYOUTS: readonly ZoneLayout[] = [
  {
    x: 0,
    width: 582,
    teamXMin: 280,
    teamXMax: 540,
    teamYMin: 260,
    teamYMax: 480,
    labelX: 312,
    labelY: 202,
    glowCenter: { x: 430, y: 360, rx: 300, ry: 180, kind: 'ok' },
  },
  {
    x: 582,
    width: 240,
    teamXMin: 640,
    teamXMax: 760,
    teamYMin: 400,
    teamYMax: 480,
    labelX: 700,
    labelY: 182,
    glowCenter: null,
  },
  {
    x: 822,
    width: 582,
    teamXMin: 860,
    teamXMax: 1180,
    teamYMin: 250,
    teamYMax: 520,
    labelX: 1028,
    labelY: 202,
    glowCenter: { x: 1000, y: 360, rx: 320, ry: 190, kind: 'hell' },
  },
] as const;

/** 共通基盤ハブ（設計px）。 */
const HUB = { x: 700, y: 288, labelY: 226 } as const;

/** mockup 準拠の静的フローパス（各ゾーン → ハブ）。 */
const STATIC_FLOWS: readonly { d: string; zoneIndex: number }[] = [
  { d: 'M452,314 Q576,242 700,288', zoneIndex: 0 },
  { d: 'M320,392 Q510,242 700,288', zoneIndex: 0 },
  { d: 'M500,452 Q600,242 700,288', zoneIndex: 0 },
  { d: 'M692,450 L700,288', zoneIndex: 1 },
  { d: 'M892,300 Q796,242 700,288', zoneIndex: 2 },
  { d: 'M1036,356 Q868,242 700,288', zoneIndex: 2 },
  { d: 'M958,460 Q997,310 1036,356', zoneIndex: 2 },
  { d: 'M1152,420 Q926,242 700,288', zoneIndex: 2 },
];

/** 部門ゾーンの描画計画。 */
export interface OrgZonePlan {
  deptId: string;
  name: string;
  color: string;
  x: number;
  width: number;
  glow: ZoneLayout['glowCenter'];
}

/** 部門ラベルの描画計画。 */
export interface OrgZoneLabelPlan {
  deptId: string;
  x: number;
  y: number;
  title: string;
  subtitle: string;
  tone: 'ok' | 'warn' | 'hell';
}

/** フローレーンの描画計画。 */
export interface OrgFlowPlan {
  id: string;
  d: string;
  hot: boolean;
  stroke: string;
  strokeWidth: number;
  opacity: number;
}

/** 共通基盤ハブの描画計画。 */
export interface OrgHubPlan {
  x: number;
  y: number;
  labelX: number;
  labelY: number;
  ci: number;
  docs: number;
  aiGuideline: number;
  tone: 'ok' | 'warn';
}

/** チーム島の mood（表情・演出）。 */
export type OrgIslandMood = 'neutral' | 'tired' | 'panic' | 'sad';

/** チーム島の描画計画。 */
export interface OrgIslandPlan {
  teamId: string;
  team: Team;
  x: number;
  y: number;
  /** 画家順（奥→手前）。大きいほど手前。 */
  depth: number;
  tint: string;
  deptColor: string;
  mood: OrgIslandMood;
  badge: {
    x: number;
    y: number;
    title: string;
    shipping: string;
    ai: string;
    tag: string;
    tone: 'ok' | 'warn' | 'hell';
  };
  labels: {
    name: string;
    title: string;
    fire: string | null;
  };
}

/** 全社マップ盤面のシーン計画。 */
export interface OrgBoardScene {
  zones: OrgZonePlan[];
  zoneLabels: OrgZoneLabelPlan[];
  hub: OrgHubPlan;
  flows: OrgFlowPlan[];
  islands: OrgIslandPlan[];
}

/** チームの mood を健全度・インシデントから導出する。 */
export function islandMood(team: Team): OrgIslandMood {
  if (team.health === 'reviewHell' || team.incidents >= 2) return 'panic';
  if (team.health === 'congested') return 'tired';
  if (team.morale < 35) return 'sad';
  return 'neutral';
}

/** バッジの tone を健全度から導出する。 */
function badgeTone(health: TeamHealth): 'ok' | 'warn' | 'hell' {
  if (health === 'reviewHell') return 'hell';
  if (health === 'congested') return 'warn';
  return 'ok';
}

/** バッジ tag 文言。 */
function healthTag(health: TeamHealth): string {
  if (health === 'reviewHell') return 'Review Hell';
  if (health === 'congested') return '渋滞ぎみ';
  return 'Healthy';
}

/** 部門ラベルの tone。 */
function zoneLabelTone(dept: DepartmentState): 'ok' | 'warn' | 'hell' {
  if (dept.health === 'reviewHell' || dept.onFire >= 2) return 'hell';
  if (dept.health === 'congested' || dept.onFire > 0) return 'warn';
  return 'ok';
}

/** 部門ラベルのサブタイトル。 */
function zoneSubtitle(dept: DepartmentState): string {
  const diag = dept.onFire > 0 ? `⚠ 炎上 ${dept.onFire}T` : HEALTH_LABEL[dept.health];
  return `${diag} ・ ${dept.teams.length}チーム`;
}

/**
 * 部門内のチーム index から設計座標を導出する。
 * チーム数に応じてゾーン内を格子状に配置する。
 */
export function teamDesignPosition(
  deptIndex: number,
  teamIndex: number,
  teamCount: number,
): { x: number; y: number } {
  const zone = ZONE_LAYOUTS[deptIndex] ?? ZONE_LAYOUTS[0];
  const cols = Math.max(1, Math.ceil(Math.sqrt(teamCount)));
  const rows = Math.max(1, Math.ceil(teamCount / cols));
  const col = teamIndex % cols;
  const row = Math.floor(teamIndex / cols);
  const x = zone.teamXMin + ((col + 0.5) / cols) * (zone.teamXMax - zone.teamXMin);
  const y = zone.teamYMin + ((row + 0.5) / rows) * (zone.teamYMax - zone.teamYMin);
  return { x, y };
}

/** 画家順 depth（y が大きいほど手前）。 */
function islandDepth(x: number, y: number): number {
  return Math.round(y * 10 + x * 0.01);
}

/** 部門の reviewQueue 合計（フロー heat 判定用）。 */
function deptReviewLoad(dept: DepartmentState): number {
  return dept.teams.reduce((s, t) => s + t.reviewQueue, 0);
}

/** 全社マップのシーン計画を組み立てる。 */
export function planOrgBoardScene(org: OrgScaleState): OrgBoardScene {
  const zones: OrgZonePlan[] = org.departments.map((d, i) => {
    const layout = ZONE_LAYOUTS[i] ?? ZONE_LAYOUTS[0];
    return {
      deptId: d.def.id,
      name: d.def.name,
      color: d.def.color,
      x: layout.x,
      width: layout.width,
      glow: layout.glowCenter,
    };
  });

  const zoneLabels: OrgZoneLabelPlan[] = org.departments.map((d, i) => {
    const layout = ZONE_LAYOUTS[i] ?? ZONE_LAYOUTS[0];
    return {
      deptId: d.def.id,
      x: layout.labelX,
      y: layout.labelY,
      title: d.def.name,
      subtitle: zoneSubtitle(d),
      tone: zoneLabelTone(d),
    };
  });

  const hub: OrgHubPlan = {
    x: HUB.x,
    y: HUB.y,
    labelX: HUB.x,
    labelY: HUB.labelY,
    ci: org.infra.ci,
    docs: org.infra.docs,
    aiGuideline: org.infra.aiGuideline,
    tone: org.infra.ci >= 50 ? 'ok' : 'warn',
  };

  const deptHot = org.departments.map(
    (d) => d.health === 'reviewHell' || d.onFire > 0 || deptReviewLoad(d) >= 12,
  );

  const flows: OrgFlowPlan[] = STATIC_FLOWS.map((f, i) => {
    const hot = deptHot[f.zoneIndex] ?? false;
    return {
      id: `flow-${i}`,
      d: f.d,
      hot,
      stroke: hot ? '#ff9a93' : '#cdbff0',
      strokeWidth: hot ? 3 : 2.5,
      opacity: hot ? 0.85 : 0.65,
    };
  });

  const islands: OrgIslandPlan[] = [];
  org.departments.forEach((dept, deptIndex) => {
    dept.teams.forEach((team, teamIndex) => {
      const pos = teamDesignPosition(deptIndex, teamIndex, dept.teams.length);
      const depth = islandDepth(pos.x, pos.y);
      const tone = badgeTone(team.health);
      islands.push({
        teamId: team.id,
        team,
        x: pos.x,
        y: pos.y,
        depth,
        tint: HEALTH_COLOR[team.health],
        deptColor: dept.def.color,
        mood: islandMood(team),
        badge: {
          x: pos.x,
          y: pos.y - 46,
          title: team.name,
          shipping: `出荷 ${team.shipping}`,
          ai: `AI ${team.aiDependency}%`,
          tag: healthTag(team.health),
          tone,
        },
        labels: {
          name: displayName(team),
          title: islandTitle(team.name, team.health),
          fire: fireLabel(team.incidents),
        },
      });
    });
  });

  islands.sort((a, b) => a.depth - b.depth);

  return { zones, zoneLabels, hub, flows, islands };
}

/** 設計座標が ORG_VIEW 範囲内か（テスト用）。 */
export function isInOrgView(x: number, y: number, margin = 80): boolean {
  return x >= -margin && x <= ORG_VIEW.w + margin && y >= -margin && y <= ORG_VIEW.h + margin;
}

/** 全社診断ラベル（zone label 補助）。 */
export function orgDiagnosisLabel(org: OrgScaleState): string {
  return diagnosisView(org.diagnosis).label;
}

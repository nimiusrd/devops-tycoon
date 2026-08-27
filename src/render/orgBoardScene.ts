/**
 * 全社マップの「シーン計画」（SPEC 第4.8 準拠）。
 *
 * 何を・どこに描くかを純TSで決める（GPU 不要 → Vitest で数値検証できる。第22.5）。
 * 浮遊プレート・部門ゾーン・チーム島・フローレーン・共通基盤ハブを、
 * 設計座標空間（1404×573）で返し、DOM/SVGとPixiJSのレンダラは
 * それを読んで描くだけにする（第22.2）。
 */
import type { DepartmentState, OrgScaleState, Team } from '../sim/orgscale/types';
import { HEALTH_COLOR, HEALTH_LABEL } from './orgView';
import { displayName, fireLabel, islandTitle } from './orgIslandView';
import { badgeTone, healthTag } from './teamHealthTheme';
import { DESIGN_SPACES, VISUAL_TOKENS } from './visualTokens';

/** 設計座標空間（旧モック org-screen の viewBox 由来）。 */
export const ORG_VIEW = DESIGN_SPACES.organization;

/** 島同士の最小間隔（設計px）。extraTeams 等でチームが増えても重ならないよう拡張する。 */
export const MIN_ISLAND_SPACING_X = 120;
export const MIN_ISLAND_SPACING_Y = 90;

/** 島アクター＋バッジが盤面内に収まるよう中心座標に取る余白（設計px）。 */
export const ISLAND_BADGE_ABOVE = VISUAL_TOKENS.dimensions.organization.island.badgeAbove;
export const ISLAND_BADGE_HEIGHT = VISUAL_TOKENS.dimensions.organization.island.badgeHeight;
export const ISLAND_ACTOR_HALF_H = VISUAL_TOKENS.dimensions.organization.island.actorHalfHeight;
export const ISLAND_MARGIN = VISUAL_TOKENS.dimensions.organization.island.margin;
export const ZONE_LABEL_Y = VISUAL_TOKENS.dimensions.organization.zoneLabel.y;
export const ZONE_LABEL_HEIGHT = VISUAL_TOKENS.dimensions.organization.zoneLabel.height;
export const ZONE_LABEL_GAP = VISUAL_TOKENS.dimensions.organization.zoneLabel.gap;

/** 部門ゾーンの静的レイアウト（縦ストライプ領域。旧モック由来）。 */
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

/** 旧モック由来の 3 部門ゾーン配置。 */
const ZONE_LAYOUTS: readonly ZoneLayout[] = [
  {
    x: 0,
    width: 582,
    teamXMin: 280,
    teamXMax: 540,
    teamYMin: 260,
    teamYMax: 480,
    labelX: 312,
    labelY: ZONE_LABEL_Y,
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
    labelY: ZONE_LABEL_Y - 8,
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
    labelY: ZONE_LABEL_Y,
    glowCenter: { x: 1000, y: 360, rx: 320, ry: 190, kind: 'hell' },
  },
] as const;

/** 共通基盤ハブ（設計px）。 */
const HUB = { x: 700, y: 288, labelY: 226 } as const;

/** 旧モック由来の静的フローパス。zone 0/1 は島→ハブ、zone 2 の依存はハブ→島。 */
const STATIC_FLOWS: readonly { d: string; zoneIndex: number }[] = [
  { d: 'M452,314 Q576,242 700,288', zoneIndex: 0 },
  { d: 'M320,392 Q510,242 700,288', zoneIndex: 0 },
  { d: 'M500,452 Q600,242 700,288', zoneIndex: 0 },
  { d: 'M692,450 L700,288', zoneIndex: 1 },
  { d: 'M700,288 Q796,242 892,300', zoneIndex: 2 },
  { d: 'M700,288 Q868,242 1036,356', zoneIndex: 2 },
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
  tone: 'ok' | 'warn' | 'hell';
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
    /** エンジニア人数表示（例: `5人`）。 */
    headcount: string;
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

/** 島に並べるアバター数（1〜4）。人数スカラーを視覚へ載せる（RI-27）。 */
export function islandWorkerCount(engineers: number): number {
  return Math.min(4, Math.max(1, Math.round(engineers)));
}

/** 島に並べる AI ボット数（0〜3）。配布人数スカラーを視覚へ載せる（RI-27）。 */
export function islandAiBotCount(aiAssignedCount: number): number {
  if (aiAssignedCount <= 0) return 0;
  return Math.min(3, Math.max(1, Math.round(aiAssignedCount)));
}

/** 島バッジの AI 行（依存度＋配布人数）。Pixi card の表記と揃える。 */
export function islandAiBadgeLabel(aiDependency: number, aiAssignedCount: number): string {
  const base = `AI ${aiDependency}%`;
  return aiAssignedCount > 0 ? `${base} · 配布${aiAssignedCount}` : base;
}

/** チームの mood を健全度・インシデントから導出する。 */
export function islandMood(team: Team): OrgIslandMood {
  if (team.health === 'reviewHell' || team.incidents >= 2) return 'panic';
  if (team.health === 'congested') return 'tired';
  if (team.morale < 35) return 'sad';
  return 'neutral';
}

/** 部門ラベルの tone。 */
export function zoneLabelTone(dept: DepartmentState): 'ok' | 'warn' | 'hell' {
  if (dept.health === 'reviewHell' || dept.onFire >= 2) return 'hell';
  if (dept.health === 'congested' || dept.onFire > 0) return 'warn';
  return 'ok';
}

/** 部門ラベルのサブタイトル。 */
function zoneSubtitle(dept: DepartmentState): string {
  const diag = dept.onFire > 0 ? `⚠ 炎上 ${dept.onFire}T` : HEALTH_LABEL[dept.health];
  return `${diag} ・ ${dept.teams.length}チーム`;
}

/** 部門健全度からゾーン glow の種別を導出する（静的な既定値ではなく実状態を反映）。 */
function zoneGlowKind(dept: DepartmentState): 'ok' | 'hell' | null {
  const tone = zoneLabelTone(dept);
  if (tone === 'hell') return 'hell';
  if (tone === 'ok') return 'ok';
  return null;
}

/** 部門状態とレイアウトから glow 計画を組み立てる。 */
function zoneGlow(dept: DepartmentState, layout: ZoneLayout): ZoneLayout['glowCenter'] {
  if (!layout.glowCenter) return null;
  const kind = zoneGlowKind(dept);
  if (kind === null) return null;
  return { ...layout.glowCenter, kind };
}

/** 設計空間の軸平行矩形（ラベル／バッジの重なり判定用）。 */
export interface OrgBoardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 部門ラベル帯の下端（最も低い labelY のラベル底）。島バッジはこの下に置く。 */
export function zoneLabelBandBottom(): number {
  const lowestCenter = Math.max(...ZONE_LAYOUTS.map((z) => z.labelY));
  return lowestCenter + ZONE_LABEL_HEIGHT / 2;
}

/** 島中心の許容範囲。部門ラベル＋チームカード（バッジ）が重ならない余白を含む。 */
export function islandCenterBounds(): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const minY =
    zoneLabelBandBottom() + ZONE_LABEL_GAP + ISLAND_BADGE_HEIGHT / 2 + ISLAND_BADGE_ABOVE;
  return {
    minX: 70,
    maxX: ORG_VIEW.w - 70,
    minY,
    maxY: ORG_VIEW.h - ISLAND_ACTOR_HALF_H - ISLAND_MARGIN,
  };
}

export function orgBoardRectsOverlap(a: OrgBoardRect, b: OrgBoardRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** 部門ラベルの外接矩形（幅は日本語2行ラベルを覆う保守的な見積り）。 */
export function zoneLabelRect(label: Pick<OrgZoneLabelPlan, 'x' | 'y'>): OrgBoardRect {
  const width = 240;
  return {
    x: label.x - width / 2,
    y: label.y - ZONE_LABEL_HEIGHT / 2,
    width,
    height: ZONE_LABEL_HEIGHT,
  };
}

/** 島のチームカード（バッジ）外接矩形。 */
export function islandBadgeRect(island: Pick<OrgIslandPlan, 'badge'>): OrgBoardRect {
  const width = VISUAL_TOKENS.dimensions.organization.card.width;
  return {
    x: island.badge.x - width / 2,
    y: island.badge.y - ISLAND_BADGE_HEIGHT / 2,
    width,
    height: ISLAND_BADGE_HEIGHT,
  };
}

/** 島の中心座標を盤面＋ラベル帯＋アクター余白内に収める。 */
export function clampIslandCenter(x: number, y: number): { x: number; y: number } {
  const { minX, maxX, minY, maxY } = islandCenterBounds();
  return {
    x: Math.min(maxX, Math.max(minX, x)),
    y: Math.min(maxY, Math.max(minY, y)),
  };
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
  const baseWidth = zone.teamXMax - zone.teamXMin;
  const baseHeight = zone.teamYMax - zone.teamYMin;

  const cols = Math.min(teamCount, Math.max(1, Math.ceil(Math.sqrt(teamCount))));
  const rows = Math.max(1, Math.ceil(teamCount / cols));

  const neededWidth = cols * MIN_ISLAND_SPACING_X;
  const neededHeight = rows * MIN_ISLAND_SPACING_Y;
  const { minY, maxY } = islandCenterBounds();
  const maxSpanY = Math.max(0, maxY - minY);
  const spanX = Math.max(baseWidth, neededWidth);
  const spanY = Math.min(Math.max(baseHeight, neededHeight), maxSpanY);
  const centerX = (zone.teamXMin + zone.teamXMax) / 2;
  const centerY = (zone.teamYMin + zone.teamYMax) / 2;

  const col = teamIndex % cols;
  const row = Math.floor(teamIndex / cols);
  const x = centerX - spanX / 2 + ((col + 0.5) / cols) * spanX;
  const y = centerY - spanY / 2 + ((row + 0.5) / rows) * spanY;
  return clampIslandCenter(x, y);
}

/** 画家順 depth（1..99。オーバーレイ層より下の帯）。 */
export function islandDepth(x: number, y: number): number {
  return Math.min(99, Math.max(1, Math.round((y / ORG_VIEW.h) * 70 + (x / ORG_VIEW.w) * 29)));
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
      tone: zoneLabelTone(d),
      glow: zoneGlow(d, layout),
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
      stroke: hot ? VISUAL_TOKENS.colors.flow.hot : VISUAL_TOKENS.colors.flow.normal,
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
          y: pos.y - ISLAND_BADGE_ABOVE,
          title: team.name,
          shipping: `出荷 ${team.shipping}`,
          ai: islandAiBadgeLabel(team.aiDependency, team.aiAssignedCount),
          headcount: `${team.engineers}人`,
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

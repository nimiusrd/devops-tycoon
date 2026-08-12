/**
 * 業界ランキングの HQ スカイライン計画（RI-03 / SPEC 第4.10）。
 *
 * ランキング状態から等角ビルの配置・高さ・強調状態を純 TS で導出する。
 * レンダラはこの計画を読むだけにして、ランキング種別タブの切替も同じ関数で検証する。
 */
import type { IndustryState, LeaderboardEntry } from '../sim/orgscale/types';
import { DESIGN_SPACES, VISUAL_TOKENS } from './visualTokens';

/** 旧モック industry-screen の HQ スカイライン SVG viewBox 由来。 */
export const INDUSTRY_VIEW = DESIGN_SPACES.industry;

export const INDUSTRY_SKYLINE_LIMIT = VISUAL_TOKENS.dimensions.industry.skylineLimit;

const MIN_BUILDING_HEIGHT = VISUAL_TOKENS.dimensions.industry.building.minHeight;
const MAX_BUILDING_HEIGHT = VISUAL_TOKENS.dimensions.industry.building.maxHeight;
const BUILDING_W = VISUAL_TOKENS.dimensions.industry.building.width;
const BUILDING_D = VISUAL_TOKENS.dimensions.industry.building.depth;
const BASE_Y = VISUAL_TOKENS.dimensions.industry.building.baseY;

const BUILDING_LAYOUTS: readonly { x: number; y: number }[] = [
  { x: 84, y: BASE_Y + 12 },
  { x: 164, y: BASE_Y + 2 },
  { x: 252, y: BASE_Y - 10 },
  { x: 338, y: BASE_Y - 20 },
  { x: 424, y: BASE_Y - 10 },
  { x: 512, y: BASE_Y + 2 },
  { x: 596, y: BASE_Y + 10 },
  { x: 668, y: BASE_Y + 16 },
] as const;

export type IndustryBuildingTone = 'self' | 'leader' | 'rival';

export interface IndustryBuildingPlan {
  id: string;
  name: string;
  orgType: string;
  score: number;
  rank: number;
  x: number;
  baseY: number;
  height: number;
  width: number;
  depth: number;
  zIndex: number;
  windowRows: number;
  hasCrown: boolean;
  isSelf: boolean;
  tone: IndustryBuildingTone;
  label: {
    x: number;
    y: number;
    title: string;
    subtitle: string;
  };
}

export interface IndustryBoardScene {
  buildings: IndustryBuildingPlan[];
  maxScore: number;
}

export function isInIndustryView(x: number, y: number): boolean {
  return x >= 0 && x <= INDUSTRY_VIEW.w && y >= 0 && y <= INDUSTRY_VIEW.h;
}

function buildingHeight(score: number, maxScore: number): number {
  const ratio = maxScore <= 0 ? 0 : score / maxScore;
  return Math.round(MIN_BUILDING_HEIGHT + ratio * (MAX_BUILDING_HEIGHT - MIN_BUILDING_HEIGHT));
}

function labelTitle(entry: LeaderboardEntry): string {
  return entry.org.isSelf ? `自社 ${entry.rank}位` : `${entry.rank}位`;
}

function buildingTone(entry: LeaderboardEntry): IndustryBuildingTone {
  if (entry.org.isSelf) return 'self';
  if (entry.rank === 1) return 'leader';
  return 'rival';
}

function skylineEntries(industry: IndustryState): LeaderboardEntry[] {
  const top = industry.entries.slice(0, INDUSTRY_SKYLINE_LIMIT);
  if (top.some((e) => e.org.isSelf)) return top;
  const self = industry.entries.find((e) => e.org.isSelf);
  if (!self) return top;
  return [...top.slice(0, INDUSTRY_SKYLINE_LIMIT - 1), self];
}

function planBuilding(
  entry: LeaderboardEntry,
  index: number,
  maxScore: number,
  score: number,
): IndustryBuildingPlan {
  const layout = BUILDING_LAYOUTS[index] ?? BUILDING_LAYOUTS[BUILDING_LAYOUTS.length - 1];
  const height = buildingHeight(score, maxScore);
  return {
    id: entry.org.id,
    name: entry.org.name,
    orgType: entry.org.orgType,
    score,
    rank: entry.rank,
    x: layout.x,
    baseY: layout.y,
    height,
    width: BUILDING_W,
    depth: BUILDING_D,
    zIndex: 10 + Math.round(layout.y),
    windowRows: Math.max(2, Math.min(8, Math.floor(height / 24))),
    hasCrown: entry.rank === 1,
    isSelf: entry.org.isSelf,
    tone: buildingTone(entry),
    label: {
      x: layout.x,
      y: Math.min(INDUSTRY_VIEW.h - 18, layout.y + 34),
      title: labelTitle(entry),
      subtitle: entry.org.name,
    },
  };
}

/** 表示中ランキング種別のスコアを使う scene を作る。 */
export function planIndustryBoardScene(industry: IndustryState): IndustryBoardScene {
  const entries = skylineEntries(industry);
  const maxScore = Math.max(1, ...entries.map((e) => e.org.scores[industry.kind]));
  return {
    maxScore,
    buildings: entries.map((entry, index) =>
      planBuilding(entry, index, maxScore, entry.org.scores[industry.kind]),
    ),
  };
}

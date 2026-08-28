/**
 * チーム島の「状態→見た目」計画（DOM / Pixi 共通。SPEC 第22.5）。
 *
 * ラベル文字列・LOD 判定・名前省略を純関数で決定する。GPU 不要なので Vitest で
 * 境界値と DOM 同等の表示内容を固定できる。
 */
import type { Team, TeamHealth } from '../sim/orgscale/types';
import { HEALTH_LABEL } from './orgView';
import { VISUAL_TOKENS } from './visualTokens';

/** ズームに連動する詳細度（第22.5 LOD）。 */
export type OrgIslandDetail = 'dot' | 'badge' | 'card';

/**
 * ドリルダウン時のフォーカスリング演出トーン（RI-04 / SPEC 第4.11）。
 * 「移動先の状態（炎上・渋滞）が遷移演出にも反映される」を満たすため、
 * リングの色と脈動の強さをチーム状態から純関数で導く。
 */
export interface FocusRingTone {
  color: string;
  /** 演出の強さ 0..1（alpha・リング幅に効く）。悪い状態ほど強い。 */
  strength: number;
}

export function focusRingTone(team: Pick<Team, 'incidents' | 'health'>): FocusRingTone {
  if (team.incidents > 0) return { color: VISUAL_TOKENS.colors.fire, strength: 1 };
  if (team.health === 'reviewHell') {
    return { color: VISUAL_TOKENS.colors.interaction.focusHell, strength: 0.85 };
  }
  if (team.health === 'congested') return { color: VISUAL_TOKENS.colors.sun, strength: 0.6 };
  return { color: VISUAL_TOKENS.colors.mint, strength: 0.4 };
}

/** LOD 境界: scale < 0.35 → dot、< 0.7 → badge、それ以外 → card。
 * pan/zoom時の視認性を保つLOD境界。 */
export const LOD_DOT_MAX = 0.35;
export const LOD_BADGE_MAX = 0.7;

/** badge 表示時の名前最大文字数（決定論的 truncation）。 */
export const BADGE_NAME_MAX_CHARS = 8;

/** 1 チーム島分の表示ラベル（DOM `TeamIsland` と同等の情報）。 */
export interface TeamIslandLabels {
  /** 表示名（プレイヤーは ★ 付き。badge では truncate 済み）。 */
  name: string;
  /** 出荷ラベル（card のみ。例: "出荷 42"）。 */
  shipping: string | null;
  /** AI 依存度ラベル（card のみ。例: "AI 70"。配布中は人数も併記）。 */
  ai: string | null;
  /** エンジニア人数ラベル（card のみ。例: "5人"）。 */
  headcount: string | null;
  /** 炎上ラベル（badge/card。例: "🔥3"）。 */
  fire: string | null;
  /** ツールチップ（card 相当）。 */
  title: string;
  /** 健全度バッジを描くか（card）。 */
  showBadge: boolean;
}

/**
 * viewport scale から LOD 詳細度を決める。
 * 境界値は Vitest で固定（<0.35 dot、<0.7 badge、>=0.7 card）。
 */
export function detailForZoom(scale: number): OrgIslandDetail {
  if (scale < LOD_DOT_MAX) return 'dot';
  if (scale < LOD_BADGE_MAX) return 'badge';
  return 'card';
}

/**
 * 名前を最大文字数で省略する（決定論的。Pixi Text 幅計測の代替）。
 */
export function truncateName(name: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (name.length <= maxChars) return name;
  if (maxChars <= 1) return '…';
  return `${name.slice(0, maxChars - 1)}…`;
}

/** プレイヤー印付きの表示名。 */
export function displayName(team: Pick<Team, 'name' | 'isPlayer'>): string {
  return team.isPlayer ? `★ ${team.name}` : team.name;
}

/** 炎上ラベル（0 件なら null）。 */
export function fireLabel(incidents: number): string | null {
  return incidents > 0 ? `🔥${incidents}` : null;
}

/** ドリルダウン用ツールチップ。部門名があると同名チームを区別できる。 */
export function islandTitle(
  name: string,
  health: TeamHealth,
  deptName?: string,
  isPlayer = false,
): string {
  const team = isPlayer ? `★ ${name}` : name;
  const who = deptName ? `${deptName} ${team}` : team;
  return `${who}（${HEALTH_LABEL[health]}）へドリルダウン`;
}

/** ドック操作の accessible name。aria-label が子の出荷／AI／人数を上書きしないようにする。 */
export function islandDockAccessibleName(
  title: string,
  shipping: string,
  ai: string,
  headcount: string,
): string {
  return `${title}。${shipping}／${ai}／${headcount}`;
}

/**
 * チームと LOD から DOM `TeamIsland` 相当のラベル列を導出する。
 * 同一入力なら常に同一出力（決定論）。
 */
export function teamIslandView(team: Team, detail: OrgIslandDetail): TeamIslandLabels {
  const title = islandTitle(team.name, team.health, undefined, team.isPlayer);
  const fire = fireLabel(team.incidents);

  if (detail === 'dot') {
    return {
      name: '',
      shipping: null,
      ai: null,
      headcount: null,
      fire: null,
      title,
      showBadge: false,
    };
  }

  if (detail === 'badge') {
    const short = truncateName(team.name, BADGE_NAME_MAX_CHARS);
    const badgeName = team.isPlayer ? `★ ${short}` : short;
    return {
      name: badgeName,
      shipping: null,
      ai: null,
      headcount: null,
      fire,
      title,
      showBadge: false,
    };
  }

  // card: DOM 島バッジと同系の出荷/AI/人数。AI 配布中はボット相当として人数を併記。
  const ai =
    team.aiAssignedCount > 0
      ? `AI ${team.aiDependency} · 配布${team.aiAssignedCount}`
      : `AI ${team.aiDependency}`;

  return {
    name: displayName(team),
    shipping: `出荷 ${team.shipping}`,
    ai,
    headcount: `${team.engineers}人`,
    fire,
    title,
    showBadge: true,
  };
}

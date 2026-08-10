/**
 * ゲームSVGアセットの画面別割当と状態演出。
 *
 * DOM/SVG と Pixi が同じ ID・ロスター・気分変換を読むことで、レンダラを
 * 切り替えても人物の意味と状態フィードバックがずれないようにする。
 */
import type { GameAssetId } from '../data/assets';
import type { Lane } from '../sim/types';
import type { DeptLaneId } from './deptBoardScene';
import type { OrgIslandMood } from './orgBoardScene';
import type { StationMood } from './boardScene';

/** スプリント工程の人物割当（RI-92）。 */
export const BOARD_CHARACTER_ASSETS: Record<Lane, GameAssetId> = {
  backlog: 'product-oracle',
  coding: 'platform-architect',
  review: 'qa-alchemist',
  rework: 'incident-commander',
  done: 'release-captain',
};

/** 組織図で人数順に繰り返す職能ロスター。 */
export const ORG_CHARACTER_ROSTER: readonly GameAssetId[] = [
  'product-oracle',
  'platform-architect',
  'qa-alchemist',
  'sre-ranger',
];

/** 部門ミニ盤面の工程担当。Done は棚なので人物を置かない。 */
export const DEPT_CHARACTER_ASSETS: Partial<Record<DeptLaneId, GameAssetId>> = {
  coding: 'platform-architect',
  review: 'qa-alchemist',
};

export type GameAssetMood = StationMood | OrgIslandMood;

export interface GameAssetMoodStyle {
  /** DOMの状態クラスに使う短い名前。 */
  className: string;
  /** Pixi Sprite.tint に変換できるHEX色。 */
  tint: string;
  /** 疲労・異常時の静的な強度。 */
  alpha: number;
  /** Pixiでの静的な強調倍率。 */
  scale: number;
  /** Pixiでの静的な傾き（ラジアン）。 */
  rotation: number;
  /** 既存の気分を小さく補助する状態印。 */
  marker: string | null;
}

/**
 * 連続アニメーションに依存せず、人物SVGへ重ねる状態演出を決める純関数。
 * panic/sad は組織図の mood、cheer/exhausted は盤面の mood も受け付ける。
 */
export function gameAssetMoodStyle(mood: GameAssetMood): GameAssetMoodStyle {
  switch (mood) {
    case 'happy':
      return {
        className: 'happy',
        tint: '#fff4c2',
        alpha: 1,
        scale: 1.04,
        rotation: 0,
        marker: '✨',
      };
    case 'cheer':
      return {
        className: 'cheer',
        tint: '#fff0a6',
        alpha: 1,
        scale: 1.08,
        rotation: 0,
        marker: '🎉',
      };
    case 'tired':
      return {
        className: 'tired',
        tint: '#b8b0c8',
        alpha: 0.84,
        scale: 0.96,
        rotation: 0,
        marker: '💦',
      };
    case 'exhausted':
      return {
        className: 'exhausted',
        tint: '#847d99',
        alpha: 0.68,
        scale: 0.92,
        rotation: -0.035,
        marker: '💦',
      };
    case 'panic':
      return {
        className: 'panic',
        tint: '#ffb6a8',
        alpha: 0.95,
        scale: 1.05,
        rotation: 0.025,
        marker: '💢',
      };
    case 'sad':
      return {
        className: 'sad',
        tint: '#a9b1ce',
        alpha: 0.78,
        scale: 0.97,
        rotation: -0.02,
        marker: '😞',
      };
    default:
      return {
        className: 'neutral',
        tint: '#ffffff',
        alpha: 1,
        scale: 1,
        rotation: 0,
        marker: null,
      };
  }
}

export function stationAssetForLane(lane: Lane): GameAssetId {
  return BOARD_CHARACTER_ASSETS[lane];
}

export function orgAssetForSlot(slot: number): GameAssetId {
  const index = Math.max(0, Math.floor(slot)) % ORG_CHARACTER_ROSTER.length;
  return ORG_CHARACTER_ROSTER[index] ?? ORG_CHARACTER_ROSTER[0];
}

export function deptAssetForLane(lane: DeptLaneId): GameAssetId | undefined {
  return DEPT_CHARACTER_ASSETS[lane];
}

import type { Lane } from '../sim/types';

/**
 * 工程の人物中心。盤面描画とドラッグ判定が同じ位置を参照する。
 * Backlog / Coding / Review は滞留の山を読み分けられる間隔を確保する。
 */
export const BOARD_STATION_CENTERS = {
  backlog: { x: 380, y: 220 },
  coding: { x: 620, y: 260 },
  review: { x: 840, y: 300 },
  rework: { x: 1006, y: 229 },
  done: { x: 1075, y: 370 },
} as const satisfies Record<Lane, { x: number; y: number }>;

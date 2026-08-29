/**
 * スプリント盤面の描画予算と Pixi 内部レイヤ順（RI-143）。
 *
 * FPS は実行環境に左右されるため直接契約せず、描画対象数・生成数・重なり順を
 * GPU 不要の数値として固定する。DOM/Pixi 共有の z-index は visualTokens が正本で、
 * ここでは Pixi canvas 内部の局所的な順序だけを扱う。
 */
import { VISUAL_TOKENS } from './visualTokens';

/** 現場盤面で同時に保持・描画できる要素数。 */
export const BOARD_RENDER_BUDGETS = {
  dots: 96,
  reviewTrails: VISUAL_TOKENS.dimensions.sprint.reviewEffects.trail.budget,
  transientEffects: VISUAL_TOKENS.dimensions.sprint.boardEffects.budget,
  auras: 4,
} as const;

/** Pixi の単一 canvas 内での奥→手前の描画順。 */
export const BOARD_PIXI_LAYER_ORDER = {
  flows: 10,
  reviewHeat: 20,
  stations: 30,
  reviewTrails: 40,
  dots: 50,
  auras: 60,
  transientEffects: 70,
} as const;

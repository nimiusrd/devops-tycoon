import { VISUAL_TOKENS } from './visualTokens';

export const MAX_POINT_POPS = 6;

/** 工程要約や注意オーバーレイの下へ余白を確保する（#1025）。 */
export const POINT_POP_RESERVED_PAD = 4;

/** 出荷ポップが上へ動ける最大距離（px）。予約帯の下に収める。 */
export function pointPopMaxRise(height: number, reservedTop: number): number {
  const { bottomRatio, reducedLineHeight } = VISUAL_TOKENS.dimensions.pointPops;
  const anchorFromTop = height * (1 - bottomRatio);
  return Math.max(0, anchorFromTop - reservedTop - POINT_POP_RESERVED_PAD - reducedLineHeight);
}

/** 最上段の行全体が盤面内に収まる段数。段位置は消去時にも詰めない。 */
export function reducedPointPopCapacity(height: number, topInset = 0): number {
  const { bottomRatio, reducedLineHeight, rowGap } = VISUAL_TOKENS.dimensions.pointPops;
  const spaceAboveFirst = height * (1 - bottomRatio) - reducedLineHeight - topInset;
  return Math.min(MAX_POINT_POPS, Math.max(0, Math.floor(spaceAboveFirst / rowGap) + 1));
}

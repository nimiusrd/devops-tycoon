import { VISUAL_TOKENS } from './visualTokens';

export const MAX_POINT_POPS = 6;

/** 最上段の行全体が盤面内に収まる段数。段位置は消去時にも詰めない。 */
export function reducedPointPopCapacity(height: number, topInset = 0): number {
  const { bottomRatio, reducedLineHeight, rowGap } = VISUAL_TOKENS.dimensions.pointPops;
  const spaceAboveFirst = height * (1 - bottomRatio) - reducedLineHeight - topInset;
  return Math.min(MAX_POINT_POPS, Math.max(0, Math.floor(spaceAboveFirst / rowGap) + 1));
}

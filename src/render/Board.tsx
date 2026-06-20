/**
 * 盤面レンダラ（Phase 0 雛形）。
 *
 * SPEC 第22.2 に従い「状態を読んで描くだけ」の一方向に徹する。
 * Phase 1 では DOM/SVG で実装し、MVP3 以降で PixiJS へ移植する（第22.4）。
 */
import type { SimState } from '../sim/types';

export interface BoardProps {
  state: SimState;
}

export function Board(_props: BoardProps) {
  // Phase 0 では盤面要素を持たない。
  return null;
}

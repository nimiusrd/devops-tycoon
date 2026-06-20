/**
 * レンダラ差し替え用インターフェース（Phase 0 雛形）。
 *
 * DOM/SVG → PixiJS の段階移行（SPEC 第22.4）で、この境界の実装を差し替える。
 */
import type { SimState } from '../../sim/types';

export interface RendererAdapter {
  /** 最新状態を読んで 1 フレーム描画する。 */
  render(state: SimState): void;
  /** リソースの後始末。 */
  dispose(): void;
}

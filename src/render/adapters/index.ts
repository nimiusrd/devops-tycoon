/**
 * レンダラ差し替え用インターフェース。
 *
 * DOM/SVGとPixiJSを同じ境界で差し替える。
 * 描画対象シーンごとに入力型が異なる（盤面=SimState、全社マップ=チーム配列など）
 * ため型引数で受け、既定はスプリント盤面の `SimState`。レンダラは「状態を読んで
 * 描くだけ」の一方向に徹する（第22.2）。
 */
import type { SimState } from '../../sim/types';

export interface RendererAdapter<TState = SimState> {
  /** 最新状態を読んで 1 フレーム描画する。 */
  render(state: TState): void;
  /** リソースの後始末。 */
  dispose(): void;
}

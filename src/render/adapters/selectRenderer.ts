/**
 * レンダラ選択フラグ（DOM/SVG ⇄ PixiJS の切替。SPEC 第22.4）。
 *
 * 既定は DOM/SVG。`?renderer=pixi` を付けたときだけ PixiJS レンダラを使う。
 * `?seed=` と同じ URL パラメータ規約（architecture §4.1）に合わせ、CI と通常
 * プレイは DOM のまま（実 WebGL を回さない方針。§4.2）、ローカル/DevContainer
 * での描画作り込みだけ opt-in で Pixi を有効化できるようにする。
 */
export type RendererKind = 'dom' | 'pixi';

/**
 * URL のクエリ文字列からレンダラ種別を決める。不明値・未指定は 'dom'。
 * 引数を取るので Node の Vitest からも純粋に検証できる。
 */
export function getRendererKind(search = ''): RendererKind {
  const value = new URLSearchParams(search).get('renderer');
  return value === 'pixi' ? 'pixi' : 'dom';
}

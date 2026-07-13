/**
 * レンダラ選択フラグ（PixiJS ⇄ DOM/SVG の切替。SPEC 第22.4）。
 *
 * 既定は PixiJS（WebGL）。`?renderer=dom` を付けたときだけ DOM/SVG レンダラへ
 * フォールバックする（RI-11 で盤面・部署・全社の Pixi 化が出揃ったため既定を反転）。
 * `?seed=` と同じ URL パラメータ規約（architecture §4.1）。CI の既定 E2E は
 * `renderer=dom` を明示して実 WebGL を回さず（§4.2）、Pixi 経路は @pixi スイート
 * （PIXI_E2E=1 opt-in）が検証する。WebGL 初期化に失敗した環境では各 Pixi ラッパーが
 * DOM 版へ自動フォールバックする。
 */
export type RendererKind = 'dom' | 'pixi';

/**
 * URL のクエリ文字列からレンダラ種別を決める。不明値・未指定は 'pixi'。
 * 引数を取るので Node の Vitest からも純粋に検証できる。
 */
export function getRendererKind(search = ''): RendererKind {
  const value = new URLSearchParams(search).get('renderer');
  return value === 'dom' ? 'dom' : 'pixi';
}

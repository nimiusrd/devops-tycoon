/**
 * 画面遷移時に引き継がれたスクロール位置を捨て、主内容をビューポート内へ戻す。
 * リプレイのキーフレーム閲覧など、前画面（タイトルやオーバーレイ）の
 * 末尾スクロールが白画面に見える問題を防ぐ。
 */

/** ページ本体以外で縦スクロールしうるホスト。 */
export const VIEWPORT_SCROLL_HOST_SELECTOR = '.result-overlay, .zoom-overlay, .sprint-layout';

export function resetElementScroll(element: { scrollTop: number; scrollLeft?: number }): void {
  element.scrollTop = 0;
  if ('scrollLeft' in element) element.scrollLeft = 0;
}

/**
 * window と主要な内部スクロール領域を先頭へ戻す。
 * SSR やテストで document が無いときは何もしない。
 */
export function resetViewportScroll(root: Document | null): void {
  if (!root) return;
  const win = root.defaultView;
  if (win) {
    win.scrollTo(0, 0);
  }
  resetElementScroll(root.documentElement);
  if (root.body) resetElementScroll(root.body);
  root.querySelectorAll(VIEWPORT_SCROLL_HOST_SELECTOR).forEach((node) => {
    if (node instanceof HTMLElement) resetElementScroll(node);
  });
}

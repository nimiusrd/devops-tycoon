/**
 * シーン遷移時のウィンドウスクロール位置。
 *
 * タイトルや編成は document が伸びて window がスクロールする。前画面の
 * 末尾位置を残したまま次画面を載せるると、短いフレームでは html の白地が
 * 見え、着地も本編より下になる（#368）。paint 前に上端へ戻す。
 */
import { useLayoutEffect, type ReactNode } from 'react';

/** document / body / window のどれがスクローラでも上端へ揃える。 */
export function resetWindowScroll(): void {
  const scrolling = document.scrollingElement;
  if (scrolling) scrolling.scrollTop = 0;
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  window.scrollTo(0, 0);
}

/**
 * lazy 画面が実際に DOM へ載ったタイミングでスクロールを捨てる。
 * 親の phase 変更時点では Suspense fallback の短い木しか無く、チャンク
 * 解決後に高さが戻るとブラウザが末尾位置を復元することがある。
 */
export function SceneScrollReset({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    resetWindowScroll();
  }, []);
  return children;
}

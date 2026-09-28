/**
 * リプレイバナーの実高さを CSS 変数へ同期する。
 * `.result-overlay` が sticky バナーの下から始まるようにする（DS-06）。
 */
export const REPLAY_BANNER_HEIGHT_VAR = '--replay-banner-height';

export function applyReplayBannerHeight(
  heightPx: number,
  root: { style: { setProperty(name: string, value: string): void } } = document.documentElement,
): void {
  const height = Number.isFinite(heightPx) ? Math.max(0, heightPx) : 0;
  root.style.setProperty(REPLAY_BANNER_HEIGHT_VAR, `${height}px`);
}

export function clearReplayBannerHeight(
  root: { style: { removeProperty(name: string): void } } = document.documentElement,
): void {
  root.style.removeProperty(REPLAY_BANNER_HEIGHT_VAR);
}

/** バナー要素の高さを追跡し、アンマウント時に変数を外す。 */
export function observeReplayBannerHeight(
  banner: Element | null,
  root: {
    style: {
      setProperty(name: string, value: string): void;
      removeProperty(name: string): void;
    };
  } = document.documentElement,
): () => void {
  if (!banner) {
    clearReplayBannerHeight(root);
    return () => {};
  }
  // overlay の top は viewport 基準。下端には .app の上余白と保存バナー分が入る。
  // 結果オーバーレイは max(この値, 保存バナー高) とし、保存バナー高を足し直さない。
  const apply = () => applyReplayBannerHeight(banner.getBoundingClientRect().bottom, root);
  apply();
  if (typeof ResizeObserver === 'undefined') {
    return () => clearReplayBannerHeight(root);
  }
  const observer = new ResizeObserver(apply);
  observer.observe(banner);
  return () => {
    observer.disconnect();
    clearReplayBannerHeight(root);
  };
}

import { PERSISTENCE_BANNER_HEIGHT_VAR } from './persistenceBannerInset';

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
  const stops: Array<() => void> = [];
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(apply);
    observer.observe(banner);
    stops.push(() => observer.disconnect());
  }
  // 保存バナーの高さ変化は帯の寸法を変えない。変数が変わった次のフレームで下端を測り直す。
  const style = root.style as { getPropertyValue?(name: string): string };
  if (
    typeof Element !== 'undefined' &&
    typeof MutationObserver === 'function' &&
    typeof style.getPropertyValue === 'function' &&
    root instanceof Element
  ) {
    let lastInset = Number.parseFloat(style.getPropertyValue(PERSISTENCE_BANNER_HEIGHT_VAR));
    if (!Number.isFinite(lastInset)) lastInset = 0;
    let frame = 0;
    const observer = new MutationObserver(() => {
      const next = Number.parseFloat(style.getPropertyValue(PERSISTENCE_BANNER_HEIGHT_VAR));
      const inset = Number.isFinite(next) ? next : 0;
      if (inset === lastInset) return;
      lastInset = inset;
      if (typeof requestAnimationFrame !== 'function') {
        apply();
        return;
      }
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        apply();
      });
    });
    observer.observe(root, { attributes: true, attributeFilter: ['style'] });
    stops.push(() => {
      observer.disconnect();
      if (frame !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
    });
  }
  return () => {
    for (const stop of stops) stop();
    clearReplayBannerHeight(root);
  };
}

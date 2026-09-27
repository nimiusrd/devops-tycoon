/**
 * 常駐の保存バナーは body へ portal され position: fixed なので、
 * タイトルのフローには乗らない。実高さを CSS 変数へ渡し、タイトルだけ上を空ける（DS-06）。
 * 操作のない復旧チップは幅いっぱいに被さらないため、余白には使わない。
 */
export const PERSISTENCE_BANNER_HEIGHT_VAR = '--persistence-banner-height';

type StyleRoot = {
  style: {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): void;
  };
};

export function applyPersistenceBannerHeight(
  heightPx: number,
  root: StyleRoot = document.documentElement,
): void {
  const height = Number.isFinite(heightPx) ? Math.max(0, heightPx) : 0;
  root.style.setProperty(PERSISTENCE_BANNER_HEIGHT_VAR, `${height}px`);
}

export function clearPersistenceBannerHeight(root: StyleRoot = document.documentElement): void {
  root.style.removeProperty(PERSISTENCE_BANNER_HEIGHT_VAR);
}

function reservesTitleSpace(banner: Element): boolean {
  return banner.getAttribute('data-persistent') === 'true';
}

/** 常駐バナーの高さを追跡し、アンマウント時に変数を外す。 */
export function observePersistenceBannerHeight(
  banner: Element | null,
  root: StyleRoot = document.documentElement,
): () => void {
  if (!banner) {
    clearPersistenceBannerHeight(root);
    return () => {};
  }
  const apply = () => {
    if (!reservesTitleSpace(banner)) {
      clearPersistenceBannerHeight(root);
      return;
    }
    applyPersistenceBannerHeight(banner.getBoundingClientRect().height, root);
  };
  apply();
  const stops: Array<() => void> = [];
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(apply);
    observer.observe(banner);
    stops.push(() => observer.disconnect());
  }
  if (typeof MutationObserver === 'function') {
    const observer = new MutationObserver(apply);
    observer.observe(banner, { attributes: true, attributeFilter: ['data-persistent'] });
    stops.push(() => observer.disconnect());
  }
  return () => {
    for (const stop of stops) stop();
    clearPersistenceBannerHeight(root);
  };
}

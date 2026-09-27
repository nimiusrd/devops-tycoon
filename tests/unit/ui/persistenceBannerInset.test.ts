import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyPersistenceBannerHeight,
  clearPersistenceBannerHeight,
  observePersistenceBannerHeight,
  PERSISTENCE_BANNER_HEIGHT_VAR,
} from '../../../src/ui/persistenceBannerInset';

function createRoot() {
  const props: Record<string, string> = {};
  const root = {
    style: {
      setProperty(name: string, value: string) {
        props[name] = value;
      },
      removeProperty(name: string) {
        delete props[name];
      },
    },
  };
  return { props, root };
}

function banner(height: number, persistent: boolean) {
  return {
    persistent,
    getAttribute(name: string) {
      if (name === 'data-persistent') return persistent ? 'true' : 'false';
      return null;
    },
    getBoundingClientRect: () => ({ height }),
  } as unknown as Element;
}

describe('persistenceBannerInset', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('常駐バナーの高さを CSS 変数へ書き、復旧チップでは外す', () => {
    const { props, root } = createRoot();
    applyPersistenceBannerHeight(88, root);
    expect(props[PERSISTENCE_BANNER_HEIGHT_VAR]).toBe('88px');
    applyPersistenceBannerHeight(-4, root);
    expect(props[PERSISTENCE_BANNER_HEIGHT_VAR]).toBe('0px');

    const stopQuiet = observePersistenceBannerHeight(banner(28, false), root);
    expect(props[PERSISTENCE_BANNER_HEIGHT_VAR]).toBeUndefined();
    stopQuiet();

    const stop = observePersistenceBannerHeight(banner(96, true), root);
    expect(props[PERSISTENCE_BANNER_HEIGHT_VAR]).toBe('96px');
    stop();
    expect(props[PERSISTENCE_BANNER_HEIGHT_VAR]).toBeUndefined();
    clearPersistenceBannerHeight(root);
  });

  it('バナーが無いときは変数を外す', () => {
    const { props, root } = createRoot();
    applyPersistenceBannerHeight(40, root);
    const stop = observePersistenceBannerHeight(null, root);
    expect(props[PERSISTENCE_BANNER_HEIGHT_VAR]).toBeUndefined();
    stop();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyReplayBannerHeight,
  clearReplayBannerHeight,
  observeReplayBannerHeight,
  REPLAY_BANNER_HEIGHT_VAR,
} from '../../../src/ui/replayBannerOffset';

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

describe('replayBannerOffset', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('高さを CSS 変数へ書き、負値は 0 にする', () => {
    const { props, root } = createRoot();

    applyReplayBannerHeight(64, root);
    expect(props[REPLAY_BANNER_HEIGHT_VAR]).toBe('64px');
    applyReplayBannerHeight(-8, root);
    expect(props[REPLAY_BANNER_HEIGHT_VAR]).toBe('0px');
    applyReplayBannerHeight(Number.NaN, root);
    expect(props[REPLAY_BANNER_HEIGHT_VAR]).toBe('0px');
    clearReplayBannerHeight(root);
    expect(props[REPLAY_BANNER_HEIGHT_VAR]).toBeUndefined();
  });

  it('バナー下端を同期し、解除で変数を外す', () => {
    const { props, root } = createRoot();
    const banner = {
      getBoundingClientRect: () => ({ bottom: 52 }),
    } as Element;

    const stop = observeReplayBannerHeight(banner, root);
    expect(props[REPLAY_BANNER_HEIGHT_VAR]).toBe('52px');
    stop();
    expect(props[REPLAY_BANNER_HEIGHT_VAR]).toBeUndefined();
  });

  it('バナーが無いときは変数を外す', () => {
    const { props, root } = createRoot();
    applyReplayBannerHeight(40, root);
    const stop = observeReplayBannerHeight(null, root);
    expect(props[REPLAY_BANNER_HEIGHT_VAR]).toBeUndefined();
    stop();
  });

  it('ResizeObserver で高さの変化を追跡し、解除時に監視を止める', () => {
    const { props, root } = createRoot();
    let bottom = 48;
    let resizeCallback: (() => void) | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resizeCallback = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    const banner = {
      getBoundingClientRect: () => ({ bottom }),
    } as Element;

    const stop = observeReplayBannerHeight(banner, root);
    expect(observe).toHaveBeenCalledWith(banner);
    expect(props[REPLAY_BANNER_HEIGHT_VAR]).toBe('48px');

    bottom = 72;
    resizeCallback?.();
    expect(props[REPLAY_BANNER_HEIGHT_VAR]).toBe('72px');

    stop();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(props[REPLAY_BANNER_HEIGHT_VAR]).toBeUndefined();
  });
});

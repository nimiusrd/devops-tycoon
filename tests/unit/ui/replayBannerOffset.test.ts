import { describe, expect, it } from 'vitest';
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
  it('高さを CSS 変数へ書き、負値は 0 にする', () => {
    const { props, root } = createRoot();

    applyReplayBannerHeight(64, root);
    expect(props[REPLAY_BANNER_HEIGHT_VAR]).toBe('64px');
    applyReplayBannerHeight(-8, root);
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
});

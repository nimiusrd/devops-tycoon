import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({
  useLayoutEffect: (effect: () => void) => effect(),
}));

import { resetWindowScroll, SceneScrollReset } from '../../../src/ui/resetWindowScroll';

describe('resetWindowScroll', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('window と document のスクローラを上端へ戻す', () => {
    const scrolling = { scrollTop: 480 };
    const documentElement = { scrollTop: 320 };
    const body = { scrollTop: 160 };
    const scrollTo = vi.fn();

    vi.stubGlobal('window', { scrollTo });
    vi.stubGlobal('document', {
      scrollingElement: scrolling,
      documentElement,
      body,
    });

    resetWindowScroll();

    expect(scrolling.scrollTop).toBe(0);
    expect(documentElement.scrollTop).toBe(0);
    expect(body.scrollTop).toBe(0);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('scrollingElement が無いときも window.scrollTo する', () => {
    const documentElement = { scrollTop: 90 };
    const body = { scrollTop: 40 };
    const scrollTo = vi.fn();

    vi.stubGlobal('window', { scrollTo });
    vi.stubGlobal('document', {
      scrollingElement: null,
      documentElement,
      body,
    });

    resetWindowScroll();

    expect(documentElement.scrollTop).toBe(0);
    expect(body.scrollTop).toBe(0);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('シーン配置時にスクロールを戻し、子要素をそのまま返す', () => {
    const scrolling = { scrollTop: 480 };
    const documentElement = { scrollTop: 320 };
    const body = { scrollTop: 160 };
    const scrollTo = vi.fn();
    vi.stubGlobal('window', { scrollTo });
    vi.stubGlobal('document', { scrollingElement: scrolling, documentElement, body });

    expect(SceneScrollReset({ children: 'scene' })).toBe('scene');
    expect(scrolling.scrollTop).toBe(0);
    expect(documentElement.scrollTop).toBe(0);
    expect(body.scrollTop).toBe(0);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });
});

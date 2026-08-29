import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetWindowScroll } from '../../../src/ui/resetWindowScroll';

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
});

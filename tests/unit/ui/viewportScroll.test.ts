import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetElementScroll, resetViewportScroll } from '../../../src/ui/viewportScroll';

describe('resetElementScroll', () => {
  it('scrollTop と scrollLeft を 0 にする', () => {
    const element = { scrollTop: 240, scrollLeft: 18 };
    resetElementScroll(element);
    expect(element).toEqual({ scrollTop: 0, scrollLeft: 0 });
  });
});

describe('resetViewportScroll', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('document が無いときは何もしない', () => {
    expect(() => resetViewportScroll(null)).not.toThrow();
  });

  it('window とオーバーレイの scrollTop を 0 にする', () => {
    const overlay = { scrollTop: 1800, scrollLeft: 12 };
    const html = { scrollTop: 3200, scrollLeft: 4 };
    const body = { scrollTop: 3200, scrollLeft: 0 };
    const scrollTo = vi.fn();
    const root = {
      defaultView: { scrollTo },
      documentElement: html,
      body,
      querySelectorAll: vi.fn(() => [overlay]),
    };

    resetViewportScroll(root as unknown as Document);

    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(html.scrollTop).toBe(0);
    expect(body.scrollTop).toBe(0);
    expect(overlay.scrollTop).toBe(0);
    expect(overlay.scrollLeft).toBe(0);
    expect(root.querySelectorAll).toHaveBeenCalledWith(
      '.result-overlay, .zoom-overlay, .sprint-layout',
    );
  });
});

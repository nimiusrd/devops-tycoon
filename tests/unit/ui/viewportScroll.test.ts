import { afterEach, describe, expect, it } from 'vitest';
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
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    document.querySelectorAll('.result-overlay, .zoom-overlay, .sprint-layout').forEach((node) => {
      node.remove();
    });
  });

  it('document が無いときは何もしない', () => {
    expect(() => resetViewportScroll(null)).not.toThrow();
  });

  it('document とオーバーレイの scrollTop を 0 にする', () => {
    const overlay = document.createElement('div');
    overlay.className = 'result-overlay';
    document.body.appendChild(overlay);
    document.documentElement.scrollTop = 3200;
    document.body.scrollTop = 3200;
    overlay.scrollTop = 1800;

    resetViewportScroll(document);

    expect(document.documentElement.scrollTop).toBe(0);
    expect(document.body.scrollTop).toBe(0);
    expect(overlay.scrollTop).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { applyDockScroll, dockScrollDelta } from '../../../src/ui/orgDockFocus';

describe('dockScrollDelta', () => {
  const dock = { top: 10, right: 200, bottom: 110, left: 20 };

  it('可視範囲内なら 0', () => {
    expect(dockScrollDelta({ top: 20, right: 80, bottom: 60, left: 30 }, dock)).toEqual({
      dTop: 0,
      dLeft: 0,
    });
  });

  it('下にはみ出した分だけ縦スクロールする', () => {
    expect(dockScrollDelta({ top: 90, right: 80, bottom: 140, left: 30 }, dock)).toEqual({
      dTop: 30,
      dLeft: 0,
    });
  });

  it('上にはみ出した分だけ戻す', () => {
    expect(dockScrollDelta({ top: -20, right: 80, bottom: 20, left: 30 }, dock)).toEqual({
      dTop: -30,
      dLeft: 0,
    });
  });
});

describe('applyDockScroll', () => {
  it('はみ出しがあれば scrollTop を進める', () => {
    const container = {
      scrollTop: 0,
      scrollLeft: 0,
      getBoundingClientRect: () => ({ top: 0, right: 100, bottom: 50, left: 0 }),
    };
    expect(applyDockScroll(container, { top: 40, right: 80, bottom: 90, left: 10 })).toBe(true);
    expect(container.scrollTop).toBe(40);
  });
});

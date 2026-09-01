import { describe, expect, it } from 'vitest';
import { applyDockScroll, dockScrollDelta, focusOrgDockHit } from '../../../src/ui/orgDockFocus';

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

  it('左右にはみ出した分だけ横スクロールする', () => {
    expect(dockScrollDelta({ top: 20, right: 80, bottom: 60, left: -10 }, dock)).toEqual({
      dTop: 0,
      dLeft: -30,
    });
    expect(dockScrollDelta({ top: 20, right: 240, bottom: 60, left: 180 }, dock)).toEqual({
      dTop: 0,
      dLeft: 40,
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

  it('可視範囲内ならスクロール位置を変更しない', () => {
    const container = {
      scrollTop: 12,
      scrollLeft: 8,
      getBoundingClientRect: () => ({ top: 0, right: 100, bottom: 50, left: 0 }),
    };

    expect(applyDockScroll(container, { top: 10, right: 80, bottom: 40, left: 20 })).toBe(false);
    expect(container).toMatchObject({ scrollTop: 12, scrollLeft: 8 });
  });
});

describe('focusOrgDockHit', () => {
  it('ページを動かさずフォーカスし、祖先ドック内だけスクロールする', () => {
    const focusCalls: FocusOptions[] = [];
    const dock = {
      scrollTop: 10,
      scrollLeft: 20,
      getBoundingClientRect: () => ({ top: 0, right: 100, bottom: 100, left: 0 }),
    };
    const hit = {
      focus: (options: FocusOptions) => focusCalls.push(options),
      closest: (selector: string) => (selector === '.org-island-badge-dock' ? dock : null),
      getBoundingClientRect: () => ({ top: 110, right: 130, bottom: 140, left: 110 }),
    } as unknown as HTMLElement;

    focusOrgDockHit(hit);

    expect(focusCalls).toEqual([{ preventScroll: true }]);
    expect(dock).toMatchObject({ scrollTop: 50, scrollLeft: 50 });
  });

  it('祖先ドックがなくても preventScroll 付きフォーカスは行う', () => {
    let focusOptions: FocusOptions | undefined;
    const hit = {
      focus: (options: FocusOptions) => {
        focusOptions = options;
      },
      closest: () => null,
    } as unknown as HTMLElement;

    focusOrgDockHit(hit);

    expect(focusOptions).toEqual({ preventScroll: true });
  });
});

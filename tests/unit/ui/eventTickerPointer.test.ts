import { describe, expect, it } from 'vitest';
import {
  applyTickerListScroll,
  applyTickerPointerPan,
  hitBlocksTickerTouchScroll,
  isTickerPointerSuppressed,
  pointInRect,
  readLineHeightPx,
  shouldCaptureTickerWheel,
  shouldClaimTickerTouchIdentifier,
  shouldClaimTickerTouchPan,
  shouldPreventTickerListKey,
  shouldPreventTickerTouchMove,
  shouldPreventTickerWheelDefault,
  tickerHasOverflow,
  tickerListKeyDelta,
  TICKER_LIST_ARROW_DELTA_PX,
  WHEEL_DELTA_LINE,
  WHEEL_DELTA_PAGE,
  WHEEL_DELTA_PIXEL,
  wheelDeltaYInCssPixels,
} from '../../../src/ui/eventTickerPointer';

describe('eventTickerPointer', () => {
  it('矩形内判定をする', () => {
    const rect = { left: 10, right: 40, top: 20, bottom: 50 };
    expect(pointInRect(10, 20, rect)).toBe(true);
    expect(pointInRect(40, 50, rect)).toBe(true);
    expect(pointInRect(9, 30, rect)).toBe(false);
  });

  it('Ctrl / Meta 付き wheel はキャプチャしない', () => {
    expect(shouldCaptureTickerWheel({ ctrlKey: false, metaKey: false })).toBe(true);
    expect(shouldCaptureTickerWheel({ ctrlKey: true, metaKey: false })).toBe(false);
    expect(shouldCaptureTickerWheel({ ctrlKey: false, metaKey: true })).toBe(false);
  });

  it('縦差分がある溢れたリストだけホイールの既定動作を抑止する', () => {
    expect(shouldPreventTickerWheelDefault(true, 40)).toBe(true);
    expect(shouldPreventTickerWheelDefault(true, -12)).toBe(true);
    expect(shouldPreventTickerWheelDefault(true, 0)).toBe(false);
    expect(shouldPreventTickerWheelDefault(false, 40)).toBe(false);
    expect(shouldPreventTickerWheelDefault(false, 0)).toBe(false);
  });

  it('deltaMode を CSS ピクセルへ換算する', () => {
    expect(wheelDeltaYInCssPixels({ deltaY: 40, deltaMode: WHEEL_DELTA_PIXEL }, 16, 80)).toBe(40);
    expect(wheelDeltaYInCssPixels({ deltaY: 3, deltaMode: WHEEL_DELTA_LINE }, 16, 80)).toBe(48);
    expect(wheelDeltaYInCssPixels({ deltaY: 1, deltaMode: WHEEL_DELTA_PAGE }, 16, 80)).toBe(80);
    expect(readLineHeightPx('normal')).toBe(24);
    expect(readLineHeightPx('18px')).toBe(18);
  });

  it('溢れているリストだけ delta でスクロールする', () => {
    const list = { scrollTop: 0, scrollHeight: 200, clientHeight: 50 };
    expect(applyTickerListScroll(list, 40)).toBe(true);
    expect(list.scrollTop).toBe(40);
    expect(applyTickerListScroll(list, 0)).toBe(false);
    const short = { scrollTop: 0, scrollHeight: 40, clientHeight: 50 };
    expect(applyTickerListScroll(short, 20)).toBe(false);
    const frozen = {
      scrollHeight: 200,
      clientHeight: 50,
      get scrollTop() {
        return 0;
      },
      set scrollTop(_value: number) {
        /* スクロールポートでない要素は代入を無視する */
      },
    };
    expect(applyTickerListScroll(frozen, 40)).toBe(false);
  });

  it('境界でもパンの基準座標を進め、反転したらすぐ動く', () => {
    const list = {
      scrollTop: 0,
      scrollHeight: 200,
      clientHeight: 50,
      parentElement: null,
    };
    const blocked = applyTickerPointerPan(list, 100, 180);
    expect(blocked.moved).toBe(false);
    expect(blocked.lastY).toBe(180);
    expect(list.scrollTop).toBe(0);
    const reversed = applyTickerPointerPan(list, blocked.lastY, 100);
    expect(reversed.moved).toBe(true);
    expect(reversed.lastY).toBe(100);
    expect(list.scrollTop).toBe(80);
  });

  it('タスク粒のヒットはドラッグ可能な粒だけタッチスクロールしない', () => {
    const grain = {
      closest: (selector: string) =>
        selector === '[data-task-id][data-draggable="true"]' ? grain : null,
    };
    const idle = {
      closest: (selector: string) => (selector === '[data-task-id]' ? idle : null),
    };
    const empty = { closest: () => null };
    expect(hitBlocksTickerTouchScroll(grain as unknown as EventTarget)).toBe(true);
    expect(hitBlocksTickerTouchScroll(idle as unknown as EventTarget)).toBe(false);
    expect(hitBlocksTickerTouchScroll(empty as unknown as EventTarget)).toBe(false);
    expect(hitBlocksTickerTouchScroll(null)).toBe(false);
  });

  it('Pixi canvas でも座標ヒットした粒はタッチスクロールしない', () => {
    const canvas = { closest: () => null };
    const options = {
      clientX: 40,
      clientY: 80,
      hitsBoardDot: (x: number, y: number) => x === 40 && y === 80,
    };
    expect(hitBlocksTickerTouchScroll(canvas as unknown as EventTarget, options)).toBe(true);
    expect(
      hitBlocksTickerTouchScroll(canvas as unknown as EventTarget, {
        ...options,
        clientX: 1,
      }),
    ).toBe(false);
    expect(hitBlocksTickerTouchScroll(canvas as unknown as EventTarget)).toBe(false);
  });

  it('inert / 結果・ズームオーバーレイ上ではティッカー入力を止める', () => {
    const live = { closest: () => null };
    const inert = {
      closest: (selector: string) => (selector === '[inert]' ? inert : null),
    };
    const hiddenOnly = {
      closest: (selector: string) => (selector === '[aria-hidden="true"]' ? hiddenOnly : null),
    };
    const overlayHit = {
      closest: (selector: string) =>
        selector === '.result-overlay' || selector.includes('.result-overlay') ? overlayHit : null,
    };
    const zoomHit = {
      closest: (selector: string) =>
        selector === '.zoom-overlay' || selector.includes('.zoom-overlay') ? zoomHit : null,
    };
    const tutorialHit = {
      closest: (selector: string) => (selector === '[role="dialog"]' ? tutorialHit : null),
    };
    expect(isTickerPointerSuppressed(live, null)).toBe(false);
    expect(isTickerPointerSuppressed(inert, null)).toBe(true);
    expect(isTickerPointerSuppressed(hiddenOnly, null)).toBe(false);
    expect(isTickerPointerSuppressed(live, overlayHit as unknown as EventTarget)).toBe(true);
    expect(isTickerPointerSuppressed(live, zoomHit as unknown as EventTarget)).toBe(true);
    expect(isTickerPointerSuppressed(live, tutorialHit as unknown as EventTarget)).toBe(false);

    const nativeLike = {
      closest(this: unknown, selector: string) {
        if (this !== nativeLike) throw new TypeError('Illegal invocation');
        return selector.includes('.result-overlay') ? nativeLike : null;
      },
    };
    expect(isTickerPointerSuppressed(live, nativeLike as unknown as EventTarget)).toBe(true);
  });

  it('溢れているときだけリストか親をスクロール対象にする', () => {
    expect(
      tickerHasOverflow({
        scrollHeight: 200,
        clientHeight: 50,
        parentElement: { scrollHeight: 50, clientHeight: 50 },
      }),
    ).toBe(true);
    expect(
      tickerHasOverflow({
        scrollHeight: 40,
        clientHeight: 50,
        parentElement: { scrollHeight: 80, clientHeight: 40 },
      }),
    ).toBe(true);
    expect(
      tickerHasOverflow({
        scrollHeight: 40,
        clientHeight: 50,
        parentElement: { scrollHeight: 50, clientHeight: 50 },
      }),
    ).toBe(false);
    expect(
      tickerHasOverflow({
        scrollHeight: 40,
        clientHeight: 50,
        parentElement: null,
      }),
    ).toBe(false);
  });

  it('認識したスクロールキーの delta を返し、溢れているときは境界でも抑止する', () => {
    expect(tickerListKeyDelta('ArrowDown', 80, 0, 200)).toBe(TICKER_LIST_ARROW_DELTA_PX);
    expect(tickerListKeyDelta('ArrowUp', 80, 40, 200)).toBe(-TICKER_LIST_ARROW_DELTA_PX);
    expect(tickerListKeyDelta('PageDown', 80, 0, 200)).toBe(80);
    expect(tickerListKeyDelta('PageUp', 80, 80, 200)).toBe(-80);
    expect(tickerListKeyDelta('End', 80, 0, 200)).toBe(200);
    expect(tickerListKeyDelta('Home', 80, 40, 200)).toBe(-40);
    expect(tickerListKeyDelta('Tab', 80, 0, 200)).toBeNull();
    expect(shouldPreventTickerListKey('End', true)).toBe(true);
    expect(shouldPreventTickerListKey('ArrowDown', true)).toBe(true);
    expect(shouldPreventTickerListKey('End', false)).toBe(false);
    expect(shouldPreventTickerListKey('Tab', true)).toBe(false);
  });

  it('溢れたリスト上の touch/pen 開始だけパンを確保し、粒と mouse は通す', () => {
    expect(
      shouldClaimTickerTouchPan({
        pointerType: 'touch',
        defaultPrevented: false,
        overflow: true,
        hitsBoardDot: false,
      }),
    ).toBe(true);
    expect(
      shouldClaimTickerTouchPan({
        pointerType: 'pen',
        defaultPrevented: false,
        overflow: true,
        hitsBoardDot: false,
      }),
    ).toBe(true);
    expect(
      shouldClaimTickerTouchPan({
        pointerType: 'mouse',
        defaultPrevented: false,
        overflow: true,
        hitsBoardDot: false,
      }),
    ).toBe(false);
    expect(
      shouldClaimTickerTouchPan({
        pointerType: 'touch',
        defaultPrevented: false,
        overflow: false,
        hitsBoardDot: false,
      }),
    ).toBe(false);
    expect(
      shouldClaimTickerTouchPan({
        pointerType: 'touch',
        defaultPrevented: false,
        overflow: true,
        hitsBoardDot: true,
      }),
    ).toBe(false);
    expect(
      shouldClaimTickerTouchPan({
        pointerType: 'touch',
        defaultPrevented: true,
        overflow: true,
        hitsBoardDot: false,
      }),
    ).toBe(false);
  });

  it('複数接触のピンチとリスト外開始の touchmove は抑止しない', () => {
    expect(shouldClaimTickerTouchIdentifier(1)).toBe(true);
    expect(shouldClaimTickerTouchIdentifier(2)).toBe(false);
    expect(shouldPreventTickerTouchMove(1, true)).toBe(true);
    expect(shouldPreventTickerTouchMove(1, false)).toBe(false);
    expect(shouldPreventTickerTouchMove(2, true)).toBe(false);
    expect(shouldPreventTickerTouchMove(2, false)).toBe(false);
  });
});

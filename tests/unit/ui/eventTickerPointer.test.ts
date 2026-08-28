import { describe, expect, it } from 'vitest';
import {
  applyTickerListScroll,
  hitBlocksTickerTouchScroll,
  isTickerPointerSuppressed,
  pointInRect,
  readLineHeightPx,
  shouldCaptureTickerWheel,
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
  });

  it('タスク粒のヒットはタッチスクロールしない', () => {
    const grain = {
      closest: (selector: string) => (selector === '[data-task-id]' ? grain : null),
    };
    const empty = { closest: () => null };
    expect(hitBlocksTickerTouchScroll(grain as unknown as EventTarget)).toBe(true);
    expect(hitBlocksTickerTouchScroll(empty as unknown as EventTarget)).toBe(false);
    expect(hitBlocksTickerTouchScroll(null)).toBe(false);
  });

  it('inert / 結果オーバーレイ上ではティッカー入力を止める', () => {
    const live = { closest: () => null };
    const inert = {
      closest: (selector: string) => (selector === '[inert]' ? inert : null),
    };
    const hidden = {
      closest: (selector: string) => (selector === '[aria-hidden="true"]' ? hidden : null),
    };
    const overlayHit = {
      closest: (selector: string) =>
        selector === '.result-overlay, [role="dialog"]' ? overlayHit : null,
    };
    expect(isTickerPointerSuppressed(live, null)).toBe(false);
    expect(isTickerPointerSuppressed(inert, null)).toBe(true);
    expect(isTickerPointerSuppressed(hidden, null)).toBe(true);
    expect(isTickerPointerSuppressed(live, overlayHit as unknown as EventTarget)).toBe(true);
  });
});

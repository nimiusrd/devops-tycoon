import { describe, expect, it } from 'vitest';
import {
  applyTickerListScroll,
  hitBlocksTickerTouchScroll,
  pointInRect,
  shouldCaptureTickerWheel,
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
});

import { describe, expect, it } from 'vitest';
import { wrapTabIfNeeded } from '../../../src/ui/dialogOverlayLock';

const dialog = { id: 'dialog' };
const first = { id: 'first' };
const middle = { id: 'middle' };
const last = { id: 'last' };

describe('wrapTabIfNeeded', () => {
  it('フォーカス対象が無いときはダイアログへ戻す', () => {
    expect(wrapTabIfNeeded([], null, false, dialog)).toBe(dialog);
    expect(wrapTabIfNeeded([], dialog, true, dialog)).toBe(dialog);
  });

  it('最後の要素からの Tab は先頭へ循環する', () => {
    expect(wrapTabIfNeeded([first, middle, last], last, false, dialog)).toBe(first);
  });

  it('先頭の要素からの Shift+Tab は末尾へ循環する', () => {
    expect(wrapTabIfNeeded([first, middle, last], first, true, dialog)).toBe(last);
  });

  it('ダイアログ自身からの Shift+Tab は末尾へ循環する', () => {
    expect(wrapTabIfNeeded([first, last], dialog, true, dialog)).toBe(last);
  });

  it('ダイアログ内の途中ではブラウザ既定に任せる', () => {
    expect(wrapTabIfNeeded([first, middle, last], first, false, dialog)).toBeNull();
    expect(wrapTabIfNeeded([first, middle, last], middle, false, dialog)).toBeNull();
    expect(wrapTabIfNeeded([first, middle, last], middle, true, dialog)).toBeNull();
    expect(wrapTabIfNeeded([first, last], dialog, false, dialog)).toBeNull();
  });

  it('背面などダイアログ外からの Tab はダイアログ内へ閉じる', () => {
    const outside = { id: 'outside' };
    expect(wrapTabIfNeeded([first, last], outside, false, dialog)).toBe(first);
    expect(wrapTabIfNeeded([first, last], outside, true, dialog)).toBe(last);
    expect(wrapTabIfNeeded([first, last], null, false, dialog)).toBe(first);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  listFocusable,
  lockBackgroundSiblings,
  wrapTabIfNeeded,
} from '../../../src/ui/dialogOverlayLock';

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

class ElementStub {
  id = '';
  inert = false;
  parentElement: ElementStub | null = null;
  children: ElementStub[] = [];
  private attributes = new Map<string, string>();

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
}

describe('listFocusable', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('不可視・inert・aria-hidden・aria-disabled を除外する', () => {
    const makeCandidate = ({
      closest = null,
      ariaDisabled = null,
      rectCount = 1,
    }: {
      closest?: string | null;
      ariaDisabled?: string | null;
      rectCount?: number;
    }) => ({
      closest: vi.fn((selector: string) => (selector === closest ? {} : null)),
      getAttribute: vi.fn(() => ariaDisabled),
      getClientRects: vi.fn(() => Array.from({ length: rectCount })),
    });
    const visible = makeCandidate({});
    const inert = makeCandidate({ closest: '[inert]' });
    const ariaHidden = makeCandidate({ closest: '[aria-hidden="true"]' });
    const disabled = makeCandidate({ ariaDisabled: 'true' });
    const invisible = makeCandidate({ rectCount: 0 });
    const querySelectorAll = vi.fn(() => [visible, inert, ariaHidden, disabled, invisible]);

    expect(listFocusable({ querySelectorAll } as unknown as HTMLElement)).toEqual([visible]);
    expect(querySelectorAll).toHaveBeenCalledOnce();
  });
});

describe('lockBackgroundSiblings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('親がないダイアログでは何も変更しない', () => {
    const dialog = new ElementStub();
    const restore = lockBackgroundSiblings(dialog as unknown as HTMLElement);
    expect(restore()).toBeUndefined();
  });

  it('兄弟と portal 配下をロックし、元の属性値へ復元する', () => {
    vi.stubGlobal('HTMLElement', ElementStub);
    const body = new ElementStub();
    const root = new ElementStub();
    root.id = 'root';
    root.setAttribute('aria-hidden', 'menu');
    const app = new ElementStub();
    app.inert = true;
    const nested = new ElementStub();
    const dialog = new ElementStub();
    root.children = [app, nested];
    body.children = [root, dialog];
    root.parentElement = body;
    dialog.parentElement = body;
    vi.stubGlobal('document', { body });

    const restore = lockBackgroundSiblings(dialog as unknown as HTMLElement);

    expect(root.inert).toBe(true);
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(app.inert).toBe(true);
    expect(app.getAttribute('aria-hidden')).toBe('true');
    expect(nested.inert).toBe(true);
    expect(nested.getAttribute('aria-hidden')).toBe('true');

    restore();

    expect(root.inert).toBe(false);
    expect(root.getAttribute('aria-hidden')).toBe('menu');
    expect(app.inert).toBe(true);
    expect(app.getAttribute('aria-hidden')).toBeNull();
    expect(nested.inert).toBe(false);
    expect(nested.getAttribute('aria-hidden')).toBeNull();
    expect(dialog.inert).toBe(false);
  });
});

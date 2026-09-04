import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as {
    value?: unknown;
    dependencies?: readonly unknown[];
    cleanup?: () => void;
  }[],
  effects: [] as (() => void)[],
}));

// React の effect/ref の寿命だけを代行し、イベント処理とロックの実装は実物を使う。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    hooks.slots[index] ??= { value: { current: initial } };
    return hooks.slots[index].value;
  },
  useLayoutEffect(effect: () => void | (() => void), dependencies: readonly unknown[]) {
    const index = hooks.cursor++;
    const previous = hooks.slots[index];
    if (
      previous?.dependencies?.length === dependencies.length &&
      dependencies.every((value, i) => Object.is(value, previous.dependencies?.[i]))
    ) {
      return;
    }
    const slot = { dependencies, cleanup: undefined as (() => void) | undefined };
    hooks.slots[index] = slot;
    hooks.effects.push(() => {
      previous?.cleanup?.();
      slot.cleanup = effect() ?? undefined;
    });
  },
}));

import { useDialogOverlayLock } from '../../../src/ui/useDialogOverlayLock';

class ElementStub {
  id = '';
  inert = false;
  parentElement: ElementStub | null = null;
  children: ElementStub[] = [];
  focusable = false;
  private attributes = new Map<string, string>();

  append(...children: ElementStub[]) {
    children.forEach((child) => {
      child.parentElement = this;
      this.children.push(child);
    });
    return this;
  }

  contains(target: unknown): boolean {
    return target === this || this.children.some((child) => child.contains(target));
  }

  querySelectorAll(): ElementStub[] {
    return this.children.flatMap((child) => [
      ...(child.focusable ? [child] : []),
      ...child.querySelectorAll(),
    ]);
  }

  closest(selector: string): ElementStub | null {
    const matches =
      (selector === '[inert]' && this.inert) ||
      (selector === '[aria-hidden="true"]' && this.getAttribute('aria-hidden') === 'true');
    return matches ? this : (this.parentElement?.closest(selector) ?? null);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  getClientRects() {
    return [{}];
  }

  focus() {
    if (documentStub.activeElement === this) return;
    documentStub.activeElement = this;
    focusIn(this);
  }
}

class DocumentStub extends EventTarget {
  body = new ElementStub();
  activeElement: unknown = null;

  // Node の EventTarget は removeEventListener の boolean capture を照合しないため、
  // ブラウザと同じ登録・解除の意味を保つよう options オブジェクトへ正規化する。
  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) {
    super.removeEventListener(
      type,
      callback,
      typeof options === 'boolean' ? { capture: options } : options,
    );
  }
}

let documentStub: DocumentStub;

function focusIn(target: unknown) {
  const event = new Event('focusin');
  Object.defineProperty(event, 'target', { value: target });
  documentStub.dispatchEvent(event);
}

function keyDown(key: string, shiftKey = false) {
  const event = new Event('keydown', { cancelable: true, bubbles: true });
  Object.assign(event, { key, shiftKey });
  documentStub.dispatchEvent(event);
  return event;
}

function button() {
  return Object.assign(new ElementStub(), { focusable: true });
}

function mountLock(
  dialog: ElementStub | null,
  initial?: Parameters<typeof useDialogOverlayLock>[1],
) {
  const ref = { current: dialog as unknown as HTMLElement | null };
  let options = initial;
  const render = () => {
    hooks.cursor = 0;
    useDialogOverlayLock(ref, options);
    for (const effect of hooks.effects.splice(0)) effect();
  };
  render();
  return {
    update(next: Parameters<typeof useDialogOverlayLock>[1]) {
      options = next;
      render();
    },
  };
}

function unmount() {
  for (const slot of hooks.slots) slot.cleanup?.();
  hooks.slots = [];
  hooks.effects = [];
  hooks.cursor = 0;
}

beforeEach(() => {
  documentStub = new DocumentStub();
  vi.stubGlobal('document', documentStub);
  vi.stubGlobal('HTMLElement', ElementStub);
  vi.stubGlobal('Node', ElementStub);
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

describe('useDialogOverlayLock', () => {
  it('開いたら背面を操作対象から外し、閉じたら元の属性と起点のフォーカスへ戻す', () => {
    const trigger = button();
    const root = Object.assign(new ElementStub(), { id: 'root' }).append(trigger);
    root.setAttribute('aria-hidden', 'false');
    const dialog = new ElementStub().append(button());
    documentStub.body.append(root, dialog);
    trigger.focus();

    mountLock(dialog, { restoreFocus: true });

    expect(documentStub.activeElement).toBe(dialog);
    expect(root.inert).toBe(true);
    expect(trigger.inert).toBe(true);
    expect(root.getAttribute('aria-hidden')).toBe('true');
    unmount();
    expect(root.inert).toBe(false);
    expect(trigger.inert).toBe(false);
    expect(root.getAttribute('aria-hidden')).toBe('false');
    expect(trigger.getAttribute('aria-hidden')).toBeNull();
    expect(documentStub.activeElement).toBe(trigger);

    // 閉じたダイアログは、以後のキー操作やフォーカスを奪わない。
    expect(keyDown('Tab').defaultPrevented).toBe(false);
    trigger.focus();
    expect(documentStub.activeElement).toBe(trigger);
  });

  it('既に内部へフォーカスがある場合は維持し、既定では閉じても背面へ戻さない', () => {
    const first = button();
    const dialog = new ElementStub().append(first);
    const outside = button();
    documentStub.body.append(outside, dialog);
    first.focus();

    mountLock(dialog, { restoreFocus: true });
    expect(documentStub.activeElement).toBe(first);
    unmount();
    expect(documentStub.activeElement).toBe(first);

    outside.focus();
    mountLock(dialog);
    expect(documentStub.activeElement).toBe(dialog);
    unmount();
    expect(documentStub.activeElement).toBe(dialog);
  });

  it('端で Tab を循環させ、途中の Tab と通常のキーはブラウザへ任せる', () => {
    const first = button();
    const middle = button();
    const last = button();
    const dialog = new ElementStub().append(first, middle, last);
    documentStub.body.append(dialog);
    mountLock(dialog);

    last.focus();
    expect(keyDown('Tab').defaultPrevented).toBe(true);
    expect(documentStub.activeElement).toBe(first);
    expect(keyDown('Tab', true).defaultPrevented).toBe(true);
    expect(documentStub.activeElement).toBe(last);

    middle.focus();
    expect(keyDown('Tab').defaultPrevented).toBe(false);
    expect(keyDown('Enter').defaultPrevented).toBe(false);
    expect(documentStub.activeElement).toBe(middle);
    dialog.focus();
    expect(keyDown('Tab', true).defaultPrevented).toBe(true);
    expect(documentStub.activeElement).toBe(last);
  });

  it('外へ移されたフォーカスは先頭へ戻し、フォーカス対象が無い場合は本体へ戻す', () => {
    const first = button();
    const dialog = new ElementStub().append(first, button());
    const outside = button();
    documentStub.body.append(outside, dialog);
    mountLock(dialog);

    outside.focus();
    expect(documentStub.activeElement).toBe(first);
    focusIn({});
    expect(documentStub.activeElement).toBe(first);

    // activeElement が一時的に HTMLElement でなくなる遷移でも内側へ閉じる。
    documentStub.activeElement = null;
    expect(keyDown('Tab').defaultPrevented).toBe(true);
    expect(documentStub.activeElement).toBe(first);

    dialog.children.forEach((child) => (child.focusable = false));
    outside.focus();
    expect(documentStub.activeElement).toBe(dialog);
    expect(keyDown('Tab').defaultPrevented).toBe(true);
    expect(keyDown('Tab', true).defaultPrevented).toBe(true);
    expect(documentStub.activeElement).toBe(dialog);
  });

  it('Escape は最新の閉じる操作へ一度だけ届き、操作を外すか閉じた後は抑止しない', () => {
    const dialog = new ElementStub();
    documentStub.body.append(dialog);
    const original = vi.fn();
    const latest = vi.fn();
    const lock = mountLock(dialog, { onDismiss: original });

    expect(keyDown('Escape').defaultPrevented).toBe(true);
    expect(original).toHaveBeenCalledOnce();
    lock.update({ onDismiss: latest });
    expect(keyDown('Escape').defaultPrevented).toBe(true);
    expect(original).toHaveBeenCalledOnce();
    expect(latest).toHaveBeenCalledOnce();
    lock.update(undefined);
    expect(keyDown('Escape').defaultPrevented).toBe(false);
    expect(latest).toHaveBeenCalledOnce();

    lock.update({ onDismiss: latest });
    unmount();
    expect(keyDown('Escape').defaultPrevented).toBe(false);
    expect(latest).toHaveBeenCalledOnce();
  });

  it('ダイアログがまだ無い場合はフォーカスもキー操作も変更しない', () => {
    const trigger = button();
    documentStub.body.append(trigger);
    trigger.focus();
    const dismiss = vi.fn();
    mountLock(null, { restoreFocus: true, onDismiss: dismiss });

    expect(documentStub.activeElement).toBe(trigger);
    expect(trigger.inert).toBe(false);
    expect(keyDown('Escape').defaultPrevented).toBe(false);
    expect(keyDown('Tab').defaultPrevented).toBe(false);
    expect(dismiss).not.toHaveBeenCalled();
  });
});

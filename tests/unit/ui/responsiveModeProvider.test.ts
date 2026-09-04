import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  cursor: 0,
  dirty: false,
  slots: [] as { value?: unknown; dependencies?: readonly unknown[]; cleanup?: () => void }[],
  effects: [] as (() => void)[],
  layoutEffects: [] as (() => void)[],
  effect(
    queue: (() => void)[],
    setup: () => void | (() => void),
    dependencies: readonly unknown[],
  ) {
    const index = this.cursor++;
    const previous = this.slots[index];
    if (
      previous?.dependencies?.length === dependencies.length &&
      dependencies.every((value, i) => Object.is(value, previous.dependencies?.[i]))
    )
      return;
    const slot = { dependencies, cleanup: undefined as (() => void) | undefined };
    this.slots[index] = slot;
    queue.push(() => {
      previous?.cleanup?.();
      slot.cleanup = setup() ?? undefined;
    });
  },
}));

// viewport hook は実装を使い、DOM のない環境で state と effect のみを代行する。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState(initial: () => unknown) {
    const index = hooks.cursor++;
    hooks.slots[index] ??= { value: initial() };
    const slot = hooks.slots[index];
    return [
      slot.value,
      (update: (current: unknown) => unknown) => {
        const next = update(slot.value);
        if (!Object.is(next, slot.value)) {
          slot.value = next;
          hooks.dirty = true;
        }
      },
    ];
  },
  useEffect(setup: () => void | (() => void), dependencies: readonly unknown[]) {
    hooks.effect(hooks.effects, setup, dependencies);
  },
  useLayoutEffect(setup: () => void | (() => void), dependencies: readonly unknown[]) {
    hooks.effect(hooks.layoutEffects, setup, dependencies);
  },
}));

import { ResponsiveModeContext, type ResponsiveMode } from '../../../src/ui/responsiveModeCore';
import { ResponsiveModeProvider } from '../../../src/ui/responsiveModeProvider';

class Viewport extends EventTarget {
  innerWidth = 1200;
  innerHeight = 900;
}

let viewport: Viewport;

function unmount() {
  for (const slot of hooks.slots) slot.cleanup?.();
  hooks.slots = [];
  hooks.effects = [];
  hooks.layoutEffects = [];
  hooks.cursor = 0;
  hooks.dirty = false;
}

function mount(beforeEffects?: () => void) {
  let tree: ReactElement<{ value: ResponsiveMode; children: ReactNode }>;
  const render = () => {
    hooks.cursor = 0;
    hooks.dirty = false;
    tree = ResponsiveModeProvider({ children: '画面' });
  };
  const flush = () => {
    do {
      if (hooks.dirty) render();
      for (const effect of hooks.layoutEffects.splice(0)) effect();
      for (const effect of hooks.effects.splice(0)) effect();
    } while (hooks.dirty);
  };
  render();
  beforeEffects?.();
  flush();
  return {
    get tree() {
      return tree;
    },
    resize(width: number, height: number) {
      viewport.innerWidth = width;
      viewport.innerHeight = height;
      viewport.dispatchEvent(new Event('resize'));
      flush();
    },
  };
}

describe('ResponsiveModeProvider の viewport 同期', () => {
  beforeEach(() => {
    viewport = new Viewport();
    vi.stubGlobal('window', viewport);
    vi.stubGlobal('document', { documentElement: { dataset: {} } });
  });

  afterEach(() => {
    unmount();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('初期モードを context とルート属性へ反映し、同一モードでは値を維持する', () => {
    const view = mount();
    const initial = view.tree.props.value;
    expect(view.tree.type).toBe(ResponsiveModeContext.Provider);
    expect(view.tree.props.children).toBe('画面');
    expect(initial).toEqual({ width: 'wide', height: 'normal' });
    expect(document.documentElement.dataset).toEqual({
      responsiveWidth: 'wide',
      responsiveHeight: 'normal',
    });

    view.resize(1000, 800);
    expect(view.tree.props.value).toBe(initial);
    view.resize(860, 720);
    expect(view.tree.props.value).toEqual({ width: 'narrow', height: 'short' });
    expect(document.documentElement.dataset).toEqual({
      responsiveWidth: 'narrow',
      responsiveHeight: 'short',
    });
    view.resize(861, 721);
    expect(view.tree.props.value).toEqual({ width: 'wide', height: 'normal' });
    expect(document.documentElement.dataset).toEqual({
      responsiveWidth: 'wide',
      responsiveHeight: 'normal',
    });
  });

  it('初期 render から effect までに viewport が変わっても再計測で追従する', () => {
    const view = mount(() => {
      viewport.innerWidth = 700;
      viewport.innerHeight = 600;
    });
    expect(view.tree.props.value).toEqual({ width: 'narrow', height: 'short' });
    expect(document.documentElement.dataset).toEqual({
      responsiveWidth: 'narrow',
      responsiveHeight: 'short',
    });
  });

  it('アンマウントで自分の属性と resize listener を解除する', () => {
    const add = vi.spyOn(viewport, 'addEventListener');
    const remove = vi.spyOn(viewport, 'removeEventListener');
    const view = mount();
    const listener = add.mock.calls[0][1];
    const value = view.tree.props.value;
    unmount();

    expect(remove).toHaveBeenCalledExactlyOnceWith('resize', listener);
    expect(document.documentElement.dataset).toEqual({});
    view.resize(600, 500);
    expect(view.tree.props.value).toBe(value);
    expect(document.documentElement.dataset).toEqual({});
  });

  it.each([
    [{ responsiveWidth: 'narrow' }, { responsiveWidth: 'narrow' }],
    [{ responsiveHeight: 'short' }, { responsiveHeight: 'short' }],
    [
      { responsiveWidth: 'narrow', responsiveHeight: 'short' },
      { responsiveWidth: 'narrow', responsiveHeight: 'short' },
    ],
  ])('別の所有者が書き換えた属性 %o は cleanup で消さない', (changed, remaining) => {
    mount();
    Object.assign(document.documentElement.dataset, changed);
    unmount();
    expect(document.documentElement.dataset).toEqual(remaining);
  });

  it('document がない環境でも context のモードを返す', () => {
    vi.stubGlobal('document', undefined);
    const view = mount();
    expect(view.tree.props.value).toEqual({ width: 'wide', height: 'normal' });
    expect(() => unmount()).not.toThrow();
  });
});

import { isValidElement, type ReactElement, type ReactNode, type RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as { value?: unknown; dependencies?: readonly unknown[]; cleanup?: () => void }[],
  effects: [] as (() => void)[],
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    hooks.slots[index] ??= { value: { current: initial } };
    return hooks.slots[index].value;
  },
  useLayoutEffect(setup: () => void | (() => void), dependencies: readonly unknown[]) {
    const index = hooks.cursor++;
    const previous = hooks.slots[index];
    if (
      previous?.dependencies?.length === dependencies.length &&
      dependencies.every((value, i) => Object.is(value, previous.dependencies?.[i]))
    )
      return;
    const slot = { dependencies, cleanup: undefined as (() => void) | undefined };
    hooks.slots[index] = slot;
    hooks.effects.push(() => {
      previous?.cleanup?.();
      slot.cleanup = setup() ?? undefined;
    });
  },
}));

import { AspectStage, type AspectStageProps } from '../../../src/ui/AspectStage';

class Observer {
  static all: Observer[] = [];
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(
    readonly notify: (entries: { contentRect?: { width: number; height: number } }[]) => void,
  ) {
    Observer.all.push(this);
  }
}

class Host {
  clientWidth = 800;
  clientHeight = 600;
  style = { width: '', height: '' };
}

type StageProps = {
  ref: RefObject<Host | null>;
  children?: ReactNode;
  className?: string;
  style?: { aspectRatio?: number };
  'data-testid'?: string;
};

function unmount() {
  for (const slot of hooks.slots) slot.cleanup?.();
  hooks.slots = [];
  hooks.effects = [];
  hooks.cursor = 0;
}

function mount(
  initial: Partial<AspectStageProps> = {},
  attach: 'both' | 'slot' | 'stage' = 'both',
) {
  const slot = new Host();
  const stage = new Host();
  let props: AspectStageProps = { ratio: 2, children: 'ボード', ...initial };
  let tree: ReactElement<StageProps>;
  let content: ReactElement<StageProps>;
  const update = (next: Partial<AspectStageProps> = {}) => {
    props = { ...props, ...next };
    hooks.cursor = 0;
    tree = AspectStage(props);
    if (!isValidElement<StageProps>(tree.props.children)) throw new Error('ステージがありません');
    content = tree.props.children;
    tree.props.ref.current = attach === 'stage' ? null : slot;
    content.props.ref.current = attach === 'slot' ? null : stage;
    for (const effect of hooks.effects.splice(0)) effect();
  };
  update();
  return {
    slot,
    stage,
    update,
    get tree() {
      return tree;
    },
    get content() {
      return content;
    },
  };
}

describe('AspectStage の計測と observer lifecycle', () => {
  beforeEach(() => {
    Observer.all = [];
    vi.stubGlobal('ResizeObserver', Observer);
  });

  afterEach(() => {
    unmount();
    vi.unstubAllGlobals();
  });

  it('外側のスロットだけを監視し、初期寸法と表示属性を適用する', () => {
    const view = mount({ className: 'board-stage', 'data-testid': 'board-slot' });

    expect(view.tree.props.className).toBe('aspect-stage board-stage');
    expect(view.tree.props['data-testid']).toBe('board-slot');
    expect(view.content.props).toMatchObject({
      className: 'aspect-stage-content',
      'data-testid': 'aspect-stage-content',
      style: { aspectRatio: 2 },
      children: 'ボード',
    });
    expect(view.stage.style).toEqual({ width: '800px', height: '400px' });
    expect(Observer.all).toHaveLength(1);
    expect(Observer.all[0].observe).toHaveBeenCalledExactlyOnceWith(view.slot);
  });

  it('通知矩形で再計測し、矩形のない通知では最新のスロット寸法を使う', () => {
    const view = mount();
    const observer = Observer.all[0];
    observer.notify([{ contentRect: { width: 900, height: 300 } }]);
    expect(view.stage.style).toEqual({ width: '600px', height: '300px' });

    view.slot.clientWidth = 420;
    view.slot.clientHeight = 500;
    observer.notify([]);
    expect(view.stage.style).toEqual({ width: '420px', height: '210px' });
    view.slot.clientWidth = 360;
    observer.notify([{}]);
    expect(view.stage.style).toEqual({ width: '360px', height: '180px' });
  });

  it('比率の変更時だけ監視を張り替え、古い通知とアンマウント後の通知を無視する', () => {
    const view = mount();
    const previous = Observer.all[0];
    view.update({ children: '更新ボード' });
    expect(Observer.all).toHaveLength(1);
    view.update({ ratio: 1 });
    expect(previous.disconnect).toHaveBeenCalledOnce();
    expect(Observer.all).toHaveLength(2);
    expect(view.stage.style).toEqual({ width: '600px', height: '600px' });

    previous.notify([{ contentRect: { width: 200, height: 100 } }]);
    expect(view.stage.style).toEqual({ width: '600px', height: '600px' });
    const current = Observer.all[1];
    unmount();
    expect(current.disconnect).toHaveBeenCalledOnce();
    current.notify([{ contentRect: { width: 100, height: 100 } }]);
    expect(view.stage.style).toEqual({ width: '600px', height: '600px' });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    '無効な比率 %s は寸法をゼロにして CSS 比率を外す',
    (ratio) => {
      const view = mount({ ratio });
      expect(view.tree.props.className).toBe('aspect-stage');
      expect(view.content.props.style?.aspectRatio).toBeUndefined();
      expect(view.stage.style).toEqual({ width: '0px', height: '0px' });
    },
  );

  it.each(['slot', 'stage'] as const)(
    '%s の ref しか接続されていない場合は計測を開始しない',
    (attach) => {
      const view = mount({}, attach);
      expect(Observer.all).toHaveLength(0);
      expect(view.stage.style).toEqual({ width: '', height: '' });
    },
  );
});

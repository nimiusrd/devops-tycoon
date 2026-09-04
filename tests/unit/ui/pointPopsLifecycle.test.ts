import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  cursor: 0,
  dirty: false,
  slots: [] as { value?: unknown; dependencies?: readonly unknown[]; cleanup?: () => void }[],
  effects: [] as (() => void)[],
  playSfx: vi.fn(),
}));

// Node 環境で React の state/ref/effect と音・アニメーション境界のみを代行する。
// effect の依存比較・更新前 cleanup を保ち、PointPops 自体は置き換えない。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    hooks.slots[index] ??= { value: { current: initial } };
    return hooks.slots[index].value;
  },
  useState(initial: unknown) {
    const index = hooks.cursor++;
    hooks.slots[index] ??= { value: initial };
    const slot = hooks.slots[index];
    return [
      slot.value,
      (update: unknown) => {
        const next =
          typeof update === 'function'
            ? (update as (value: unknown) => unknown)(slot.value)
            : update;
        if (!Object.is(next, slot.value)) {
          slot.value = next;
          hooks.dirty = true;
        }
      },
    ];
  },
  useEffect(effect: () => void | (() => void), dependencies: readonly unknown[]) {
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
      slot.cleanup = effect() ?? undefined;
    });
  },
}));
vi.mock('framer-motion', () => ({ AnimatePresence: 'div', motion: { span: 'span' } }));
vi.mock('../../../src/audio/useAudio', () => ({ useAudio: () => ({ playSfx: hooks.playSfx }) }));

import { PointPops, type PointPopsProps } from '../../../src/ui/PointPops';

type Props = Record<string, unknown> & { children?: ReactNode };
function elements(node: ReactNode): ReactElement<Props>[] {
  if (!isValidElement<Props>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}
function content(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return isValidElement<Props>(node)
    ? Children.toArray(node.props.children).map(content).join('')
    : '';
}
function unmount() {
  for (const slot of hooks.slots) slot.cleanup?.();
  hooks.slots = [];
  hooks.effects = [];
  hooks.cursor = 0;
  hooks.dirty = false;
}
function mountPops(initial: PointPopsProps) {
  let props = initial;
  let tree: ReactNode;
  const render = () => {
    let count = 0;
    do {
      if (++count > 10) throw new Error('PointPops の更新が収束しませんでした');
      hooks.cursor = 0;
      hooks.dirty = false;
      tree = PointPops(props);
      for (const effect of hooks.effects.splice(0)) effect();
    } while (hooks.dirty);
  };
  render();
  return {
    all: () => elements(tree).filter((node) => node.type === 'span'),
    root: () => elements(tree)[0],
    update(next: Partial<PointPopsProps>) {
      props = { ...props, ...next };
      render();
    },
    advance(ms: number) {
      vi.advanceTimersByTime(ms);
      render();
    },
  };
}

beforeEach(() => {
  hooks.playSfx = vi.fn();
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});
afterEach(() => {
  unmount();
  hooks.playSfx.mockClear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('PointPops の増分とライフサイクル', () => {
  it('初期値・同値・減少では発火せず、減少後は新しい値からの増分だけを表示する', () => {
    const screen = mountPops({ deliveryScore: 20 });
    expect(screen.root().props['aria-hidden']).toBe('true');
    screen.update({ deliveryScore: 20 });
    screen.update({ deliveryScore: 10 });
    expect(screen.all()).toHaveLength(0);
    expect(hooks.playSfx).not.toHaveBeenCalled();
    screen.update({ deliveryScore: 13 });
    expect(screen.all().map(content)).toEqual(['+3']);
    expect(hooks.playSfx).toHaveBeenCalledExactlyOnceWith('ship');
    screen.update({ deliveryScore: 13 });
    expect(hooks.playSfx).toHaveBeenCalledTimes(1);
  });

  it.each([11, 12])('増分 %i は高価値の境界を守り、1100 ms で消える', (amount) => {
    const screen = mountPops({ deliveryScore: 4, teamId: 'team-a' });
    screen.update({ deliveryScore: 4 + amount });
    expect(screen.all().map(content)).toEqual([`+${amount}`]);
    expect(screen.all()[0].props).toMatchObject({
      className: amount >= 12 ? 'point-pop big' : 'point-pop',
      style: { left: '50%' },
      animate: { y: -42, opacity: 1, scale: 1 },
      exit: { y: -70, opacity: 0 },
    });
    screen.advance(1099);
    expect(screen.all()).toHaveLength(1);
    screen.advance(1);
    expect(screen.all()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(hooks.playSfx).toHaveBeenCalledExactlyOnceWith('ship');
  });

  it('チームを切り替えた時の得点差は無視し、切替後の出荷だけに反応する', () => {
    const screen = mountPops({ deliveryScore: 10, teamId: 'team-a' });
    screen.update({ deliveryScore: 100, teamId: 'team-b' });
    expect(screen.all()).toHaveLength(0);
    expect(hooks.playSfx).not.toHaveBeenCalled();
    screen.update({ deliveryScore: 112 });
    expect(screen.all().map(content)).toEqual(['+12']);
    screen.advance(1100);
    screen.update({ deliveryScore: 10, teamId: 'team-a' });
    expect(screen.all()).toHaveLength(0);
    screen.update({ deliveryScore: 15 });
    expect(screen.all().map(content)).toEqual(['+5']);
    expect(hooks.playSfx.mock.calls).toEqual([['ship'], ['ship']]);
  });

  it('短時間の連続出荷は最新 6 件に制限し、それぞれを一意なキーで描く', () => {
    const screen = mountPops({ deliveryScore: 0 });
    let score = 0;
    for (let amount = 1; amount <= 8; amount++) {
      score += amount;
      screen.update({ deliveryScore: score });
    }
    expect(screen.all().map(content)).toEqual(['+3', '+4', '+5', '+6', '+7', '+8']);
    expect(new Set(screen.all().map((node) => node.key)).size).toBe(6);
    expect(hooks.playSfx).toHaveBeenCalledTimes(8);
  });

  it('アンマウント時に残っているタイマーを解除する', () => {
    const screen = mountPops({ deliveryScore: 0 });
    screen.update({ deliveryScore: 5 });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1100);
    expect(hooks.dirty).toBe(false);
    expect(hooks.playSfx).toHaveBeenCalledTimes(1);
  });

  it('連続出荷でも各ポップは自身の発生から 1100 ms で消え、最後に何も残らない', () => {
    const screen = mountPops({ deliveryScore: 0, teamId: 'team-a' });
    screen.update({ deliveryScore: 5 });
    screen.advance(400);
    screen.update({ deliveryScore: 12 });
    screen.advance(300);
    screen.update({ deliveryScore: 21 });
    screen.advance(399);
    expect(screen.all().map(content)).toEqual(['+5', '+7', '+9']);
    screen.advance(1);
    expect(screen.all().map(content)).toEqual(['+7', '+9']);
    screen.advance(399);
    expect(screen.all().map(content)).toEqual(['+7', '+9']);
    screen.advance(1);
    expect(screen.all().map(content)).toEqual(['+9']);
    screen.advance(299);
    expect(screen.all().map(content)).toEqual(['+9']);
    screen.advance(1);
    expect(screen.all()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(hooks.playSfx).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['同じ得点への更新', { deliveryScore: 5 }],
    ['得点の減少', { deliveryScore: 0 }],
    ['チームの切替', { teamId: 'team-b', deliveryScore: 100 }],
    ['音声コールバックの更新', {}],
  ] satisfies [string, Partial<PointPopsProps>][])(
    '%s でも表示中ポップの期限は変わらず、余計な出荷音を鳴らさない',
    (change, next) => {
      const screen = mountPops({ deliveryScore: 0, teamId: 'team-a' });
      const originalSound = hooks.playSfx;
      screen.update({ deliveryScore: 5 });
      screen.advance(500);
      if (change === '音声コールバックの更新') hooks.playSfx = vi.fn();
      screen.update(next);
      expect(screen.all().map(content)).toEqual(['+5']);
      screen.advance(599);
      expect(screen.all().map(content)).toEqual(['+5']);
      screen.advance(1);
      expect(screen.all()).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(originalSound).toHaveBeenCalledExactlyOnceWith('ship');
      if (hooks.playSfx !== originalSound) expect(hooks.playSfx).not.toHaveBeenCalled();
    },
  );

  it('上限を超える連続出荷後も、表示される最新 6 件はすべて期限で消える', () => {
    const screen = mountPops({ deliveryScore: 0 });
    let score = 0;
    for (let amount = 1; amount <= 8; amount++) {
      score += amount;
      screen.update({ deliveryScore: score });
      screen.advance(10);
    }
    expect(screen.all().map(content)).toEqual(['+3', '+4', '+5', '+6', '+7', '+8']);
    screen.advance(1100);
    expect(screen.all()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('複数ポップの削除予約をアンマウント時にすべて解除する', () => {
    const screen = mountPops({ deliveryScore: 0 });
    screen.update({ deliveryScore: 5 });
    screen.advance(400);
    screen.update({ deliveryScore: 12 });
    screen.advance(300);
    screen.update({ deliveryScore: 21 });
    expect(vi.getTimerCount()).toBe(3);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1100);
    expect(hooks.dirty).toBe(false);
    expect(hooks.playSfx).toHaveBeenCalledTimes(3);
  });
});

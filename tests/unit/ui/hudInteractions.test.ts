import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  cursor: 0,
  dirty: false,
  slots: [] as {
    value?: unknown;
    dependencies?: readonly unknown[];
    cleanup?: () => void;
  }[],
  effects: [] as (() => void)[],
  responsive: { width: 'wide', height: 'normal' },
  sameDependencies(previous: readonly unknown[] | undefined, next: readonly unknown[]) {
    return (
      previous?.length === next.length && next.every((value, i) => Object.is(value, previous[i]))
    );
  },
}));

// Node の hook harness。表示値の導出・差分計算・子コンポーネントは実物を使い、
// state/ref/effect の再描画とブラウザ依存の provider・motion の境界だけを代行する。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    hooks.slots[index] ??= {
      value: typeof initial === 'function' ? (initial as () => unknown)() : initial,
    };
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
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    hooks.slots[index] ??= { value: { current: initial } };
    return hooks.slots[index].value;
  },
  useMemo(factory: () => unknown, dependencies: readonly unknown[]) {
    const index = hooks.cursor++;
    if (!hooks.sameDependencies(hooks.slots[index]?.dependencies, dependencies)) {
      hooks.slots[index] = { value: factory(), dependencies };
    }
    return hooks.slots[index].value;
  },
  useEffect(effect: () => void | (() => void), dependencies: readonly unknown[]) {
    const index = hooks.cursor++;
    const previous = hooks.slots[index];
    if (hooks.sameDependencies(previous?.dependencies, dependencies)) return;
    const slot = { dependencies, cleanup: undefined as (() => void) | undefined };
    hooks.slots[index] = slot;
    hooks.effects.push(() => {
      previous?.cleanup?.();
      slot.cleanup = effect() ?? undefined;
    });
  },
}));
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: { span: 'span' },
}));
vi.mock('../../../src/ui/responsiveMode', () => ({ useResponsiveMode: () => hooks.responsive }));

import { createOrgState } from '../../../src/sim/org';
import { RunEngine } from '../../../src/sim/run/engine';
import { Hud, type HudProps } from '../../../src/ui/Hud';

type ElementProps = Record<string, unknown> & { children?: ReactNode };

function elements(node: ReactNode): ReactElement<ElementProps>[] {
  if (!isValidElement<ElementProps>(node)) return [];
  if (typeof node.type === 'function') {
    return elements((node.type as (props: ElementProps) => ReactNode)(node.props));
  }
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}

function content(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!isValidElement<ElementProps>(node)) return '';
  if (typeof node.type === 'function') {
    return content((node.type as (props: ElementProps) => ReactNode)(node.props));
  }
  return Children.toArray(node.props.children).map(content).join('');
}

function unmount() {
  for (const slot of hooks.slots) {
    slot.cleanup?.();
    slot.cleanup = undefined;
  }
}

function mountHud(overrides: Partial<HudProps> = {}) {
  let props: HudProps = {
    org: createOrgState('default', true),
    tasks: [],
    snapshotScope: 'team',
    ...overrides,
  };
  let tree: ReactNode;
  const flush = () => {
    let renders = 0;
    do {
      if (++renders > 20) throw new Error('Hud の更新が収束しませんでした');
      hooks.cursor = 0;
      hooks.dirty = false;
      tree = Hud(props);
      for (const effect of hooks.effects.splice(0)) effect();
    } while (hooks.dirty);
  };
  const find = (id: string) => {
    const node = elements(tree).find((element) => element.props['data-testid'] === id);
    if (!node) throw new Error(`要素がありません: ${id}`);
    return node;
  };
  flush();
  return {
    get props() {
      return props;
    },
    find,
    has: (id: string) => elements(tree).some((element) => element.props['data-testid'] === id),
    feedback(id: string) {
      return elements(find(id))
        .filter((element) => String(element.props.className).includes('hud-feedback-pop'))
        .map(content);
    },
    update(next: Partial<HudProps>) {
      props = { ...props, ...next };
      flush();
    },
    changeOrg(next: Partial<HudProps['org']>) {
      props = { ...props, org: { ...props.org, ...next } };
      flush();
    },
    clickToggle() {
      (find('hud-toggle').props.onClick as () => void)();
      flush();
    },
    advance(ms: number) {
      vi.advanceTimersByTime(ms);
      flush();
    },
    unmount,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  hooks.responsive = { width: 'wide', height: 'normal' };
});

afterEach(() => {
  unmount();
  hooks.slots = [];
  hooks.effects = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Hud の表示と展開操作', () => {
  it('広幅では各指標の値・方向・警告を表示し、炎上リスクは独立した状態にする', () => {
    const org = {
      ...createOrgState('default', true),
      deliveryScore: 12,
      seniorHp: 10,
      morale: 20,
      securityLevel: 10,
    };
    const screen = mountHud({ org, reviewQueuePeak: 100 });
    expect(screen.find('hud').props['data-compact']).toBe('false');
    expect(screen.has('hud-toggle')).toBe(false);
    expect(content(screen.find('stat-delivery'))).toBe('12pt');
    expect(screen.find('hud-delivery').props['aria-label']).toContain(
      '出荷ポイント: 12pt。高いほど良い',
    );
    expect(content(screen.find('hud-devSpeed'))).toContain('AI支援で高速');
    expect(content(screen.find('hud-fire-risk-value'))).toBe('HIGH');
    expect(screen.find('hud-fire-risk-value').props.className).toContain('fire-risk-HIGH');
    expect(screen.find('hud-seniorHp').props['data-tone']).toBe('danger');
    expect(content(screen.find('senior-burnout-warning'))).toContain('燃え尽き');
    expect(content(screen.find('review-freeze-warning'))).toBe('PR凍結危険');
    expect(screen.has('security-warning')).toBe(true);
    expect(screen.has('morale-warning')).toBe(true);
    expect(
      elements(screen.find('hud-seniorHp')).find((node) => node.type === 'i')?.props.style,
    ).toEqual({ width: '10%' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('狭幅の内部展開状態を切り替え、危険な指標を要約にも残す', () => {
    hooks.responsive = { width: 'narrow', height: 'short' };
    const onExpandedChange = vi.fn();
    const screen = mountHud({
      org: { ...createOrgState('default', true), seniorHp: 10 },
      reviewQueuePeak: 100,
      onExpandedChange,
    });
    expect(screen.find('hud').props).toMatchObject({
      'data-compact': 'true',
      'data-responsive-width': 'narrow',
      'data-responsive-height': 'short',
    });
    expect(screen.find('hud-toggle').props).toMatchObject({
      'aria-expanded': false,
      'aria-controls': 'hud-metrics',
    });
    expect(content(screen.find('hud-toggle'))).toBe('KPI詳細');
    expect(screen.has('senior-burnout-warning')).toBe(true);
    expect(screen.has('review-freeze-warning')).toBe(true);
    expect(screen.has('hud-compact-delivery')).toBe(true);
    screen.clickToggle();
    expect(onExpandedChange).toHaveBeenLastCalledWith(true);
    expect(screen.find('hud').props['data-compact']).toBe('false');
    expect(content(screen.find('hud-toggle'))).toBe('KPIを畳む');
    expect(screen.has('stat-delivery')).toBe(true);
    screen.clickToggle();
    expect(onExpandedChange).toHaveBeenLastCalledWith(false);
    expect(screen.find('hud').props['data-compact']).toBe('true');
  });

  it('広幅の要約指定でも展開は親の値に従い、操作は次の値を通知する', () => {
    const onExpandedChange = vi.fn();
    const screen = mountHud({ preferCompact: true, expanded: false, onExpandedChange });
    screen.clickToggle();
    expect(onExpandedChange).toHaveBeenLastCalledWith(true);
    expect(screen.find('hud').props['data-compact']).toBe('true');
    screen.update({ expanded: true });
    expect(screen.find('hud').props['data-compact']).toBe('false');
    screen.clickToggle();
    expect(onExpandedChange).toHaveBeenLastCalledWith(false);
    expect(screen.find('hud').props['data-compact']).toBe('false');
  });
});

describe('Hud のスナップショットと差分フィードバック', () => {
  it('初期比較元がなければ通常表示し、同値の再描画で差分を追加しない', () => {
    const getInitialPreviousSnapshot = vi.fn(() => null);
    const onSnapshotCaptured = vi.fn();
    const screen = mountHud({ getInitialPreviousSnapshot, onSnapshotCaptured });
    expect(getInitialPreviousSnapshot).toHaveBeenCalledExactlyOnceWith('team');
    expect(onSnapshotCaptured).toHaveBeenLastCalledWith(
      expect.objectContaining({ deliveryScore: 0 }),
      'team',
    );
    screen.changeOrg({ ...screen.props.org });
    expect(getInitialPreviousSnapshot).toHaveBeenCalledTimes(1);
    expect(screen.feedback('hud-delivery')).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('再マウント時の比較元との差分を要約にも表示し、1000msで消す', () => {
    const getInitialPreviousSnapshot = vi.fn(() => ({
      deliveryScore: 0,
      seniorHpPct: 100,
      aiDependencyPct: 0,
      techDebt: 0,
      morale: 100,
      securityLevel: 100,
    }));
    const onSnapshotCaptured = vi.fn();
    const screen = mountHud({
      org: { ...createOrgState('default', true), deliveryScore: 4 },
      preferCompact: true,
      getInitialPreviousSnapshot,
      onSnapshotCaptured,
    });
    expect(getInitialPreviousSnapshot).toHaveBeenCalledExactlyOnceWith('team');
    expect(onSnapshotCaptured).toHaveBeenLastCalledWith(
      expect.objectContaining({ deliveryScore: 4 }),
      'team',
    );
    expect(screen.feedback('hud-compact-delivery')).toEqual(['+4']);
    expect(screen.find('hud-compact-delivery').props.className).toContain('flash-positive');
    screen.advance(999);
    expect(screen.feedback('hud-compact-delivery')).toEqual(['+4']);
    screen.advance(1);
    expect(screen.feedback('hud-compact-delivery')).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('古い差分の期限では後から更新された同じ指標と別指標の差分を消さない', () => {
    const screen = mountHud();
    screen.changeOrg({ deliveryScore: 2 });
    expect(screen.feedback('hud-delivery')).toEqual(['+2']);
    screen.advance(500);
    screen.changeOrg({ deliveryScore: 5, techDebt: 3 });
    expect(screen.feedback('hud-delivery')).toEqual(['+3']);
    expect(screen.feedback('hud-techDebt')).toEqual(['+3']);
    expect(screen.find('hud-techDebt').props.className).toContain('flash-negative');
    screen.advance(500);
    expect(screen.feedback('hud-delivery')).toEqual(['+3']);
    expect(screen.feedback('hud-techDebt')).toEqual(['+3']);
    expect(vi.getTimerCount()).toBe(1);
    screen.advance(500);
    expect(screen.feedback('hud-delivery')).toEqual([]);
    expect(screen.feedback('hud-techDebt')).toEqual([]);
  });

  it('現場から全社への切替は比較元と残った演出をリセットし、以降は集約値同士で比較する', () => {
    const engine = new RunEngine({ seed: 'hud-scope', difficulty: 'easy' });
    engine.zoomTo('company');
    const state = engine.snapshot();
    if (!state.orgScale) throw new Error('全社の集約状態がありません');
    const orgScale = { ...state.orgScale, shipping: 100, morale: 60 };
    const getInitialPreviousSnapshot = vi.fn(() => null);
    const onSnapshotCaptured = vi.fn();
    const screen = mountHud({ getInitialPreviousSnapshot, onSnapshotCaptured });
    screen.changeOrg({ deliveryScore: 3 });
    expect(screen.feedback('hud-delivery')).toEqual(['+3']);
    expect(vi.getTimerCount()).toBe(1);
    screen.update({ snapshotScope: 'orgScale', orgScale });
    expect(content(screen.find('stat-delivery'))).toBe('100pt');
    expect(screen.feedback('hud-delivery')).toEqual([]);
    expect(onSnapshotCaptured).toHaveBeenLastCalledWith(
      expect.objectContaining({ deliveryScore: 100, morale: 60 }),
      'orgScale',
    );
    expect(getInitialPreviousSnapshot).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    screen.update({ orgScale: { ...orgScale, shipping: 107 } });
    expect(screen.feedback('hud-delivery')).toEqual(['+7']);
    screen.update({ snapshotScope: 'team', orgScale: null });
    expect(content(screen.find('stat-delivery'))).toBe('3pt');
    expect(screen.feedback('hud-delivery')).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('アンマウントで複数世代の差分タイマーをすべて解除する', () => {
    const onSnapshotCaptured = vi.fn();
    const screen = mountHud({ onSnapshotCaptured });
    screen.changeOrg({ deliveryScore: 2 });
    screen.changeOrg({ techDebt: 4 });
    expect(screen.feedback('hud-delivery')).toEqual(['+2']);
    expect(vi.getTimerCount()).toBe(2);
    onSnapshotCaptured.mockClear();
    screen.unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(onSnapshotCaptured).not.toHaveBeenCalled();
  });
});

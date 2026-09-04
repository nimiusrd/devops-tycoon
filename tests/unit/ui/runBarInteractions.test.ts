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
  sameDependencies(previous: readonly unknown[] | undefined, next: readonly unknown[]) {
    return (
      previous?.length === next.length && next.every((value, i) => Object.is(value, previous[i]))
    );
  },
}));

// Node の hook harness。実 RunBar と表示導出を通し、provider・motion と
// state/ref/effect の再描画だけを代行する。DOM のイベント配信は E2E が担当する。
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
vi.mock('../../../src/ui/replayContent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/ui/replayContent')>();
  return { ...actual, useReplayContent: () => actual.createReplayContentResolver(null) };
});

import { RunEngine } from '../../../src/sim/run/engine';
import type { RunState } from '../../../src/sim/run/types';
import { RunBar, type RunBarProps } from '../../../src/ui/RunBar';

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

function makeState(overrides: Partial<RunState> = {}): RunState {
  const engine = new RunEngine({ seed: 'runbar-interactions', difficulty: 'easy' });
  engine.startRun();
  return {
    ...engine.snapshot(),
    budget: 40,
    stakeholderTrust: { management: 60, customers: 60, team: 60 },
    ...overrides,
  };
}

function unmount() {
  for (const slot of hooks.slots) {
    slot.cleanup?.();
    slot.cleanup = undefined;
  }
}

function mountRunBar(overrides: Partial<RunBarProps> = {}) {
  let props: RunBarProps = { state: makeState(), ...overrides };
  let tree: ReactNode;
  const flush = () => {
    let renders = 0;
    do {
      if (++renders > 20) throw new Error('RunBar の更新が収束しませんでした');
      hooks.cursor = 0;
      hooks.dirty = false;
      tree = RunBar(props);
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
    get state() {
      return props.state;
    },
    find,
    has: (id: string) => elements(tree).some((element) => element.props['data-testid'] === id),
    feedback(id: string) {
      return elements(find(id))
        .filter((element) => String(element.props.className).includes('run-feedback-pop'))
        .map(content);
    },
    update(next: Partial<RunBarProps>) {
      props = { ...props, ...next };
      flush();
    },
    changeState(next: Partial<RunState>) {
      props = { ...props, state: { ...props.state, ...next } };
      flush();
    },
    click(id: string, event?: unknown) {
      const node = find(id);
      expect(node.props.disabled, `${id} が操作可能であること`).not.toBe(true);
      (node.props.onClick as (event?: unknown) => void)(event);
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
});

afterEach(() => {
  unmount();
  hooks.slots = [];
  hooks.effects = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('RunBar の表示と操作', () => {
  it('既定の詳細でseed・難易度・レリック未所持・診断と次の山場を表示する', () => {
    const screen = mountRunBar({
      state: makeState({ phase: 'sprint', sprintIndexInQuarter: 2, sprintsPerQuarter: 3 }),
    });
    expect(screen.find('runbar').props['data-compact']).toBe('false');
    expect(content(screen.find('seed'))).toBe('seed runbar-interactions');
    expect(content(screen.find('difficulty'))).toBe('Easy');
    expect(screen.has('scenario')).toBe(false);
    expect(content(screen.find('relics'))).toBe('レリックなし');
    expect(content(screen.find('sprint-no'))).toBe('スプリント 2/3 ★次が山場');
    expect(screen.find('runbar-diagnosis').props).toMatchObject({
      'data-diagnosis': screen.state.diagnosis,
      'aria-live': 'polite',
    });
    expect(screen.has('open-formation')).toBe(false);
    expect(screen.has('open-org')).toBe(false);
    expect(screen.has('roster-count')).toBe(true);
    expect(screen.has('runbar-details-toggle')).toBe(false);
    expect(screen.has('budget-warning')).toBe(false);
    expect(screen.has('trust-warning')).toBe(false);
    expect(screen.has('goal-carryover')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('要約では重要指標を残し、詳細操作でシナリオ・レリック・進化ポイントを開閉する', () => {
    const screen = mountRunBar({
      compact: true,
      state: makeState({
        scenario: 'copilot',
        relics: ['psych-safety'],
        evolution: { points: 3, unlocked: {} },
      }),
    });
    expect(screen.find('runbar').props['data-compact']).toBe('true');
    expect(screen.has('seed')).toBe(false);
    expect(screen.has('budget')).toBe(true);
    expect(screen.has('stakeholder-trust')).toBe(true);
    expect(screen.find('runbar-details-toggle').props).toMatchObject({
      'aria-expanded': false,
      'aria-controls': 'runbar-details',
    });
    screen.click('runbar-details-toggle');
    expect(screen.find('runbar-details-toggle').props['aria-expanded']).toBe(true);
    expect(content(screen.find('runbar-details-toggle'))).toBe('詳細を閉じる');
    expect(screen.find('runbar-details').props.id).toBe('runbar-details');
    expect(screen.has('seed')).toBe(true);
    expect(content(screen.find('scenario'))).toContain('Copilot');
    expect(content(screen.find('evo-points-bar'))).toBe('⭐3');
    expect(content(screen.find('relics'))).toContain('心理的安全性');
    expect(
      elements(screen.find('relics')).find((node) => node.props.className === 'relic-chip')?.props
        .title,
    ).toContain('失敗を責めず');
    screen.click('runbar-details-toggle');
    expect(screen.find('runbar-details-toggle').props['aria-expanded']).toBe(false);
    expect(screen.has('runbar-details')).toBe(false);
    expect(screen.has('seed')).toBe(false);
    screen.update({ compact: false });
    expect(screen.has('seed')).toBe(true);
  });

  it('編成操作と全社ボタンの発火元を通知し、リプレイ閲覧時は両ボタンを無効にする', () => {
    const onOpenFormation = vi.fn();
    const onOpenOrg = vi.fn();
    const state = makeState();
    const member = state.roster.members[0];
    state.roster.members = [
      { ...member, id: 'leave', onLeave: true },
      { ...member, id: 'tired', onLeave: false, stamina: 10, staminaMax: 100 },
      { ...member, id: 'normal', onLeave: false, stamina: 50, staminaMax: 100 },
      { ...member, id: 'great', onLeave: false, stamina: 100, staminaMax: 100 },
    ];
    const screen = mountRunBar({ state, onOpenFormation, onOpenOrg });
    expect(content(screen.find('roster-faces'))).toBe('😴😩🙂💪');
    expect(screen.find('open-formation').props.title).toContain('稼働 3 / 休職 1');
    screen.click('open-formation');
    const trigger = { focus: vi.fn() } as unknown as HTMLButtonElement;
    screen.click('open-org', { currentTarget: trigger });
    expect(onOpenFormation).toHaveBeenCalledOnce();
    expect(onOpenOrg).toHaveBeenCalledExactlyOnceWith(trigger);
    screen.update({ readOnly: true });
    expect(screen.find('open-formation').props).toMatchObject({
      disabled: true,
      title: 'リプレイ閲覧中は編成を開けません',
    });
    expect(screen.find('open-org').props).toMatchObject({
      disabled: true,
      title: 'リプレイ閲覧中は全社マップを開けません',
    });
    screen.update({ onOpenFormation: undefined });
    expect(content(screen.find('roster-count'))).toBe('👥3 😴1');
  });

  it('予算と信頼の危険予兆、適用試練と当四半期だけの修正持ち越しを表示する', () => {
    const screen = mountRunBar({
      state: makeState({
        budget: 3,
        stakeholderTrust: { management: 10, customers: 20, team: 15 },
        trials: ['half-budget'],
        goalCarryoverId: 'cut_scope',
        goalCarryoverQuarter: 2,
        quarterNumber: 2,
      }),
    });
    expect(screen.find('budget').props['data-tone']).toBe('danger');
    expect(screen.has('budget-warning')).toBe(true);
    expect(screen.find('budget').props.title).toContain('試練「予算半減」で開始予算×0.5');
    expect(content(screen.find('run-trial-half-budget'))).toBe('予算半減');
    expect(screen.find('run-trial-half-budget').props['aria-label']).toBe('試練 予算半減');
    expect(screen.find('stakeholder-trust').props['data-tone']).toBe('danger');
    expect(screen.has('trust-warning')).toBe(true);
    expect(content(screen.find('goal-carryover-warning'))).toBe('スコープ削減');
    screen.changeState({ quarterNumber: 3 });
    expect(screen.has('goal-carryover')).toBe(false);
  });
});

describe('RunBar のスナップショットと差分フィードバック', () => {
  it('初期値を通知し、比較元なしや同値の再描画では演出タイマーを作らない', () => {
    const getInitialPreviousSnapshot = vi.fn(() => null);
    const onSnapshotCaptured = vi.fn();
    const screen = mountRunBar({ getInitialPreviousSnapshot, onSnapshotCaptured });
    expect(getInitialPreviousSnapshot).toHaveBeenCalledOnce();
    expect(onSnapshotCaptured).toHaveBeenLastCalledWith({
      budget: 40,
      trustManagement: 60,
      trustCustomers: 60,
      trustTeam: 60,
    });
    screen.changeState({ seed: 'unchanged-metrics' });
    expect(getInitialPreviousSnapshot).toHaveBeenCalledOnce();
    expect(screen.feedback('budget')).toEqual([]);
    expect(screen.feedback('stakeholder-trust')).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('再マウント前からの予算・信頼の改善を表示し、1600msの期限でまとめて消す', () => {
    const getInitialPreviousSnapshot = vi.fn(() => ({
      budget: 35,
      trustManagement: 58,
      trustCustomers: 57,
      trustTeam: 56,
    }));
    const screen = mountRunBar({ getInitialPreviousSnapshot });
    expect(getInitialPreviousSnapshot).toHaveBeenCalledOnce();
    expect(screen.feedback('budget')).toEqual(['予算+5']);
    expect(screen.feedback('stakeholder-trust')).toEqual(['経営+2 / 顧客+3 / チーム+4']);
    expect(screen.find('budget').props.className).toContain('flash-positive');
    expect(screen.find('stakeholder-trust').props.className).toContain('flash-positive');
    screen.advance(1599);
    expect(screen.feedback('budget')).toEqual(['予算+5']);
    screen.advance(1);
    expect(screen.feedback('budget')).toEqual([]);
    expect(screen.feedback('stakeholder-trust')).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('信頼の改善と悪化が混ざる場合は悪化の色を優先し、更新されない指標の演出を維持する', () => {
    const screen = mountRunBar();
    screen.changeState({ stakeholderTrust: { management: 62, customers: 57, team: 64 } });
    expect(screen.feedback('stakeholder-trust')).toEqual(['経営+2 / 顧客-3 / チーム+4']);
    expect(screen.find('stakeholder-trust').props.className).toContain('flash-negative');
    expect(
      elements(screen.find('stakeholder-trust')).find((node) =>
        String(node.props.className).includes('run-feedback-pop'),
      )?.props.className,
    ).toContain('feedback-negative');
    screen.changeState({ budget: 38 });
    expect(screen.feedback('budget')).toEqual(['予算-2']);
    expect(screen.find('budget').props.className).toContain('flash-negative');
    expect(screen.feedback('stakeholder-trust')).toEqual(['経営+2 / 顧客-3 / チーム+4']);
  });

  it('古い差分が期限切れになっても同じ指標の新しい差分は固有の期限まで残す', () => {
    const screen = mountRunBar();
    screen.changeState({
      budget: 45,
      stakeholderTrust: { management: 62, customers: 60, team: 60 },
    });
    screen.advance(800);
    screen.changeState({
      budget: 43,
      stakeholderTrust: { management: 62, customers: 57, team: 60 },
    });
    expect(screen.feedback('budget')).toEqual(['予算-2']);
    expect(screen.feedback('stakeholder-trust')).toEqual(['経営+2 / 顧客-3']);
    screen.advance(800);
    expect(screen.feedback('budget')).toEqual(['予算-2']);
    expect(screen.feedback('stakeholder-trust')).toEqual(['顧客-3']);
    expect(vi.getTimerCount()).toBe(1);
    screen.advance(800);
    expect(screen.feedback('budget')).toEqual([]);
    expect(screen.feedback('stakeholder-trust')).toEqual([]);
  });

  it('アンマウントで残ったすべての差分タイマーを解除する', () => {
    const onSnapshotCaptured = vi.fn();
    const screen = mountRunBar({ onSnapshotCaptured });
    screen.changeState({ budget: 45 });
    screen.changeState({ stakeholderTrust: { management: 65, customers: 60, team: 60 } });
    expect(vi.getTimerCount()).toBe(2);
    onSnapshotCaptured.mockClear();
    screen.unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1600);
    expect(onSnapshotCaptured).not.toHaveBeenCalled();
  });
});

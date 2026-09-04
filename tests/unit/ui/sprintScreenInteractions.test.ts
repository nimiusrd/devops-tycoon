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

// Node では state/ref/effect の再描画だけを代行し、親が公開する callback と JSX を検証する。
// 子の描画・ブラウザ操作はそれぞれのユニットテストと E2E に任せる。
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
  useCallback(callback: unknown, dependencies: readonly unknown[]) {
    const index = hooks.cursor++;
    if (!hooks.sameDependencies(hooks.slots[index]?.dependencies, dependencies)) {
      hooks.slots[index] = { value: callback, dependencies };
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
vi.mock('../../../src/render/Board', () => ({ Board: () => null }));
vi.mock('../../../src/ui/ActionBar', () => ({ ActionBar: () => null }));
vi.mock('../../../src/ui/ComboBadge', () => ({ ComboBadge: () => null }));
vi.mock('../../../src/ui/DeckBar', () => ({ DeckBar: () => null }));
vi.mock('../../../src/ui/EventTicker', () => ({ EventTicker: () => null }));
vi.mock('../../../src/ui/PointPops', () => ({ PointPops: () => null }));
vi.mock('../../../src/ui/AspectStage', () => ({ AspectStage: () => null }));
vi.mock('../../../src/ui/SprintLayout', () => ({ SprintLayout: () => null }));
vi.mock('../../../src/ui/JuicyEffects', () => ({
  AttentionOverlay: () => null,
  SlowMotionOverlay: () => null,
}));
vi.mock('../../../src/ui/TutorialGuide', () => ({ TutorialGuide: () => null }));

import { getBoss } from '../../../src/data/bosses';
import type { GameHandle } from '../../../src/game';
import { ATTENTION_PAUSE_MS } from '../../../src/render/attentionPause';
import { Board } from '../../../src/render/Board';
import { BURN_TICKS } from '../../../src/sim/model';
import { RunEngine } from '../../../src/sim/run/engine';
import type { RunState } from '../../../src/sim/run/types';
import type {
  ActionId,
  InterventionEffect,
  InterventionOutcome,
  Task,
} from '../../../src/sim/types';
import { ActionBar } from '../../../src/ui/ActionBar';
import { ComboBadge } from '../../../src/ui/ComboBadge';
import { DeckBar } from '../../../src/ui/DeckBar';
import { EventTicker } from '../../../src/ui/EventTicker';
import { AttentionOverlay, SlowMotionOverlay } from '../../../src/ui/JuicyEffects';
import { PointPops } from '../../../src/ui/PointPops';
import { SprintLayout } from '../../../src/ui/SprintLayout';
import { SprintScreen, type SprintScreenProps } from '../../../src/ui/SprintScreen';
import { TutorialGuide } from '../../../src/ui/TutorialGuide';
import { burningTask, makeSprint, makeTask } from '../helpers/sprintFixtures';

type ElementProps = Record<string, unknown> & { children?: ReactNode };

function elements(node: ReactNode): ReactElement<ElementProps>[] {
  if (!isValidElement<ElementProps>(node)) return [];
  const children =
    node.type === SprintLayout
      ? ['header', 'status', 'stage', 'deck', 'controls', 'overlays'].map(
          (slot) => node.props[slot] as ReactNode,
        )
      : Children.toArray(node.props.children);
  return [node, ...children.flatMap(elements)];
}

function content(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!isValidElement<ElementProps>(node)) return '';
  return Children.toArray(node.props.children).map(content).join('');
}

function makeState(tasks: Task[] = [], overrides: Partial<RunState> = {}): RunState {
  const engine = new RunEngine({ seed: 'sprint-screen-interactions', difficulty: 'easy' });
  engine.startRun();
  const state = engine.snapshot();
  return {
    ...state,
    phase: 'sprint',
    currentSprintId: 'q1-s1',
    currentSprintKind: 'normal',
    bossId: 'big-release',
    sprint: makeSprint(state.org, tasks),
    sprintTick: 4,
    zoom: { ...state.zoom, level: 'team' },
    ...overrides,
  };
}

function success(actionId: ActionId, extra: Partial<InterventionEffect> = {}): InterventionOutcome {
  return { ok: true, effect: { actionId, focusCost: 1, gaugeGain: 0.2, ...extra } };
}

function unmount() {
  for (const slot of hooks.slots) {
    slot.cleanup?.();
    slot.cleanup = undefined;
  }
}

function mountSprint(overrides: Partial<SprintScreenProps> = {}) {
  let props: SprintScreenProps = {
    state: makeState(),
    header: 'テスト用ヘッダー',
    onDispatch: vi.fn(() => success('assignTask')),
    onPlayCard: vi.fn(() => ({ ok: true, deckIndex: 2, focusCost: 1 })),
    getSprintSnapshot: vi.fn(() => null),
    pauseBriefly: vi.fn(() => vi.fn()),
    playbackSpeed: 1,
    setPlaybackSpeed: vi.fn(),
    ...overrides,
  };
  let tree: ReactNode;
  const flush = () => {
    let renders = 0;
    do {
      if (++renders > 25) throw new Error('SprintScreen の更新が収束しませんでした');
      hooks.cursor = 0;
      hooks.dirty = false;
      tree = SprintScreen(props);
      for (const effect of hooks.effects.splice(0)) effect();
    } while (hooks.dirty);
  };
  const find = (id: string) => {
    const node = elements(tree).find((item) => item.props['data-testid'] === id);
    if (!node) throw new Error(`要素がありません: ${id}`);
    return node;
  };
  const child = <P>(component: (props: P) => ReactNode): P => {
    const node = elements(tree).find((item) => item.type === component);
    if (!node) throw new Error(`子コンポーネントがありません: ${component.name}`);
    return node.props as P;
  };
  flush();
  return {
    get tree() {
      return tree;
    },
    get props() {
      return props;
    },
    get sprint() {
      if (!props.state.sprint) throw new Error('スプリントがありません');
      return props.state.sprint;
    },
    find,
    child,
    has(component: unknown) {
      return elements(tree).some((item) => item.type === component);
    },
    flush,
    update(next: Partial<SprintScreenProps>) {
      props = { ...props, ...next };
      flush();
    },
    updateSprint(next: Partial<NonNullable<RunState['sprint']>>) {
      if (!props.state.sprint) throw new Error('スプリントがありません');
      props = { ...props, state: { ...props.state, sprint: { ...props.state.sprint, ...next } } };
      flush();
    },
    click(id: string) {
      const node = find(id);
      expect(node.props.disabled, `${id} が操作可能であること`).not.toBe(true);
      (node.props.onClick as () => void)();
      flush();
    },
    key(key: string) {
      window.dispatchEvent(Object.assign(new Event('keydown'), { key }));
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
  vi.spyOn(performance, 'now').mockReturnValue(3_000);
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
});

afterEach(() => {
  unmount();
  hooks.slots = [];
  hooks.effects = [];
  hooks.cursor = 0;
  hooks.dirty = false;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SprintScreen の表示と親子の連携', () => {
  it('スプリントがない間は描画せず、再開時の既存障害では自動ポーズを発生させない', () => {
    const screen = mountSprint({ state: makeState([], { sprint: null }) });
    expect(screen.tree).toBeNull();
    screen.update({ state: makeState([burningTask(1)]) });
    expect(screen.has(Board)).toBe(true);
    expect(screen.props.pauseBriefly).not.toHaveBeenCalled();
    screen.update({ state: { ...screen.props.state, sprint: null } });
    expect(screen.tree).toBeNull();
    screen.update({ state: makeState([burningTask(2)]) });
    expect(screen.props.pauseBriefly).not.toHaveBeenCalled();
  });

  it.each([
    ['normal', 'big-release', '💻 通常スプリント'],
    ['elite', 'big-release', '🔥 高負荷スプリント'],
    ['boss', 'big-release', '★ ボス: 大型リリース'],
    ['boss', 'unknown-boss', '★ ボス: '],
  ] as const)('%s / %s の種別と対応するボス条件を表示する', (kind, bossId, label) => {
    const screen = mountSprint({ state: makeState([], { currentSprintKind: kind, bossId }) });
    const status = screen.find('sprint-subbar');
    expect(content(status)).toContain(label);
    const goal = elements(status).find((node) => node.props.className === 'pill boss-goal');
    if (kind === 'boss' && bossId === 'big-release') {
      expect(content(goal)).toBe(getBoss(bossId)?.description);
    } else {
      expect(goal).toBeUndefined();
    }
    expect(screen.child(SprintLayout).header).toBe('テスト用ヘッダー');
    expect(screen.find('speed-1x').props['aria-pressed']).toBe(true);
    expect(screen.find('speed-pause').props['aria-label']).toBe('一時停止');
  });

  it('渋滞を100%で止め、最も切迫した炎上タイマーと実タスク数を表示する', () => {
    const tasks = [
      ...Array.from({ length: 20 }, (_, id) => makeTask(id)),
      makeTask(20, { lane: 'rework', incident: true, burnTicksLeft: BURN_TICKS / 2 }),
      burningTask(21),
      makeTask(22, { lane: 'rework', incident: true }),
      makeTask(23, { lane: 'done', incident: true }),
    ];
    const screen = mountSprint({ state: makeState(tasks) });
    const jam = elements(screen.find('jam-meter'));
    expect(jam.some((node) => node.props.className === 'meter jam')).toBe(true);
    expect(jam.find((node) => node.type === 'i')?.props.style).toEqual({ width: '100%' });
    expect(content(screen.find('fire-count'))).toBe('🔥3');
    expect(screen.find('fire-meter').props.className).toContain('burning');
    expect(
      elements(screen.find('fire-meter')).find((node) => node.type === 'i')?.props.style,
    ).toEqual({ width: '50%' });
    screen.updateSprint({
      tasks: [makeTask(1, { lane: 'rework', incident: true, burnTicksLeft: -1 })],
    });
    expect(
      elements(screen.find('fire-meter')).find((node) => node.type === 'i')?.props.style,
    ).toEqual({ width: '0%' });
    screen.updateSprint({ tasks: [] });
    expect(content(screen.find('fire-count'))).toBe('🔥0');
    expect(screen.find('fire-meter').props.className).not.toContain('burning');
  });

  it('盤面・手札・演出へ最新の状態を渡し、完了と進化オーバーレイを反映する', () => {
    const state = makeState([makeTask(1)]);
    const screen = mountSprint({ state });
    screen.updateSprint({
      metrics: { ...screen.sprint.metrics, combo: 3 },
      modifiers: { ...screen.sprint.modifiers, stabilityUntilTick: 5 },
      cardPiles: { ...screen.sprint.cardPiles, hand: [2] },
      focus: 7,
    });
    expect(screen.child(Board)).toMatchObject({
      tasks: screen.sprint.tasks,
      metrics: screen.sprint.metrics,
      reviewAccumulator: screen.sprint.reviewAccumulator,
      modifiers: screen.sprint.modifiers,
      roster: state.roster,
      sprint: screen.sprint,
      sprintTick: 4,
      animationsPaused: false,
    });
    expect(screen.child(DeckBar)).toMatchObject({
      deck: state.deck,
      hand: [2],
      focus: 7,
      playable: true,
      paused: false,
    });
    expect(screen.child(ComboBadge)).toMatchObject({ combo: 3, stabilized: true });
    expect(screen.child(EventTicker)).toMatchObject({
      events: screen.sprint.events,
      liveCombo: 3,
      frozen: false,
    });
    expect(screen.child(PointPops)).toMatchObject({
      deliveryScore: state.org.deliveryScore,
      teamId: state.activeTeamId,
    });
    screen.update({ state: { ...screen.props.state, phase: 'evolution', sprintTick: 5 } });
    expect(screen.child(Board).animationsPaused).toBe(true);
    expect(screen.child(EventTicker).frozen).toBe(true);
    expect(screen.child(ComboBadge).stabilized).toBe(false);
    screen.updateSprint({ complete: true });
    expect(screen.child(Board).modifiers).toBeUndefined();
    expect(screen.child(DeckBar).playable).toBe(false);
    expect(screen.child(ActionBar).disabled).toBe(true);
    expect(screen.child(ComboBadge).combo).toBe(0);
    for (const id of ['speed-pause', 'speed-1x', 'speed-2x']) {
      expect(screen.find(id).props.disabled).toBe(true);
    }
  });

  it('チュートリアルは表示指定・ゲーム・閉じるcallbackが揃ったときだけ表示する', () => {
    const game = {} as GameHandle;
    const onTutorialDismiss = vi.fn();
    const screen = mountSprint({ game, onTutorialDismiss });
    expect(screen.has(TutorialGuide)).toBe(false);
    screen.update({ showTutorial: true, game: undefined });
    expect(screen.has(TutorialGuide)).toBe(false);
    screen.update({ game, onTutorialDismiss: undefined });
    expect(screen.has(TutorialGuide)).toBe(false);
    screen.update({ onTutorialDismiss });
    expect(screen.child(TutorialGuide)).toMatchObject({ game, onDismiss: onTutorialDismiss });
    screen.child(TutorialGuide).onDismiss();
    expect(onTutorialDismiss).toHaveBeenCalledOnce();
  });
});

describe('SprintScreen の速度・介入操作', () => {
  it('一時停止で武装と担当を解除し、再開時は直前の2xに戻る', () => {
    const screen = mountSprint();
    screen.click('speed-2x');
    expect(screen.props.setPlaybackSpeed).toHaveBeenLastCalledWith(2);
    screen.update({ playbackSpeed: 2 });
    screen.child(ActionBar).onArm('assignTask');
    screen.child(ActionBar).onAssignAssigneeChange?.('ai');
    screen.flush();
    expect(screen.child(Board)).toMatchObject({ armedAction: 'assignTask', assignAssignee: 'ai' });
    screen.click('speed-pause');
    expect(screen.props.setPlaybackSpeed).toHaveBeenLastCalledWith(0);
    expect(screen.child(Board).armedAction).toBeNull();
    expect(screen.child(ActionBar).assignAssignee).toBeUndefined();
    screen.update({ playbackSpeed: 0 });
    expect(screen.find('speed-controls').props['data-paused']).toBe('true');
    expect(screen.child(ActionBar).paused).toBe(true);
    expect(screen.child(DeckBar).paused).toBe(true);
    screen.click('speed-pause');
    expect(screen.props.setPlaybackSpeed).toHaveBeenLastCalledWith(2);
    screen.click('speed-1x');
    expect(screen.props.setPlaybackSpeed).toHaveBeenLastCalledWith(1);
  });

  it('Escapeは現場の武装だけを解除し、別スプリントや完了済みの武装を盤面に渡さない', () => {
    const screen = mountSprint();
    screen.child(ActionBar).onArm('assignTask');
    screen.child(ActionBar).onAssignAssigneeChange?.('senior');
    screen.flush();
    screen.key('Enter');
    expect(screen.child(Board).armedAction).toBe('assignTask');
    screen.update({
      state: { ...screen.props.state, zoom: { ...screen.props.state.zoom, level: 'company' } },
    });
    screen.key('Escape');
    expect(screen.child(Board).armedAction).toBe('assignTask');
    screen.update({
      state: { ...screen.props.state, zoom: { ...screen.props.state.zoom, level: 'team' } },
    });
    screen.key('Escape');
    expect(screen.child(Board).armedAction).toBeNull();
    expect(screen.child(ActionBar).assignAssignee).toBeUndefined();
    screen.child(ActionBar).onArm('assignTask');
    screen.child(ActionBar).onAssignAssigneeChange?.('ai');
    screen.flush();
    screen.child(ActionBar).onArm('splitPr');
    screen.flush();
    expect(screen.child(Board)).toMatchObject({
      armedAction: 'splitPr',
      assignAssignee: undefined,
    });
    screen.update({ state: { ...screen.props.state, currentSprintId: 'q1-s2' } });
    expect(screen.child(Board).armedAction).toBeNull();
    screen.child(ActionBar).onArm('splitPr');
    screen.flush();
    screen.updateSprint({ complete: true });
    expect(screen.child(Board).armedAction).toBeNull();
  });

  it('一時停止中はカードと介入を拒否し、再開後のカード結果はそのまま返す', () => {
    const screen = mountSprint({ playbackSpeed: 0 });
    expect(screen.child(DeckBar).onPlay?.(2)).toEqual({ ok: false, reason: 'paused' });
    expect(screen.child(ActionBar).onAction('firefight')).toEqual({ ok: false, reason: 'paused' });
    expect(screen.props.onPlayCard).not.toHaveBeenCalled();
    expect(screen.props.onDispatch).not.toHaveBeenCalled();
    screen.update({ playbackSpeed: 1 });
    expect(screen.child(DeckBar).onPlay?.(2)).toEqual({ ok: true, deckIndex: 2, focusCost: 1 });
    expect(screen.props.onPlayCard).toHaveBeenCalledExactlyOnceWith(2);
  });

  it.each([{ ok: false, reason: 'no-target' }, { ok: true }] as const)(
    '演出のない介入結果 %j はそのまま返し、武装を維持する',
    (outcome) => {
      const screen = mountSprint({ onDispatch: vi.fn(() => outcome) });
      screen.child(ActionBar).onArm('splitPr');
      screen.flush();
      expect(screen.child(ActionBar).onAction('splitPr', { taskId: 1 })).toBe(outcome);
      screen.flush();
      expect(screen.props.onDispatch).toHaveBeenCalledExactlyOnceWith('splitPr', { taskId: 1 });
      expect(screen.props.getSprintSnapshot).not.toHaveBeenCalled();
      expect(screen.child(Board)).toMatchObject({
        armedAction: 'splitPr',
        interventionTrigger: null,
      });
      expect(screen.props.pauseBriefly).not.toHaveBeenCalled();
    },
  );

  it('成功した介入は前後スナップショットを演出に渡し、再実行時にトリガを更新する', () => {
    const prevTasks = [makeTask(1)];
    const nextState = makeState([makeTask(1, { lane: 'done' })]);
    const outcome = success('interruptReview', { affectedTaskIds: [1] });
    const screen = mountSprint({
      state: makeState(prevTasks),
      onDispatch: vi.fn(() => outcome),
      getSprintSnapshot: vi.fn(() => nextState.sprint),
    });
    screen.child(ActionBar).onArm('splitPr');
    screen.flush();
    expect(screen.child(ActionBar).onAction('interruptReview')).toBe(outcome);
    screen.flush();
    expect(screen.child(Board).interventionTrigger).toMatchObject({
      effect: outcome.effect,
      prevTasks,
      nextTasks: nextState.sprint?.tasks,
      currentTick: 4,
      key: 1,
    });
    expect(screen.child(Board).interventionTrigger?.prevTasks).not.toBe(prevTasks);
    expect(screen.child(Board).interventionTrigger?.nextTasks).not.toBe(nextState.sprint?.tasks);
    expect(screen.child(Board).armedAction).toBeNull();
    expect(screen.props.pauseBriefly).not.toHaveBeenCalled();
    screen.update({ getSprintSnapshot: vi.fn(() => null) });
    screen.child(ActionBar).onAction('interruptReview');
    screen.flush();
    expect(screen.child(Board).interventionTrigger).toMatchObject({ nextTasks: prevTasks, key: 2 });
  });

  it('ドラッグは武装時だけ実行し、失敗と成功を更新番号付きでアクションバーへ返す', () => {
    const failure: InterventionOutcome = { ok: false, reason: 'no-focus' };
    const outcome = success('assignTask');
    const onDispatch = vi.fn().mockReturnValueOnce(failure).mockReturnValueOnce(outcome);
    const screen = mountSprint({ onDispatch });
    const target = { taskId: 4, lane: 'coding', assignee: 'ai' } as const;
    screen.child(Board).onDragComplete?.(target);
    expect(onDispatch).not.toHaveBeenCalled();
    screen.child(ActionBar).onArm('assignTask');
    screen.flush();
    screen.child(Board).onDragComplete?.(target);
    screen.flush();
    expect(onDispatch).toHaveBeenLastCalledWith('assignTask', target);
    expect(screen.child(ActionBar).outcomeFeedback).toEqual({
      id: 'assignTask',
      outcome: failure,
      nonce: 1,
    });
    expect(screen.child(Board).armedAction).toBe('assignTask');
    screen.child(Board).onDragComplete?.(target);
    screen.flush();
    expect(screen.child(ActionBar).outcomeFeedback).toEqual({
      id: 'assignTask',
      outcome,
      nonce: 2,
    });
    expect(screen.child(Board).armedAction).toBeNull();
  });
});

describe('SprintScreen の自動ポーズと演出の寿命', () => {
  it('Review渋滞の立ち上がりだけをハイライトし、時間経過で解除する', () => {
    const screen = mountSprint();
    screen.updateSprint({ metrics: { ...screen.sprint.metrics, reviewQueueMax: 11 } });
    expect(screen.props.pauseBriefly).not.toHaveBeenCalled();
    screen.updateSprint({ metrics: { ...screen.sprint.metrics, reviewQueueMax: 12 } });
    expect(screen.child(AttentionOverlay)).toEqual({ label: 'REVIEW JAM', title: 'Review渋滞!' });
    expect(screen.find('jam-meter').props.className).toContain(' attention');
    expect(screen.props.pauseBriefly).toHaveBeenCalledExactlyOnceWith(ATTENTION_PAUSE_MS);
    screen.advance(ATTENTION_PAUSE_MS - 1);
    expect(screen.has(AttentionOverlay)).toBe(true);
    screen.advance(1);
    expect(screen.has(AttentionOverlay)).toBe(false);
    expect(screen.find('jam-meter').props.className).not.toContain(' attention');
    vi.mocked(performance.now).mockReturnValue(6_000);
    screen.updateSprint({ metrics: { ...screen.sprint.metrics, reviewQueueMax: 20 } });
    expect(screen.props.pauseBriefly).toHaveBeenCalledTimes(1);
  });

  it('点火イベントを検出し、クールダウン内の再発と一時停止中の点火を再生しない', () => {
    const screen = mountSprint();
    screen.updateSprint({ fireEvents: [{ tick: 1, kind: 'ignite', taskId: 1, source: 'review' }] });
    expect(screen.child(AttentionOverlay)).toEqual({ label: 'IGNITE', title: '点火!' });
    const fireWrap = elements(screen.child(SprintLayout).status).find(
      (node) => node.props.className === 'meter-wrap attention',
    );
    expect(content(fireWrap)).toContain('炎上タイマー');
    screen.advance(ATTENTION_PAUSE_MS);
    vi.mocked(performance.now).mockReturnValue(4_000);
    screen.updateSprint({ tasks: [burningTask(2)] });
    expect(screen.props.pauseBriefly).toHaveBeenCalledTimes(1);
    vi.mocked(performance.now).mockReturnValue(6_000);
    screen.update({ playbackSpeed: 0 });
    screen.updateSprint({ tasks: [burningTask(3)] });
    screen.update({ playbackSpeed: 1 });
    expect(screen.props.pauseBriefly).toHaveBeenCalledTimes(1);
    screen.updateSprint({ tasks: [burningTask(4)] });
    expect(screen.props.pauseBriefly).toHaveBeenCalledTimes(2);
    expect(screen.has(AttentionOverlay)).toBe(true);
  });

  it('完了後と別スプリントへの切替時は比較元をリセットする', () => {
    const screen = mountSprint();
    screen.updateSprint({ complete: true, tasks: [burningTask(1)] });
    expect(screen.props.pauseBriefly).not.toHaveBeenCalled();
    screen.updateSprint({ complete: false, tasks: [burningTask(2)] });
    expect(screen.props.pauseBriefly).not.toHaveBeenCalled();
    screen.update({
      state: {
        ...screen.props.state,
        currentSprintId: 'q1-s2',
        sprint: { ...screen.sprint, tasks: [burningTask(3)] },
      },
    });
    expect(screen.props.pauseBriefly).not.toHaveBeenCalled();
    screen.updateSprint({ tasks: [burningTask(4)] });
    expect(screen.props.pauseBriefly).toHaveBeenCalledExactlyOnceWith(ATTENTION_PAUSE_MS);
  });

  it('遅延中の注目ポーズを新イベントで置き換え、アンマウント時に所有ポーズを解除する', () => {
    const clearPause = vi.fn();
    const screen = mountSprint({ pauseBriefly: vi.fn(() => clearPause) });
    const removeListener = vi.spyOn(window, 'removeEventListener');
    screen.updateSprint({ tasks: [burningTask(1)] });
    vi.mocked(performance.now).mockReturnValue(6_000);
    screen.updateSprint({ tasks: [burningTask(2)] });
    expect(screen.props.pauseBriefly).toHaveBeenCalledTimes(2);
    expect(clearPause).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
    screen.unmount();
    expect(clearPause).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('ボスの最終鎮火は注目ポーズをスローモへ置換し、鎮火の重複演出を700msだけ抑止する', () => {
    const clearAttentionPause = vi.fn();
    const clearSlowMoPause = vi.fn();
    const nextState = makeState([]);
    const pauseBriefly = vi
      .fn()
      .mockReturnValueOnce(clearAttentionPause)
      .mockReturnValueOnce(clearSlowMoPause);
    const screen = mountSprint({
      state: makeState([], { currentSprintKind: 'boss' }),
      onDispatch: vi.fn(() => success('firefight', { containedTaskId: 1 })),
      getSprintSnapshot: vi.fn(() => nextState.sprint),
      pauseBriefly,
    });
    screen.updateSprint({ tasks: [burningTask(1)] });
    expect(screen.child(AttentionOverlay)).toEqual({
      label: 'BOSS INCIDENT',
      title: 'ボス障害発生!',
    });
    screen.child(ActionBar).onAction('firefight');
    screen.flush();
    expect(screen.has(AttentionOverlay)).toBe(false);
    expect(screen.child(SlowMotionOverlay).clearedIncidentCount).toBe(1);
    expect(clearAttentionPause).toHaveBeenCalledOnce();
    expect(pauseBriefly).toHaveBeenNthCalledWith(2, 1_200);
    expect(screen.child(Board).suppressExtinguishTaskIds).toEqual(new Set([1]));
    screen.advance(699);
    expect(screen.child(Board).suppressExtinguishTaskIds).toEqual(new Set([1]));
    screen.advance(1);
    expect(screen.child(Board).suppressExtinguishTaskIds).toEqual(new Set());
    screen.advance(499);
    expect(screen.has(SlowMotionOverlay)).toBe(true);
    screen.advance(1);
    expect(screen.has(SlowMotionOverlay)).toBe(false);
    screen.unmount();
    expect(clearSlowMoPause).not.toHaveBeenCalled();
  });

  it('スローモ中の再介入は尺を更新し、画面離脱時に残ったタイマーとポーズを解除する', () => {
    const clearPause = vi.fn();
    const screen = mountSprint({
      state: makeState([burningTask(1), burningTask(2)], { currentSprintKind: 'boss' }),
      onDispatch: vi.fn(() => success('firefight')),
      getSprintSnapshot: vi.fn(() => makeState([]).sprint),
      pauseBriefly: vi.fn(() => clearPause),
    });
    screen.child(ActionBar).onAction('firefight');
    screen.flush();
    expect(screen.child(SlowMotionOverlay).clearedIncidentCount).toBe(2);
    screen.advance(600);
    screen.child(ActionBar).onAction('firefight');
    screen.flush();
    expect(clearPause).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
    screen.advance(600);
    expect(screen.has(SlowMotionOverlay)).toBe(true);
    screen.unmount();
    expect(clearPause).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});

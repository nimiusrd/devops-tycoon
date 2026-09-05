import { Children, isValidElement, Suspense, type ReactElement, type ReactNode } from 'react';
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
const boundary = vi.hoisted(() => ({ usePixi: false, loaded: false, playSfx: vi.fn() }));
vi.mock('../../../src/ui/WebglLoading', () => ({ WebglLoading: () => null }));

// Node 上では React の再描画・ブラウザ・GPU の境界だけを代行する。
// 盤面コンポーネント、候補選定、座標判定、シーン計画、演出タイムラインは実装を使う。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  lazy: () => 'board-pixi-layer',
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
vi.mock('framer-motion', () => ({
  AnimatePresence: 'div',
  motion: { div: 'div', span: 'span' },
  useReducedMotion: () => false,
}));
vi.mock('../../../src/audio/useAudio', () => ({
  useAudio: () => ({ playSfx: boundary.playSfx }),
}));
vi.mock('../../../src/ui/usePixiRenderer', () => ({
  usePixiRenderer: () => ({
    usePixi: boundary.usePixi,
    onWebglError: () => {
      boundary.usePixi = false;
    },
  }),
}));
// 画像ロードによるアクター自身の state は officeActors.test.ts で別途検証する。

import { Board, type BoardProps } from '../../../src/render/Board';
import {
  clientPointHitsRegisteredBoardDrag,
  hasRegisteredBoardDragHitTest,
} from '../../../src/render/boardDragHit';
import { BOARD_STATION_CENTERS, BOARD_VIEW } from '../../../src/render/boardScene';
import { VISUAL_TOKENS } from '../../../src/render/visualTokens';
import { OVERTIME_TICKS } from '../../../src/sim/actions';
import { createInitialRoster } from '../../../src/sim/member';
import { BURN_TICKS } from '../../../src/sim/model';
import { createOrgState } from '../../../src/sim/org';
import type { SprintState } from '../../../src/sim/types';
import { burningTask, makeSprint, makeTask } from '../helpers/sprintFixtures';

type ElementProps = Record<string, unknown> & { children?: ReactNode };

function elements(node: ReactNode, includePending = false): ReactElement<ElementProps>[] {
  if (!isValidElement<ElementProps>(node)) return [];
  const pendingSuspense = node.type === Suspense && !boundary.loaded && !includePending;
  if (typeof node.type === 'function') {
    return elements((node.type as (props: ElementProps) => ReactNode)(node.props), includePending);
  }
  const children = pendingSuspense ? (node.props.fallback as ReactNode) : node.props.children;
  return [node, ...Children.toArray(children).flatMap((child) => elements(child, includePending))];
}

function content(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!isValidElement<ElementProps>(node)) return '';
  return Children.toArray(node.props.children).map(content).join('');
}

function dragSprint(): SprintState {
  const sprint = makeSprint(createOrgState('default', true), [
    makeTask(1, { lane: 'backlog' }),
    makeTask(2, { lane: 'coding' }),
    makeTask(3),
    makeTask(4, { split: true }),
  ]);
  sprint.config.codingSlots = 2;
  return sprint;
}

// 非等倍・オフセットありの盤面で、client 座標と設計座標の混同も検出する。
const rect = { left: 37, top: 83, width: BOARD_VIEW.w / 2, height: BOARD_VIEW.h / 3 };
function clientPoint(point: { x: number; y: number }) {
  return {
    clientX: rect.left + (point.x * rect.width) / BOARD_VIEW.w,
    clientY: rect.top + (point.y * rect.height) / BOARD_VIEW.h,
  };
}

class OverlayElement {
  constructor(readonly selector: string) {}
  closest(selectors: string) {
    return selectors.split(', ').includes(this.selector) ? this : null;
  }
}

let pointerWindow: EventTarget;
function pointerDown(point = { x: 0, y: 0 }, target: unknown = {}) {
  return { ...clientPoint(point), target, preventDefault: vi.fn(), stopPropagation: vi.fn() };
}

function unmount() {
  for (const slot of hooks.slots) slot.cleanup?.();
  hooks.slots = [];
  hooks.effects = [];
  hooks.cursor = 0;
  hooks.dirty = false;
}

function mountBoard(overrides: Partial<BoardProps> = {}) {
  const sprint = dragSprint();
  let props: BoardProps = { tasks: sprint.tasks, sprint, onDragComplete: vi.fn(), ...overrides };
  let tree: ReactElement<ElementProps>;
  let connected = true;
  const flush = () => {
    let renders = 0;
    do {
      if (++renders > 25) throw new Error('Board の更新が収束しませんでした');
      hooks.cursor = 0;
      hooks.dirty = false;
      tree = Board(props) as ReactElement<ElementProps>;
      (tree.props.ref as { current: unknown }).current = connected
        ? { getBoundingClientRect: () => rect }
        : null;
      for (const effect of hooks.effects.splice(0)) effect();
    } while (hooks.dirty);
  };
  const query = (id: string) => elements(tree).find((node) => node.props['data-testid'] === id);
  const find = (id: string) => {
    const node = query(id);
    if (!node) throw new Error(`要素がありません: ${id}`);
    return node;
  };
  const dot = (id: number) => {
    const scene = layer().props.scene as import('../../../src/render/boardScene').BoardScenePlan;
    const found = scene.dots.find((dot) => dot.id === id);
    if (!found) throw new Error(`タスク粒がありません: ${id}`);
    return found;
  };
  const layer = () => {
    const node = elements(tree, true).find((node) => node.type === 'board-pixi-layer');
    if (!node) throw new Error('Pixi レイヤがありません');
    return node;
  };
  flush();
  return {
    get props() {
      return props;
    },
    find,
    query,
    dot,
    layer,
    all: () => elements(tree),
    byClass(name: string) {
      return elements(tree).filter((node) =>
        String(node.props.className ?? '')
          .split(' ')
          .includes(name),
      );
    },
    update(next: Partial<BoardProps>) {
      props = { ...props, ...next };
      flush();
    },
    disconnect() {
      connected = false;
      flush();
    },
    downTask(id: number) {
      const event = pointerDown(dot(id));
      (find('board').props.onPointerDown as (event: unknown) => void)(event);
      flush();
      return event;
    },
    downBoard(point: { x: number; y: number }, target?: unknown) {
      const event = pointerDown(point, target);
      (find('board').props.onPointerDown as (event: unknown) => void)(event);
      flush();
      return event;
    },
    dispatch(type: 'pointermove' | 'pointerup', point: { x: number; y: number }) {
      pointerWindow.dispatchEvent(Object.assign(new Event(type), clientPoint(point)));
      flush();
    },
    ready() {
      boundary.loaded = true;
      (layer().props.onReady as () => void)();
      flush();
    },
    failGpu() {
      (layer().props.onWebglError as () => void)();
      flush();
    },
    advance(ms: number) {
      vi.advanceTimersByTime(ms);
      flush();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  boundary.usePixi = true;
  boundary.loaded = false;
  boundary.playSfx.mockClear();
  pointerWindow = new EventTarget();
  vi.stubGlobal('window', Object.assign(pointerWindow, { setTimeout, clearTimeout }));
  vi.stubGlobal('Element', OverlayElement);
});

afterEach(() => {
  unmount();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Board の状態表示', () => {
  it('工程件数・渋滞・炎上の緊急度・流れる粒と省略数を表示する', () => {
    const tasks = [
      ...Array.from({ length: 8 }, (_, id) => makeTask(id, { lane: 'backlog' })),
      ...Array.from({ length: 21 }, (_, id) => makeTask(100 + id)),
      makeTask(30, { lane: 'coding', aiAssisted: true, progress: 0.5 }),
      makeTask(31, { lane: 'done', highValue: true }),
      { ...burningTask(40), burnTicksLeft: 1 },
      burningTask(41, BURN_TICKS),
    ];
    const board = mountBoard({ tasks, sprint: null });

    expect(board.find('board').props).toMatchObject({
      'data-review-hell': 'true',
      'data-review-heat': 1,
      'data-effect-renderer': 'loading',
    });
    expect(board.find('board').props.className).toContain('review-hell');
    expect(board.find('board-flow-summary').props['aria-label']).toBe('開発フローの工程別件数');
    for (const [lane, count] of [
      ['backlog', 8],
      ['coding', 1],
      ['review', 21],
      ['rework', 2],
      ['done', 1],
    ]) {
      expect(content(board.find(`count-${lane}`))).toBe(String(count));
    }
    expect(content(board.find('overflow-review'))).toBe('+1');
    expect(board.query('overflow-backlog')).toBeUndefined();
    expect(board.byClass('needs-attention').map((node) => node.props['data-lane'])).toEqual([
      'review',
      'rework',
    ]);
    expect(board.byClass('bubble').map(content)).toEqual([
      '山積みだ…',
      'レビュー終わらん…',
      '燃えてる！',
    ]);
    expect(board.dot(40).burnUrgency).toBeLessThan(0.35);
    expect(board.dot(41).fire).toBe(true);
    expect(board.dot(30)).toMatchObject({ variant: 'ai', motion: { kind: 'flow' } });
    expect(board.dot(31).variant).toBe('gold');
    expect(board.byClass('task-dot')).toHaveLength(0);
    expect(board.byClass('li').map(content)).toEqual([
      'AI利用',
      '手戻り',
      '高価値',
      '技術的負債',
      '炎上',
    ]);
    expect(hasRegisteredBoardDragHitTest()).toBe(true);
  });

  it('メンバー疲弊を人物へ反映し、空になった工程の警告と吹き出しを消す', () => {
    const roster = createInitialRoster(() => 0.5);
    roster.members.forEach((member) => {
      member.onLeave = true;
    });
    const board = mountBoard({
      roster,
      tasks: [makeTask(1, { lane: 'coding', aiAssisted: true }), makeTask(2, { lane: 'rework' })],
    });
    expect(board.find('lane-coding').props['data-mood']).toBe('exhausted');
    expect(board.byClass('bubble').map(content)).toEqual(['動いてない…']);
    expect(board.byClass('bubble')[0].props.className).toContain('hot');
    board.update({ tasks: [], roster: null });
    expect(board.find('lane-coding').props['data-mood']).toBe('neutral');
    expect(board.find('board').props['data-review-heat']).toBe(0);
    expect(board.find('board').props['data-review-hell']).toBe('false');
    expect(board.byClass('bubble')).toHaveLength(0);
    expect(board.byClass('task-dot')).toHaveLength(0);
  });
});

describe('Board の座標ドラッグ', () => {
  it.each([undefined, 'ai', 'senior'] as const)(
    '差配の担当 %s と対象 ID を Coding へのドロップで一度だけ通知する',
    (assignee) => {
      const board = mountBoard({ armedAction: 'assignTask', assignAssignee: assignee });
      expect(Array.from(board.layer().props.draggableTaskIds as Set<number>).sort()).toEqual([
        1, 2,
      ]);
      expect(board.byClass('drop-target').map((node) => node.props['data-testid'])).toEqual([
        'lane-coding',
      ]);
      const down = board.downTask(1);
      expect(down.preventDefault).toHaveBeenCalledOnce();
      expect(down.stopPropagation).toHaveBeenCalledOnce();
      expect(board.layer().props.dragTaskId).toBe(1);
      board.dispatch('pointermove', BOARD_STATION_CENTERS.coding);
      expect(board.find('lane-coding').props.className).toContain('drop-hover');
      board.dispatch('pointerup', BOARD_STATION_CENTERS.coding);
      expect(board.props.onDragComplete).toHaveBeenCalledExactlyOnceWith({
        taskId: 1,
        lane: 'coding',
        ...(assignee ? { assignee } : {}),
      });
      expect(board.byClass('dragging')).toHaveLength(0);
      expect(board.byClass('drop-hover')).toHaveLength(0);
      board.dispatch('pointerup', BOARD_STATION_CENTERS.coding);
      expect(board.props.onDragComplete).toHaveBeenCalledOnce();
    },
  );

  it('差配は対象外レーンへのドロップを取り消し、次のドラッグへ持ち越さない', () => {
    const board = mountBoard({ armedAction: 'assignTask' });
    board.downTask(1);
    board.dispatch('pointermove', BOARD_STATION_CENTERS.coding);
    board.dispatch('pointermove', BOARD_STATION_CENTERS.review);
    expect(board.byClass('drop-hover')).toHaveLength(0);
    board.dispatch('pointerup', BOARD_STATION_CENTERS.review);
    expect(board.props.onDragComplete).not.toHaveBeenCalled();
    expect(board.byClass('dragging')).toHaveLength(0);
    board.downTask(2);
    board.dispatch('pointerup', BOARD_STATION_CENTERS.coding);
    expect(board.props.onDragComplete).toHaveBeenCalledExactlyOnceWith({
      taskId: 2,
      lane: 'coding',
    });
  });

  it('PR 分割は未分割の Coding/Review のみを掴み、レーン外で離しても対象 ID を通知する', () => {
    const board = mountBoard({ armedAction: 'splitPr' });
    expect(Array.from(board.layer().props.draggableTaskIds as Set<number>).sort()).toEqual([2, 3]);
    expect((board.layer().props.draggableTaskIds as Set<number>).has(4)).toBe(false);
    board.downTask(3);
    board.dispatch('pointerup', { x: 0, y: 0 });
    expect(board.props.onDragComplete).toHaveBeenCalledExactlyOnceWith({ taskId: 3 });
    expect(board.byClass('dragging')).toHaveLength(0);
  });

  it('盤面がドラッグ中に外れた場合は移動・確定を捨てて後続 pointerup も受け付けない', () => {
    const board = mountBoard({ armedAction: 'splitPr' });
    board.downTask(3);
    board.disconnect();
    board.dispatch('pointermove', BOARD_STATION_CENTERS.coding);
    board.dispatch('pointerup', BOARD_STATION_CENTERS.coding);
    board.dispatch('pointerup', BOARD_STATION_CENTERS.coding);
    expect(board.props.onDragComplete).not.toHaveBeenCalled();
    expect(board.byClass('dragging')).toHaveLength(0);
  });

  it('武装・スプリント・callback が揃うまで操作を開始せず、満員時は Backlog を掴ませない', () => {
    const board = mountBoard();
    expect((board.layer().props.draggableTaskIds as Set<number>).size).toBe(0);
    expect(board.downBoard({ x: 0, y: 0 }).preventDefault).not.toHaveBeenCalled();
    board.update({ armedAction: 'assignTask', sprint: null });
    expect((board.layer().props.draggableTaskIds as Set<number>).size).toBe(0);
    const sprint = dragSprint();
    sprint.config.codingSlots = 1;
    board.update({ sprint, onDragComplete: undefined });
    expect(Array.from(board.layer().props.draggableTaskIds as Set<number>).sort()).toEqual([2]);
    expect(board.downTask(2).preventDefault).not.toHaveBeenCalled();
    expect(board.byClass('dragging')).toHaveLength(0);
  });
});

describe('Board の Pixi 境界', () => {
  it('準備完了後にcanvas座標から操作し、DOMの粒を作らない', () => {
    const board = mountBoard({ armedAction: 'assignTask' });
    expect(board.find('board').props['data-effect-renderer']).toBe('loading');
    expect(board.byClass('task-dot')).toHaveLength(0);
    board.ready();
    expect(board.find('board').props['data-effect-renderer']).toBe('pixi');
    board.downBoard(board.dot(1));
    board.dispatch('pointerup', BOARD_STATION_CENTERS.coding);
    expect(board.props.onDragComplete).toHaveBeenCalledExactlyOnceWith({
      taskId: 1,
      lane: 'coding',
    });
    unmount();
    expect(hasRegisteredBoardDragHitTest()).toBe(false);
  });

  it('ラベル・凡例・吹き出し・省略数のクリックでは分割せず、装飾上の粒は掴める', () => {
    boundary.usePixi = true;
    const board = mountBoard({ armedAction: 'splitPr' });
    const point = board.dot(3);
    board.ready();
    for (const selector of ['.st-label', '.bubble', '.board-legend', '.pile-overflow']) {
      expect(
        board.downBoard(point, new OverlayElement(selector)).preventDefault,
      ).not.toHaveBeenCalled();
      board.dispatch('pointerup', point);
    }
    board.downBoard({ x: 0, y: 0 });
    board.dispatch('pointerup', point);
    expect(board.props.onDragComplete).not.toHaveBeenCalled();
    board.downBoard(point, new OverlayElement('.board-modifier-aura'));
    board.dispatch('pointerup', point);
    expect(board.props.onDragComplete).toHaveBeenCalledExactlyOnceWith({ taskId: 3 });
    board.update({ armedAction: null });
    board.downBoard(point);
    expect(
      clientPointHitsRegisteredBoardDrag(clientPoint(point).clientX, clientPoint(point).clientY),
    ).toBe(false);
    board.disconnect();
    expect(board.downBoard(point).preventDefault).not.toHaveBeenCalled();
  });

  it('GPU専用の演出planを渡し、故障時もDOM演出を作らず発火回数を維持する', () => {
    boundary.usePixi = true;
    const sprint = dragSprint();
    const board = mountBoard({
      animationsPaused: true,
      modifiers: { ...sprint.modifiers, overtimeUntilTick: OVERTIME_TICKS },
      sprintTick: OVERTIME_TICKS / 2,
      interventionTrigger: {
        key: 7,
        currentTick: 0,
        prevTasks: sprint.tasks,
        nextTasks: sprint.tasks,
        effect: { actionId: 'splitPr', affectedTaskIds: [3], focusCost: 2, gaugeGain: 0 },
      },
    });
    expect(board.find('board').props).toMatchObject({
      'data-effect-renderer': 'loading',
      'data-effect-count': 1,
      'data-effect-kinds': 'intervention:split',
      'data-effect-sequence': 0,
      'data-effect-sfx-count': 1,
      'data-effect-last-sfx': 'interventionHit',
      'data-animations-paused': 'true',
    });
    expect(board.layer().props.auras).toEqual([
      { kind: 'overtime', remainingTicks: OVERTIME_TICKS / 2, totalTicks: OVERTIME_TICKS },
    ]);
    expect(board.byClass('dom-fallback-hidden')).toHaveLength(0);
    expect(board.query('intervention-effect-split')).toBeUndefined();
    expect(board.layer().props.animationsPaused).toBe(true);
    const effects = board.layer().props.effects;
    board.ready();
    expect(board.find('board').props['data-effect-renderer']).toBe('pixi');
    expect(board.byClass('dom-fallback-hidden')).toHaveLength(0);
    expect(board.layer().props.effects).toBe(effects);
    board.failGpu();
    expect(board.find('board').props['data-effect-renderer']).toBe('loading');
    expect(board.byClass('dom-fallback-hidden')).toHaveLength(0);
    expect(board.query('intervention-effect-split')).toBeUndefined();
    expect(board.find('board').props['data-effect-sequence']).toBe(0);
    expect(boundary.playSfx).toHaveBeenCalledExactlyOnceWith('interventionHit');
    expect(hasRegisteredBoardDragHitTest()).toBe(false);
    const tokens = VISUAL_TOKENS.dimensions.sprint.boardEffects;
    board.advance(tokens.split.durationMs + tokens.lingerMs + 16);
    expect(board.query('intervention-effect-split')).toBeUndefined();
    expect(board.find('board').props['data-effect-count']).toBe(0);
    board.update({ sprintTick: OVERTIME_TICKS, animationsPaused: false });
    expect(board.query('board-aura-overtime')).toBeUndefined();
    expect(board.find('board').props['data-animations-paused']).toBeUndefined();
  });
});

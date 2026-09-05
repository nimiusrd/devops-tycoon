import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  cursor: 0,
  dirty: false,
  slots: [] as {
    value?: unknown;
    dependencies?: readonly unknown[];
    setup?: () => void | (() => void);
    cleanup?: () => void;
  }[],
  effects: [] as (() => void)[],
  sameDependencies(previous: readonly unknown[] | undefined, next: readonly unknown[]) {
    if (!previous || previous.length !== next.length) return false;
    return next.every((value, index) => Object.is(value, previous[index]));
  },
}));

const boundary = vi.hoisted(() => ({
  reducedMotion: null as boolean | null,
  playSfx: vi.fn(),
}));

// node 環境で state/ref の保持と effect の依存・解除を再現する。
// 演出の検出、座標配置、寿命、SFX 選択には実際の純粋関数を使う。
vi.mock('react', () => ({
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
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    hooks.slots[index] ??= { value: { current: initial } };
    return hooks.slots[index].value;
  },
  useEffect(setup: () => void | (() => void), dependencies: readonly unknown[]) {
    const index = hooks.cursor++;
    const previous = hooks.slots[index];
    if (hooks.sameDependencies(previous?.dependencies, dependencies)) return;
    const slot = { dependencies, setup, cleanup: undefined as (() => void) | undefined };
    hooks.slots[index] = slot;
    hooks.effects.push(() => {
      previous?.cleanup?.();
      slot.cleanup = setup() ?? undefined;
    });
  },
}));

vi.mock('framer-motion', () => ({ useReducedMotion: () => boundary.reducedMotion }));
vi.mock('../../../src/audio/useAudio', () => ({
  useAudio: () => ({ playSfx: boundary.playSfx }),
}));

import { VISUAL_TOKENS } from '../../../src/render/visualTokens';
import type { Lane, SprintMetrics, Task } from '../../../src/sim/types';
import type { InterventionTrigger } from '../../../src/render/interventionEffects';
import {
  useBoardEffects,
  type BoardEffectsState,
  type UseBoardEffectsInput,
} from '../../../src/ui/useBoardEffects';

function makeTask(id: number, lane: Lane, overrides: Partial<Task> = {}): Task {
  return {
    id,
    lane,
    kind: 'normal',
    highValue: false,
    aiAssisted: false,
    progress: 0,
    reworkAttempts: 0,
    wasReworked: false,
    incident: false,
    debt: false,
    ...overrides,
  };
}

function makeMetrics(overrides: Partial<SprintMetrics> = {}): SprintMetrics {
  return {
    delivered: 0,
    doneCount: 0,
    reworkCount: 0,
    incidentCount: 0,
    contained: 0,
    autoContainCount: 0,
    spread: 0,
    aiAssistedCompleted: 0,
    completedCount: 0,
    reviewQueueMax: 0,
    combo: 0,
    maxCombo: 0,
    seniorHpStart: 80,
    interventionsUsed: 0,
    focusSpent: 0,
    actionCounts: {},
    stabilizingGrants: 0,
    ...overrides,
  };
}

function reviewTrigger(key = 1): InterventionTrigger {
  return {
    key,
    effect: { actionId: 'interruptReview', affectedTaskIds: [8, 9], focusCost: 1, gaugeGain: 0.1 },
    prevTasks: [makeTask(8, 'review'), makeTask(9, 'review')],
    nextTasks: [makeTask(8, 'done'), makeTask(9, 'rework', { incident: true })],
    currentTick: 10,
  };
}

let wallMs = 0;
let nextTimerId = 0;
const timers = new Map<number, { callback: () => void; at: number }>();
const setTimeout = vi.fn((callback: () => void, delay: number) => {
  const id = ++nextTimerId;
  timers.set(id, { callback, at: wallMs + delay });
  return id;
});
const clearTimeout = vi.fn((id: number) => timers.delete(id));

function unmount() {
  for (const slot of hooks.slots) slot.cleanup?.();
  hooks.slots = [];
  hooks.effects = [];
  hooks.cursor = 0;
  hooks.dirty = false;
}

function mountBoard(initial: Partial<UseBoardEffectsInput> = {}) {
  let input: UseBoardEffectsInput = {
    tasks: [],
    metrics: makeMetrics(),
    reviewAccumulator: 0,
    interventionTrigger: null,
    ...initial,
  };
  let current: BoardEffectsState;
  const flush = () => {
    let renders = 0;
    do {
      if (++renders > 25) throw new Error('useBoardEffects の再描画が収束しませんでした');
      hooks.dirty = false;
      hooks.cursor = 0;
      current = useBoardEffects(input);
      for (const effect of hooks.effects.splice(0)) effect();
    } while (hooks.dirty);
  };
  flush();
  return {
    get current() {
      return current;
    },
    update(next: Partial<UseBoardEffectsInput>) {
      input = { ...input, ...next };
      flush();
    },
    advanceTo(nowMs: number) {
      wallMs = nowMs;
      for (const [id, timer] of [...timers]) {
        if (timer.at > nowMs) continue;
        timers.delete(id);
        timer.callback();
      }
      flush();
    },
    replayEffects() {
      for (const slot of hooks.slots) slot.cleanup?.();
      for (const slot of hooks.slots) {
        if (slot.setup) slot.cleanup = slot.setup() ?? undefined;
      }
      flush();
    },
  };
}

describe('useBoardEffects', () => {
  beforeEach(() => {
    wallMs = 1_000;
    nextTimerId = 0;
    boundary.reducedMotion = null;
    boundary.playSfx.mockClear();
    setTimeout.mockClear();
    clearTimeout.mockClear();
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    vi.spyOn(performance, 'now').mockImplementation(() => wallMs);
  });

  afterEach(() => {
    unmount();
    timers.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('初期状態と同値のスナップショットを再発火せず、motion 設定だけを更新する', () => {
    const tasks = [makeTask(1, 'rework', { incident: true, burnTicksLeft: 10 })];
    const board = mountBoard({ tasks, metrics: makeMetrics({ incidentCount: 1 }) });
    expect(board.current).toEqual({
      effects: [],
      lastSequence: -1,
      reducedMotion: false,
      audio: { count: 0, last: null },
    });

    boundary.reducedMotion = true;
    board.update({
      tasks: tasks.map((task) => ({ ...task })),
      metrics: makeMetrics({ incidentCount: 1 }),
    });
    expect(board.current.reducedMotion).toBe(true);
    expect(board.current.effects).toEqual([]);
    expect(board.current.lastSequence).toBe(-1);
    expect(boundary.playSfx).not.toHaveBeenCalled();
    expect(setTimeout).not.toHaveBeenCalled();
  });

  it('Review 落ちを一度だけ点火し、点火だけでは SFX を鳴らさない', () => {
    const board = mountBoard({ tasks: [makeTask(1, 'review')] });
    const nextTasks = [makeTask(1, 'rework', { incident: true, burnTicksLeft: 20 })];
    board.update({ tasks: nextTasks, metrics: makeMetrics({ incidentCount: 1 }) });
    const [ignite] = board.current.effects;
    const tokens = VISUAL_TOKENS.dimensions.sprint.boardEffects;
    expect(board.current.effects).toHaveLength(1);
    expect(ignite).toMatchObject({
      source: 'fire',
      effect: { kind: 'ignite', taskId: 1, x: expect.any(Number), y: expect.any(Number) },
      sequence: 0,
      startedAtMs: 1_000,
      endsAtMs: 1_000 + tokens.ignite.durationMs + tokens.lingerMs,
    });

    board.update({ tasks: nextTasks.map((task) => ({ ...task })), reviewAccumulator: 0.5 });
    expect(board.current.effects).toEqual([ignite]);
    expect(board.current.lastSequence).toBe(0);
    expect(board.current.audio).toEqual({ count: 0, last: null });
    expect(boundary.playSfx).not.toHaveBeenCalled();
  });

  it('metrics が未取得・リセット中なら次の取得を基準にし、古い炎上との差分を再生しない', () => {
    const board = mountBoard({ tasks: [makeTask(1, 'review')], metrics: undefined });
    board.update({
      tasks: [makeTask(1, 'rework', { incident: true, burnTicksLeft: 1 })],
      metrics: makeMetrics({ incidentCount: 1 }),
    });
    expect(board.current.effects).toEqual([]);

    board.update({
      tasks: [makeTask(1, 'rework')],
      metrics: makeMetrics({ incidentCount: 1, contained: 1 }),
    });
    expect(board.current.effects).toHaveLength(1);
    expect(board.current.effects[0].effect).toMatchObject({
      kind: 'extinguish',
      taskId: 1,
      source: 'auto',
    });

    board.update({ metrics: undefined });
    board.update({
      tasks: [makeTask(2, 'rework', { incident: true })],
      metrics: makeMetrics({ incidentCount: 1 }),
    });
    expect(board.current.effects).toHaveLength(1);
    expect(board.current.lastSequence).toBe(0);
    expect(boundary.playSfx).not.toHaveBeenCalled();
  });

  it('指定 ID の緊急対応による鎮火だけを抑制し、自動鎮火・他の鎮火・点火を残す', () => {
    const board = mountBoard({
      tasks: [
        makeTask(1, 'rework', { incident: true, burnTicksLeft: 1 }),
        makeTask(2, 'rework', { incident: true, burnTicksLeft: 2 }),
        makeTask(3, 'rework', { incident: true, burnTicksLeft: 3 }),
        makeTask(4, 'review'),
      ],
      metrics: makeMetrics({ incidentCount: 3 }),
    });
    board.update({
      tasks: [
        makeTask(1, 'review'),
        makeTask(2, 'review'),
        makeTask(3, 'rework'),
        makeTask(4, 'rework', { incident: true, burnTicksLeft: 20 }),
      ],
      metrics: makeMetrics({ incidentCount: 4, contained: 3, actionCounts: { firefight: 2 } }),
      suppressExtinguishTaskIds: new Set([1, 3, 4]),
    });
    expect(board.current.effects.map(({ effect }) => effect)).toEqual([
      expect.objectContaining({ kind: 'ignite', taskId: 4 }),
      expect.objectContaining({ kind: 'extinguish', taskId: 2, source: 'firefight' }),
      expect.objectContaining({ kind: 'extinguish', taskId: 3, source: 'auto' }),
    ]);
    expect(board.current.effects.map(({ sequence }) => sequence)).toEqual([0, 1, 2]);
    expect(boundary.playSfx).not.toHaveBeenCalled();
  });

  it('同じ更新の複数延焼と複数介入に連番を付け、SFX は種類ごとに一回だけ鳴らす', () => {
    const board = mountBoard({
      tasks: [
        makeTask(0, 'rework', { incident: true, burnTicksLeft: 1 }),
        makeTask(1, 'rework', { incident: true, burnTicksLeft: 1 }),
        makeTask(2, 'review'),
        makeTask(3, 'review'),
        makeTask(4, 'review'),
        makeTask(5, 'review'),
      ],
      metrics: makeMetrics({ incidentCount: 2 }),
    });
    const interventionTrigger = reviewTrigger();
    const nextTasks = [
      makeTask(0, 'rework', { debt: true }),
      makeTask(1, 'rework', { debt: true }),
      makeTask(2, 'rework', { incident: true, burnTicksLeft: 20 }),
      makeTask(3, 'rework', { incident: true, burnTicksLeft: 20 }),
      makeTask(4, 'review'),
      makeTask(5, 'review'),
    ];
    board.update({
      tasks: nextTasks,
      metrics: makeMetrics({ incidentCount: 4, spread: 2 }),
      interventionTrigger,
      suppressExtinguishTaskIds: new Set(),
    });
    expect(board.current.effects.map(({ effect }) => effect)).toEqual([
      expect.objectContaining({ kind: 'spread', fromTaskId: 0, toTaskId: 2 }),
      expect.objectContaining({ kind: 'spread', fromTaskId: 1, toTaskId: 3 }),
      expect.objectContaining({ kind: 'reviewSweep', taskId: 8, outcome: 'done' }),
      expect.objectContaining({ kind: 'reviewSweep', taskId: 9, outcome: 'incident' }),
    ]);
    expect(board.current.effects.map(({ sequence }) => sequence)).toEqual([0, 1, 2, 3]);
    expect(board.current.effects.every(({ startedAtMs }) => startedAtMs === 1_000)).toBe(true);
    expect(boundary.playSfx.mock.calls).toEqual([['fireSpread'], ['interventionHit']]);
    expect(board.current.audio).toEqual({ count: 2, last: 'interventionHit' });

    const effects = board.current.effects;
    board.update({ tasks: [...nextTasks], interventionTrigger: { ...interventionTrigger } });
    expect(board.current.effects).toBe(effects);
    expect(board.current.lastSequence).toBe(3);
    expect(boundary.playSfx).toHaveBeenCalledTimes(2);
  });

  it('期限切れ後も介入キーと連番を保持し、新しいキーの介入だけを追加する', () => {
    const interventionTrigger = reviewTrigger(10);
    const board = mountBoard({ interventionTrigger });
    board.advanceTo(Math.max(...board.current.effects.map(({ endsAtMs }) => endsAtMs)) + 16);
    expect(board.current.effects).toEqual([]);
    expect(board.current.lastSequence).toBe(1);
    expect(board.current.audio).toEqual({ count: 1, last: 'interventionHit' });

    board.update({ interventionTrigger: null });
    board.update({ interventionTrigger: { ...interventionTrigger } });
    expect(board.current.effects).toEqual([]);
    expect(boundary.playSfx).toHaveBeenCalledTimes(1);

    board.update({ interventionTrigger: reviewTrigger(11) });
    expect(board.current.effects.map(({ sequence }) => sequence)).toEqual([2, 3]);
    expect(board.current.audio).toEqual({ count: 2, last: 'interventionHit' });
    const effects = board.current.effects;
    board.update({ interventionTrigger });
    expect(board.current.effects).toBe(effects);
    expect(board.current.lastSequence).toBe(3);
    expect(boundary.playSfx).toHaveBeenCalledTimes(2);
  });

  it('対象のない介入も処理済みにし、同じキーの再通知で後から発火しない', () => {
    const trigger = reviewTrigger();
    const board = mountBoard({
      interventionTrigger: {
        ...trigger,
        effect: { actionId: 'interruptReview', focusCost: 1, gaugeGain: 0.1 },
      },
    });
    board.update({ interventionTrigger: trigger });
    expect(board.current.effects).toEqual([]);
    expect(board.current.lastSequence).toBe(-1);
    expect(boundary.playSfx).not.toHaveBeenCalled();
    expect(setTimeout).not.toHaveBeenCalled();
  });

  it('追加 batch は寿命中の演出を保持し、タイマー通知前でも期限切れを除去する', () => {
    const board = mountBoard({ tasks: [makeTask(1, 'review')] });
    board.update({
      tasks: [makeTask(1, 'rework', { incident: true })],
      metrics: makeMetrics({ incidentCount: 1 }),
    });
    const [ignite] = board.current.effects;
    board.advanceTo(1_100);
    board.update({ interventionTrigger: reviewTrigger() });
    const [, firstSweep, secondSweep] = board.current.effects;
    expect(board.current.effects[0]).toBe(ignite);
    expect(board.current.effects.map(({ sequence }) => sequence)).toEqual([0, 1, 2]);
    expect(board.current.effects.map(({ startedAtMs }) => startedAtMs)).toEqual([
      1_000, 1_100, 1_100,
    ]);
    expect(timers.size).toBe(1);
    expect([...timers.values()][0].at).toBe(ignite.endsAtMs + 16);

    // 寿命の直後、16 ms のタイマー猶予内に別の介入が到着する。
    wallMs = ignite.endsAtMs + 1;
    board.update({ interventionTrigger: reviewTrigger(2) });
    expect(board.current.effects.slice(0, 2)).toEqual([firstSweep, secondSweep]);
    expect(board.current.effects.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4]);
    expect(board.current.lastSequence).toBe(4);
    expect(board.current.audio).toEqual({ count: 2, last: 'interventionHit' });
    expect(timers.size).toBe(1);
    expect([...timers.values()][0].at).toBe(firstSweep.endsAtMs + 16);
  });

  it('StrictMode 相当の再 setup で寿命タイマーを張り直し、各演出を期限順に除去する', () => {
    const board = mountBoard({ interventionTrigger: reviewTrigger() });
    const effects = board.current.effects;
    const [first, second] = effects;
    expect(timers.size).toBe(1);
    expect([...timers.values()][0].at).toBe(first.endsAtMs + 16);

    board.replayEffects();
    expect(clearTimeout).toHaveBeenCalledTimes(1);
    expect(setTimeout).toHaveBeenCalledTimes(2);
    expect(timers.size).toBe(1);
    expect(board.current.effects).toBe(effects);
    expect(boundary.playSfx).toHaveBeenCalledTimes(1);

    board.advanceTo(first.endsAtMs + 15);
    expect(board.current.effects).toEqual([first, second]);
    board.advanceTo(first.endsAtMs + 16);
    expect(board.current.effects).toEqual([second]);
    expect(timers.size).toBe(1);
    expect([...timers.values()][0].at).toBe(second.endsAtMs + 16);

    board.advanceTo(second.endsAtMs + 16);
    expect(board.current.effects).toEqual([]);
    expect(board.current.lastSequence).toBe(1);
    expect(timers.size).toBe(0);
    expect(boundary.playSfx).toHaveBeenCalledTimes(1);

    board.update({ interventionTrigger: reviewTrigger(2) });
    const timerIds = [...timers.keys()];
    expect(timerIds).toHaveLength(1);
    unmount();
    expect(clearTimeout).toHaveBeenLastCalledWith(timerIds[0]);
    expect(timers.size).toBe(0);
  });

  it('performance がない環境では Date の時計を使用し、reduced motion でも一度だけ通知する', () => {
    vi.stubGlobal('performance', undefined);
    vi.spyOn(Date, 'now').mockImplementation(() => wallMs);
    boundary.reducedMotion = true;
    const board = mountBoard({ interventionTrigger: reviewTrigger() });
    expect(board.current.reducedMotion).toBe(true);
    expect(board.current.effects.map(({ startedAtMs }) => startedAtMs)).toEqual([1_000, 1_000]);
    expect(board.current.audio).toEqual({ count: 1, last: 'interventionHit' });

    board.advanceTo(Math.max(...board.current.effects.map(({ endsAtMs }) => endsAtMs)) + 16);
    expect(board.current.effects).toEqual([]);
    expect(board.current.lastSequence).toBe(1);
    expect(timers.size).toBe(0);
    expect(boundary.playSfx).toHaveBeenCalledTimes(1);
  });
});

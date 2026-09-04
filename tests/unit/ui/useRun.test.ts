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
    if (!previous || previous.length !== next.length) return false;
    return next.every((value, i) => Object.is(value, previous[i]));
  },
}));

// node 環境で、再描画を跨ぐ state/ref と effect の依存・解除だけを再現する。
vi.mock('react', () => ({
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

import { createGame, type GameHandle } from '../../../src/game';
import type { ZoomLevel } from '../../../src/sim/orgscale/types';
import type { RunState } from '../../../src/sim/run/types';
import type { CardPlayOutcome, InterventionOutcome } from '../../../src/sim/types';
import { REPLAY_SCHEMA_VERSION } from '../../../src/state/replay';
import { CURRENT_RUN_RULESET } from '../../../src/state/runPersistence';
import { FRAME_MS, MAX_TICKS_PER_FRAME, msPerTick, SIM_STEP_MS } from '../../../src/ui/sprintTempo';
import { useRun, type UseRun } from '../../../src/ui/useRun';

type RunView = Pick<
  UseRun,
  | 'state'
  | 'meta'
  | 'diagnosticInfo'
  | 'lastRunReward'
  | 'runSaveSummary'
  | 'resumeRisk'
  | 'runSaveIssue'
  | 'runEpoch'
  | 'replays'
  | 'isReplayMode'
  | 'activeReplayDiagnosis'
  | 'activeReplayInfo'
>;

function controlledGame(sprint = false) {
  const game = createGame({ seed: 'use-run' });
  if (sprint) {
    game.startRun('normal', []);
    game.beginSetupSprint();
  }
  const view: RunView = {
    state: game.getState(),
    meta: game.getMeta(),
    diagnosticInfo: game.getDiagnosticInfo(),
    lastRunReward: game.getLastRunReward(),
    runSaveSummary: game.getRunSaveSummary(),
    resumeRisk: game.getResumeRisk(),
    runSaveIssue: game.getRunSaveIssue(),
    runEpoch: game.getRunEpoch(),
    replays: game.listReplays(),
    isReplayMode: game.isReplayMode(),
    activeReplayDiagnosis: game.getActiveReplayDiagnosis(),
    activeReplayInfo: game.getActiveReplayInfo(),
  };
  const control = { revision: 0, paused: false, running: sprint, zoom: 'team' as ZoomLevel };
  vi.spyOn(game, 'getState').mockImplementation(() => view.state);
  vi.spyOn(game, 'getMeta').mockImplementation(() => view.meta);
  vi.spyOn(game, 'getDiagnosticInfo').mockImplementation(() => view.diagnosticInfo);
  vi.spyOn(game, 'getLastRunReward').mockImplementation(() => view.lastRunReward);
  vi.spyOn(game, 'getRunSaveSummary').mockImplementation(() => view.runSaveSummary);
  vi.spyOn(game, 'getResumeRisk').mockImplementation(() => view.resumeRisk);
  vi.spyOn(game, 'getRunSaveIssue').mockImplementation(() => view.runSaveIssue);
  vi.spyOn(game, 'getRunEpoch').mockImplementation(() => view.runEpoch);
  vi.spyOn(game, 'listReplays').mockImplementation(() => view.replays);
  vi.spyOn(game, 'isReplayMode').mockImplementation(() => view.isReplayMode);
  vi.spyOn(game, 'getActiveReplayDiagnosis').mockImplementation(() => view.activeReplayDiagnosis);
  vi.spyOn(game, 'getActiveReplayInfo').mockImplementation(() => view.activeReplayInfo);
  vi.spyOn(game, 'revision').mockImplementation(() => control.revision);
  vi.spyOn(game, 'phase').mockImplementation(() => view.state.phase);
  vi.spyOn(game, 'isPaused').mockImplementation(() => control.paused);
  vi.spyOn(game, 'isSprintRunning').mockImplementation(() => control.running);
  vi.spyOn(game, 'zoomLevel').mockImplementation(() => control.zoom);
  const step = vi.spyOn(game, 'step').mockImplementation(() => view.state);
  const publish = (state: Partial<RunState>) => {
    view.state = { ...view.state, ...state };
    control.revision += 1;
  };
  return { game, view, control, step, publish };
}

let wallMs = 0;
let nextIntervalId = 0;
const intervals = new Map<number, () => void>();
const setInterval = vi.fn((callback: () => void, _delay: number) => {
  const id = ++nextIntervalId;
  intervals.set(id, callback);
  return id;
});
const clearInterval = vi.fn((id: number) => intervals.delete(id));

function unmount() {
  for (const slot of hooks.slots) slot.cleanup?.();
  hooks.slots = [];
  hooks.effects = [];
  hooks.cursor = 0;
  hooks.dirty = false;
}

function mountRun(initialGame: GameHandle, beforeEffects?: () => void) {
  let game = initialGame;
  let current: UseRun;
  let beforeFirstEffects = beforeEffects;
  const flush = () => {
    let renders = 0;
    do {
      renders += 1;
      if (renders > 25) throw new Error('useRun の更新が 25 回の再描画で収束しませんでした');
      hooks.dirty = false;
      hooks.cursor = 0;
      current = useRun(game);
      beforeFirstEffects?.();
      beforeFirstEffects = undefined;
      for (const effect of hooks.effects.splice(0)) effect();
    } while (hooks.dirty);
  };
  flush();
  return {
    get current() {
      return current;
    },
    flush,
    poll(deltaMs = FRAME_MS) {
      wallMs += deltaMs;
      for (const callback of [...intervals.values()]) callback();
      flush();
    },
    replaceGame(next: GameHandle) {
      game = next;
      flush();
    },
  };
}

describe('useRun', () => {
  beforeEach(() => {
    wallMs = 0;
    nextIntervalId = 0;
    setInterval.mockClear();
    clearInterval.mockClear();
    vi.stubGlobal('window', { setInterval, clearInterval });
    vi.spyOn(performance, 'now').mockImplementation(() => wallMs);
  });

  afterEach(() => {
    unmount();
    intervals.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('描画から effect 開始までの変更も初回同期し、同じ revision では読み直さない', () => {
    const { game, view, control, publish } = controlledGame();
    const initialState = view.state;
    const run = mountRun(game, () => {
      view.state = { ...view.state, seed: 'changed-before-effect' };
      view.meta = { ...view.meta, soundMuted: false };
      view.diagnosticInfo = { ...view.diagnosticInfo, seed: view.state.seed };
      view.runEpoch = 4;
    });
    expect(run.current.state).toBe(initialState);
    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), FRAME_MS);

    run.poll();
    expect(run.current).toMatchObject(view);
    expect(game.getState).toHaveBeenCalledTimes(2);
    run.poll();
    expect(game.getState).toHaveBeenCalledTimes(2);
    expect(game.getMeta).toHaveBeenCalledTimes(2);

    publish({ seed: 'external-update' });
    expect(control.revision).toBe(1);
    run.poll();
    expect(run.current.state.seed).toBe('external-update');
    expect(game.getState).toHaveBeenCalledTimes(3);
    expect(setInterval).toHaveBeenCalledTimes(1);
  });

  it('revision 変更でセーブ警告・報酬・リプレイ情報をまとめて同期し、解除も反映する', () => {
    const { game, view, control } = controlledGame();
    const run = mountRun(game);
    run.poll();
    view.runSaveSummary = {
      seed: 'saved-run',
      difficulty: 'hard',
      trials: [],
      runKind: 'normal',
      phase: 'setup',
      quarterNumber: 2,
      sprintIndexInQuarter: 3,
      sprintsPlayed: 8,
      status: 'playing',
    };
    view.runSaveIssue = {
      kind: 'ruleset-unknown',
      summary: view.runSaveSummary,
      savedRuleset: null,
      currentRuleset: CURRENT_RUN_RULESET,
    };
    view.resumeRisk = {
      tone: 'danger',
      requiresConfirm: true,
      headline: '継続不能',
      body: '再開前に確認',
      seniorHpPct: 0,
      flags: [],
    };
    view.lastRunReward = {
      base: 10,
      learningBonus: 2,
      reviewBonus: 0,
      reviewBonusKind: null,
      total: 12,
      granted: true,
    };
    view.replays = [
      {
        schemaVersion: REPLAY_SCHEMA_VERSION,
        id: 'replay-1',
        seed: 'recorded',
        difficulty: 'hard',
        trials: [],
        finishedAt: 1,
        outcome: { status: 'lost', diagnosis: 'reviewHell', score: 12 },
        keyframes: [],
        ruleset: null,
        contentSnapshot: null,
      },
    ];
    view.isReplayMode = true;
    view.activeReplayDiagnosis = 'reviewHell';
    view.activeReplayInfo = { ruleset: null, contentSnapshot: null };
    control.revision += 1;
    run.poll();
    expect(run.current).toMatchObject(view);

    view.runSaveSummary = null;
    view.runSaveIssue = null;
    view.resumeRisk = null;
    view.lastRunReward = null;
    view.replays = [];
    view.isReplayMode = false;
    view.activeReplayDiagnosis = null;
    view.activeReplayInfo = null;
    control.revision += 1;
    run.poll();
    expect(run.current).toMatchObject(view);
  });

  it('端数の壁時計を蓄積して固定幅で進め、2x とタブ復帰時の上限を守る', () => {
    const { game, step } = controlledGame(true);
    const run = mountRun(game);
    run.poll(msPerTick(1) / 2);
    expect(step).not.toHaveBeenCalled();
    run.poll(msPerTick(1) / 2);
    expect(step).toHaveBeenCalledExactlyOnceWith(SIM_STEP_MS);

    run.current.setPlaybackSpeed(2);
    run.flush();
    expect(run.current.playbackSpeed).toBe(2);
    run.poll(msPerTick(2));
    expect(step).toHaveBeenCalledTimes(2);
    run.poll(60_000);
    expect(step).toHaveBeenCalledTimes(2 + MAX_TICKS_PER_FRAME);
    run.poll(msPerTick(2) / 2);
    expect(step).toHaveBeenCalledTimes(2 + MAX_TICKS_PER_FRAME);
  });

  it.each(['player-pause', 'game-pause', 'sprint-ended', 'evolution', 'company-view'] as const)(
    '%s では進行と未消化時間を止め、再開時に停止前の端数を持ち越さない',
    (condition) => {
      const { game, view, control, step } = controlledGame(true);
      const run = mountRun(game);
      run.poll(msPerTick(1) / 2);
      if (condition === 'player-pause') run.current.setPlaybackSpeed(0);
      if (condition === 'game-pause') control.paused = true;
      if (condition === 'sprint-ended') control.running = false;
      if (condition === 'evolution') view.state = { ...view.state, phase: 'evolution' };
      if (condition === 'company-view') control.zoom = 'company';
      run.poll(60_000);
      expect(step).not.toHaveBeenCalled();

      run.current.setPlaybackSpeed(1);
      control.paused = false;
      control.running = true;
      control.zoom = 'team';
      view.state = { ...view.state, phase: 'sprint' };
      run.poll(msPerTick(1) / 2);
      expect(step).not.toHaveBeenCalled();
      run.poll(msPerTick(1) / 2);
      expect(step).toHaveBeenCalledExactlyOnceWith(SIM_STEP_MS);
    },
  );

  it.each(['phase', 'pause', 'player-speed', 'sprint-running', 'zoom'] as const)(
    '複数 tick の途中で %s が変わったら残りを実行しない',
    (condition) => {
      const { game, view, control, step } = controlledGame(true);
      const run = mountRun(game);
      step.mockImplementation(() => {
        if (condition === 'phase') view.state = { ...view.state, phase: 'evolution' };
        if (condition === 'pause') control.paused = true;
        if (condition === 'player-speed') run.current.setPlaybackSpeed(0);
        if (condition === 'sprint-running') control.running = false;
        if (condition === 'zoom') control.zoom = 'company';
        return view.state;
      });
      run.poll(msPerTick(1) * MAX_TICKS_PER_FRAME);
      expect(step).toHaveBeenCalledExactlyOnceWith(SIM_STEP_MS);
    },
  );

  it('同じスプリントでは速度を保ち、別スプリントとフェーズ復帰では 1x に戻す', () => {
    const { game, view, publish } = controlledGame(true);
    const run = mountRun(game);
    run.current.setPlaybackSpeed(2);
    publish({ sprintTick: view.state.sprintTick + 1 });
    run.poll();
    expect(run.current.playbackSpeed).toBe(2);

    publish({ currentSprintId: 'next-sprint' });
    run.poll();
    expect(run.current.playbackSpeed).toBe(1);
    run.current.setPlaybackSpeed(0);
    publish({ phase: 'evolution' });
    run.poll();
    expect(run.current.playbackSpeed).toBe(0);
    publish({ phase: 'sprint', currentSprintId: 'next-sprint' });
    run.poll();
    expect(run.current.playbackSpeed).toBe(1);
  });

  it('Pause は再描画前から介入・カードを拒否し、再開するとエンジンの結果を返す', () => {
    const { game, view } = controlledGame(true);
    const dispatched: InterventionOutcome = { ok: true };
    const played: CardPlayOutcome = { ok: false, reason: 'no-focus' };
    const dispatch = vi.spyOn(game, 'dispatch').mockReturnValue(dispatched);
    const playCard = vi.spyOn(game, 'playCard').mockReturnValue(played);
    const pause = vi.spyOn(game, 'pause');
    const resume = vi.spyOn(game, 'resume');
    const run = mountRun(game);
    const target = { taskId: 7, lane: 'coding' as const };

    run.current.setPlaybackSpeed(0);
    expect(run.current.dispatch('assignTask', target)).toEqual({ ok: false, reason: 'paused' });
    expect(run.current.playCard(3)).toEqual({ ok: false, reason: 'paused' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(playCard).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();

    run.current.setPlaybackSpeed(1);
    expect(run.current.dispatch('assignTask', target)).toBe(dispatched);
    expect(dispatch).toHaveBeenCalledWith('assignTask', target);
    expect(run.current.playCard(3)).toBe(played);
    expect(playCard).toHaveBeenCalledWith(3);
    const newerSprint = { ...view.state.sprint!, tick: 123 };
    view.state = { ...view.state, sprint: newerSprint };
    expect(run.current.getSprintSnapshot()).toBe(newerSprint);
    expect(run.current.state.sprint).not.toBe(newerSprint);
  });

  it('一時停止のキャンセルで進行を再開し、プレイヤーの 2x 設定を維持する', () => {
    const game = createGame({ seed: 'brief-pause' });
    game.startRun('normal', []);
    game.beginSetupSprint();
    const run = mountRun(game);
    run.current.setPlaybackSpeed(2);
    run.flush();
    const tickBeforePause = game.getState().sprintTick;
    const cancel = run.current.pauseBriefly(1_000);
    try {
      expect(game.isPaused()).toBe(true);
      run.poll(msPerTick(2));
      expect(game.getState().sprintTick).toBe(tickBeforePause);
      expect(run.current.playbackSpeed).toBe(2);
    } finally {
      cancel();
    }
    expect(game.isPaused()).toBe(false);
    run.poll(msPerTick(2));
    expect(game.getState().sprintTick).toBe(tickBeforePause + 1);
    expect(run.current.playbackSpeed).toBe(2);
  });

  it.each(['open', 'jump'] as const)(
    'リプレイ %s 成功時はポーリング前に画面と診断・報酬を更新し、失敗時は維持する',
    (operation) => {
      const { game, view } = controlledGame();
      const open = vi.spyOn(game, 'openReplay').mockReturnValue(null);
      const jump = vi.spyOn(game, 'jumpReplayToPhase').mockReturnValue(null);
      const run = mountRun(game);
      const originalState = run.current.state;
      const invoke = () =>
        operation === 'open'
          ? run.current.openReplay('recorded', 3)
          : run.current.jumpReplayToPhase('result');
      expect(invoke()).toBe(operation === 'open' ? false : undefined);
      run.flush();
      expect(run.current.state).toBe(originalState);
      expect(run.current.isReplayMode).toBe(false);

      const opened = { ...originalState, phase: 'result' as const, seed: 'recorded' };
      open.mockReturnValue(opened);
      jump.mockReturnValue(opened);
      view.diagnosticInfo = { ...view.diagnosticInfo, seed: 'recorded', diagnosis: 'reviewHell' };
      view.lastRunReward = {
        base: 10,
        learningBonus: 0,
        reviewBonus: 0,
        reviewBonusKind: null,
        total: 10,
        granted: false,
      };
      view.activeReplayDiagnosis = 'reviewHell';
      view.activeReplayInfo = {
        ruleset: { version: 1, fingerprint: 'recorded' },
        contentSnapshot: null,
      };
      expect(invoke()).toBe(operation === 'open' ? true : undefined);
      run.flush();
      expect(run.current).toMatchObject({
        state: opened,
        diagnosticInfo: view.diagnosticInfo,
        lastRunReward: view.lastRunReward,
        isReplayMode: true,
        activeReplayDiagnosis: view.activeReplayDiagnosis,
        activeReplayInfo: view.activeReplayInfo,
      });
      expect(game.getState).toHaveBeenCalledTimes(1);
      if (operation === 'open') expect(open).toHaveBeenLastCalledWith('recorded', 3);
      else expect(jump).toHaveBeenLastCalledWith('result');

      open.mockReturnValue(null);
      jump.mockReturnValue(null);
      invoke();
      run.flush();
      expect(run.current.state).toBe(opened);
      expect(run.current.isReplayMode).toBe(true);
    },
  );

  it('開始条件の scenario と seed を正しく渡し、通常操作は次のポーリングで反映する', () => {
    const game = createGame({ seed: 'title' });
    const startRun = vi.spyOn(game, 'startRun');
    const run = mountRun(game);
    run.current.startRun('hard', [], 'startup', 'chosen-seed');
    expect(startRun).toHaveBeenCalledWith('hard', [], 'chosen-seed', 'startup');
    expect(run.current.state.phase).toBe('title');
    run.poll();
    expect(run.current.state).toMatchObject({
      seed: 'chosen-seed',
      difficulty: 'hard',
      phase: 'setup',
    });
    expect(run.current.runEpoch).toBe(1);
    run.current.newRun();
    expect(run.current.state.phase).toBe('setup');
    run.poll();
    expect(run.current.state.phase).toBe('title');
  });

  it('game 交換で古いポーリングを解除し、同じ revision の新しい game を同期する', () => {
    const first = controlledGame();
    const second = controlledGame();
    second.view.state = { ...second.view.state, seed: 'second-game' };
    const firstStart = vi.spyOn(first.game, 'startRun');
    const secondStart = vi.spyOn(second.game, 'startRun');
    const run = mountRun(first.game);
    run.poll();
    const firstHandler = run.current.startRun;
    run.flush();
    expect(run.current.startRun).toBe(firstHandler);
    run.replaceGame(second.game);
    expect(run.current.startRun).not.toBe(firstHandler);
    expect(clearInterval).toHaveBeenCalledWith(1);
    expect(intervals.size).toBe(1);
    run.poll();
    expect(run.current.state.seed).toBe('second-game');
    expect(first.game.getState).toHaveBeenCalledTimes(2);
    run.current.startRun('easy', []);
    expect(firstStart).not.toHaveBeenCalled();
    expect(secondStart).toHaveBeenCalledExactlyOnceWith('easy', [], undefined, undefined);

    unmount();
    expect(clearInterval).toHaveBeenLastCalledWith(2);
    expect(intervals.size).toBe(0);
  });
});

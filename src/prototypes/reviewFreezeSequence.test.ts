import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS } from '../data/balance/pacing';
import { createGame } from '../game';
import { REVIEW_FREEZE_PEAK } from '../sim/outcome';
import { createRngFromState, getRngState } from '../sim/rng';
import { RunEngine } from '../sim/run/engine';
import { createSprint } from '../sim/sprint';
import { defaultMeta } from '../state/meta';
import { MemoryMetaStorage } from '../state/metaPersistence';
import { MemoryReplayStorage } from '../state/replayPersistence';
import { MemoryRunStorage } from '../state/runPersistence';
import {
  captureReviewFreezeTick,
  planReviewFreezeSequence,
  reviewFreezeTraceBytes,
  REVIEW_FREEZE_SEQUENCE_MAX_TICKS,
  startReviewFreezeTrace,
} from './reviewFreezeSequence';

function fixture(seed: string, maxTicks = 58) {
  const engine = new RunEngine({ seed, difficulty: 'normal' });
  engine.startRun();
  engine.beginSetupSprint();
  const origin = engine.exportCounterfactualFrame()!;
  const original = origin.sprint!;
  const rng = createRngFromState(origin.sprintRngState);
  const sprint = createSprint(
    { ...original.config, taskCount: 52, codingSlots: 18, minCompleteTick: 0, maxTicks },
    origin.persist.org,
    rng,
    { ...original.cardEffects, reviewCapacityMul: 0.12 },
  );
  for (const task of sprint.tasks) {
    task.lane = task.id < 34 ? 'review' : 'coding';
    if (task.lane === 'coding') task.progress = ((task.id - 34) % 6) / 6;
  }
  // 隔離した盤面の比較用。ラン開始時の通常盤面とその無介入比較は使用しない。
  return {
    ...origin,
    sprint,
    sprintRngState: getRngState(rng),
    sprintBaselineInput: null,
  };
}

function simulate(origin: ReturnType<typeof fixture>, interruptAt: number | null, capture = true) {
  const engine = new RunEngine();
  engine.hydrateCounterfactualFrame(origin);
  const trace = startReviewFreezeTrace(engine.snapshot())!;
  const rngStates: number[] = [];
  let state = engine.snapshot();
  while (state.phase === 'sprint') {
    if (state.sprintTick === interruptAt) {
      expect(engine.dispatch('interruptReview').ok).toBe(true);
    }
    engine.step(FIXED_STEP_MS);
    state = engine.snapshot();
    if (capture) captureReviewFreezeTick(trace, state);
    const rng = engine.exportCounterfactualFrame()?.sprintRngState;
    if (rng !== undefined) rngStates.push(rng);
  }
  return { terminal: state, trace, rngStates, keyframe: engine.exportReplayFrame() };
}

describe('RI-289 レビュー凍結の再上映', () => {
  it.each([
    ['RI-289:0', 52, 48, 66, 83],
    ['RI-289:1', 51, 48, 29, 60],
    ['RI-289:2', 51, 47, 61, 101],
  ])(
    '同一入力の観測と乱数消費が一致する（%s）',
    (seed, waitPeak, actionPeak, waitPoints, actionPoints) => {
      const origin = fixture(seed);
      const wait = simulate(origin, null);
      const action = simulate(origin, 5);
      expect(simulate(origin, null)).toEqual(wait);
      expect(simulate(origin, 5)).toEqual(action);
      for (const [captured, interruptAt] of [
        [wait, null],
        [action, 5],
      ] as const) {
        const unrecorded = simulate(origin, interruptAt, false);
        expect(captured.terminal).toEqual(unrecorded.terminal);
        expect(captured.rngStates).toEqual(unrecorded.rngStates);
      }
      expect(wait.terminal.lastResult).toMatchObject({
        reviewQueueMax: waitPeak,
        delivered: waitPoints,
      });
      expect(action.terminal.lastResult).toMatchObject({
        reviewQueueMax: actionPeak,
        delivered: actionPoints,
      });
      expect(wait.terminal.loseReason).toBe('reviewFreeze');
      expect(action.terminal.loseReason).toBe(
        actionPeak < REVIEW_FREEZE_PEAK ? undefined : 'reviewFreeze',
      );
    },
  );

  it('処理時ピーク・割り込みレビュー・決着を発生順に表示する', () => {
    const before = simulate(fixture('RI-289:1'), 5);
    const after = simulate(fixture('RI-289:0'), 5);
    const earlierPlan = planReviewFreezeSequence(before.terminal, {
      kind: 'captured',
      trace: before.trace,
    });
    const laterPlan = planReviewFreezeSequence(after.terminal, {
      kind: 'captured',
      trace: after.trace,
    });
    if (earlierPlan.kind !== 'sequence' || laterPlan.kind !== 'sequence')
      throw new Error('連続観測から再上映できません');
    expect(earlierPlan.moments).toEqual([
      { kind: 'watch', tick: 1, offsetMs: 203, peak: 37 },
      {
        kind: 'interrupt-review',
        tick: 5,
        offsetMs: 1017,
        effect: { reviewedCount: 4, focusCost: 3, extraHpCost: 2 },
      },
      { kind: 'threshold', tick: 8, offsetMs: 1627, peak: 48 },
      { kind: 'loss', tick: 58, offsetMs: 12000, peak: 48 },
    ]);
    expect(laterPlan.moments.map(({ kind, tick }) => [kind, tick])).toEqual([
      ['watch', 1],
      ['threshold', 4],
      ['interrupt-review', 5],
      ['loss', 58],
    ]);
    expect(earlierPlan.frames).toHaveLength(59);
    expect(earlierPlan.frames[0]?.offsetMs).toBe(0);
    expect(earlierPlan.frames[8]?.tick).toBe(8);
    expect(earlierPlan.frames[58]).toMatchObject({
      tick: 58,
      queueAfterStep: 43,
      sprintPeak: 48,
      offsetMs: 11797,
    });
    expect(earlierPlan.durationMs).toBe(12_000);
    expect(reviewFreezeTraceBytes(before.trace)).toBe(3095);
    const seed = 'あ'.repeat(4096);
    expect(
      planReviewFreezeSequence(
        { ...before.terminal, seed },
        { kind: 'captured', trace: { ...before.trace, seed } },
      ),
    ).toMatchObject({ kind: 'summary', reason: 'incomplete-recording' });
  });

  it('別添の連続観測を使い、旧キーフレーム単体は静的な説明を返す', () => {
    const { terminal, keyframe, trace } = simulate(fixture('RI-289:1'), 5);
    const recorded = planReviewFreezeSequence(terminal, { kind: 'captured', trace });
    expect(recorded.kind).toBe('sequence');
    expect(keyframe?.sprint).toBeNull();
    expect(keyframe?.sprintTick).toBe(0);
    expect(
      planReviewFreezeSequence(keyframe!, {
        kind: 'captured',
        trace: JSON.parse(JSON.stringify(trace)),
      }),
    ).toEqual(recorded);
    for (const kind of ['legacy-keyframes', 'save-failed', 'missing-recording'] as const) {
      expect(planReviewFreezeSequence(keyframe!, { kind })).toEqual({
        kind: 'summary',
        reason: kind,
        loseReason: 'reviewFreeze',
        runReviewPeak: 48,
      });
    }
  });

  it('欠損、順序の逆転、別スプリント、別ルールセット、終端不一致を再上映しない', () => {
    const { terminal, trace } = simulate(fixture('RI-289:1'), 5);
    const withoutTick = trace.samples.filter(({ tick }) => tick !== 8);
    const sparse = [...trace.samples];
    delete sparse[8];
    const reordered = [...trace.samples];
    [reordered[7], reordered[8]] = [reordered[8]!, reordered[7]!];
    for (const invalid of [
      { ...trace, samples: withoutTick },
      { ...trace, samples: sparse },
      { ...trace, samples: reordered },
      { ...trace, samples: trace.samples.slice(0, -1) },
      { ...trace, sprintId: 'q1-s2' },
      { ...trace, ruleset: { ...trace.ruleset, fingerprint: 'unknown' } },
      { ...trace, lossTick: undefined },
      { ...trace, runPeakBeforeSprint: REVIEW_FREEZE_PEAK },
    ]) {
      expect(
        planReviewFreezeSequence(terminal, { kind: 'captured', trace: invalid }),
      ).toMatchObject({
        kind: 'summary',
        reason: 'incomplete-recording',
      });
    }
    expect(
      planReviewFreezeSequence(
        { ...terminal, loseReason: 'techDebt' },
        { kind: 'captured', trace },
      ),
    ).toMatchObject({ kind: 'summary', reason: 'unsupported-outcome' });
    const continued = simulate(fixture('RI-289:2'), 5);
    expect(
      planReviewFreezeSequence(continued.terminal, { kind: 'captured', trace: continued.trace }),
    ).toMatchObject({ kind: 'summary', reason: 'unsupported-outcome' });
  });

  it('上限を超える過去を破棄し、起点が残らない場合は静的な説明を返す', () => {
    const { terminal, trace } = simulate(fixture('RI-289:0', 170), null);
    expect(trace.samples).toHaveLength(REVIEW_FREEZE_SEQUENCE_MAX_TICKS);
    expect(trace.samples[0]?.tick).toBe(51);
    expect(trace.lossTick).toBe(170);
    expect(planReviewFreezeSequence(terminal, { kind: 'captured', trace })).toMatchObject({
      kind: 'summary',
      reason: 'threshold-not-observed',
    });
  });

  it('再上映の読み出しを繰り返しても元のラン、乱数位置、メタ、保存を変更しない', async () => {
    const runStorage = new MemoryRunStorage();
    const metaStorage = new MemoryMetaStorage();
    const replayStorage = new MemoryReplayStorage();
    const meta = { ...defaultMeta(), points: 15 };
    await metaStorage.save(meta);
    const game = createGame({ initialMeta: meta, metaStorage, metaReady: true });
    game.attachRunPersistence(runStorage, null);
    await game.attachReplay(replayStorage);
    game.startRun('normal', [], 'existing-run');
    const savedRun = await runStorage.load();
    expect(savedRun?.summary.seed).toBe('existing-run');
    game.engine.beginSetupSprint();
    game.engine.step(FIXED_STEP_MS);
    const before = game.engine.exportCounterfactualFrame();
    expect(before?.persist.phase).toBe('sprint');

    const { terminal, trace } = simulate(fixture('RI-289:0'), 5);
    const savedTrace = structuredClone(trace);
    const terminalCopy = structuredClone(terminal);
    const firstPlan = planReviewFreezeSequence(terminal, { kind: 'captured', trace });
    if (firstPlan.kind !== 'sequence') throw new Error('試作の再上映データがありません');
    firstPlan.frames[0]!.queueAfterStep = 0;
    firstPlan.frames[5]!.interruptReview!.reviewedCount = 0;
    const freshPlan = planReviewFreezeSequence(terminal, { kind: 'captured', trace });
    expect(freshPlan).not.toEqual(firstPlan);
    expect(trace).toEqual(savedTrace);
    expect(terminal).toEqual(terminalCopy);

    expect(game.engine.exportCounterfactualFrame()).toEqual(before);
    expect(game.getMeta()).toEqual(meta);
    expect(await metaStorage.load()).toEqual(meta);
    expect(await runStorage.load()).toEqual(savedRun);
    expect(await replayStorage.list()).toEqual([]);
  });
});

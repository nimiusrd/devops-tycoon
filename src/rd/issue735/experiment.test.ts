import { describe, expect, it } from 'vitest';
import type { RdArm } from '../resolveRdExperiment';
import {
  createIssue735Experiment,
  enqueueReservedMove,
  measureIssue735Timing,
  moveReserved,
  pauseIssue735,
  recordIssue735Plan,
  requestIssue735Action,
  resumeIssue735,
  startIssue735,
  summarizeIssue735,
  tickIssue735,
} from './experiment';
import { runIssue735Arm, runScriptedPassFail, SCRIPTED_PLAN } from './scripted';

describe('#735 停止中の最大2手予約（R&D throwaway）', () => {
  it('パス/フェイル条件を同じ seed で満たす', () => {
    const report = runScriptedPassFail('RI-735');
    expect(report.checks.determinism.pass).toBe(true);
    expect(report.checks.doubleSpend.pass).toBe(true);
    expect(report.checks.doubleTrigger.pass).toBe(true);
    expect(report.checks.targetDisappear.pass).toBe(true);
    expect(report.checks.pausedBlock.pass).toBe(true);
    expect(report.checks.cancelSpend.pass).toBe(true);
    expect(report.allPass).toBe(true);
  });

  it('同じ seed と予約順なら結果が一致する', () => {
    const a = runIssue735Arm('reserve', 'RI-735');
    const b = runIssue735Arm('reserve', 'RI-735');
    expect(summarizeIssue735(a)).toEqual(summarizeIssue735(b));
    expect(a.logs).toEqual(b.logs);
  });

  it('予約なし腕は停止中に手動介入できず、再生後に意図方針を打てる', () => {
    const none = runIssue735Arm('none', 'RI-735');
    expect(none.sprint.metrics.actionCounts.splitPr).toBe(1);
    expect(none.sprint.metrics.actionCounts.pairReview).toBe(1);
    expect(none.reserved).toEqual([]);
  });

  it('予約あり腕は再生後に各予約を一度だけ実行する', () => {
    const reserve = runIssue735Arm('reserve', 'RI-735');
    expect(reserve.reserved.map((move) => move.status)).toEqual(['success', 'success']);
    expect(reserve.sprint.metrics.actionCounts.splitPr).toBe(1);
    expect(reserve.sprint.metrics.actionCounts.pairReview).toBe(1);
  });

  it('予約は2件までで、並べ替えできる', () => {
    let state = startIssue735(createIssue735Experiment('reserve', 'RI-735'), 0);
    state = enqueueReservedMove(state, 'pairReview');
    state = enqueueReservedMove(state, 'splitPr', 0);
    state = enqueueReservedMove(state, 'pairReview');
    expect(state.reserved.filter((move) => move.status === 'queued')).toHaveLength(2);
    expect(state.logs.some((entry) => entry.reason === 'queue-full')).toBe(true);
    state = moveReserved(state, state.reserved[0]!.id, 1);
    expect(
      state.reserved.filter((move) => move.status === 'queued').map((move) => move.actionId),
    ).toEqual(['splitPr', 'pairReview']);
  });

  it('停止中の時間は進まない', () => {
    let state = startIssue735(createIssue735Experiment('none', 'RI-735'), 0);
    const before = structuredClone(state);
    state = requestIssue735Action(state, 'pairReview');
    expect(state.tick).toBe(before.tick);
    expect(state.sprint.metrics.delivered).toBe(before.sprint.metrics.delivered);
    expect(state.org.seniorHp).toBe(before.org.seniorHp);
    expect(state.rngState).toBe(before.rngState);
    state = resumeIssue735(state);
    expect(state.paused).toBe(false);
    expect(state.tick).toBe(0);
  });

  it('開始直後の待ち時間は負にならず 0 に丸める', () => {
    const state = startIssue735(createIssue735Experiment('none', 'RI-735'), 1000);
    expect(measureIssue735Timing(state, 800)).toEqual({
      wallClockIncludingPauseMs: 0,
      pausedMs: 0,
      wallClockExcludingPauseMs: 0,
    });
  });

  it('停止時間を待ち時間から分けて記録する', () => {
    let state = startIssue735(createIssue735Experiment('none', 'RI-735'), 1000);
    state = resumeIssue735(state, 1500);
    state = pauseIssue735(state, 2500);
    state = resumeIssue735(state, 4000);
    const live = measureIssue735Timing(state, 5000);
    expect(live).toEqual({
      wallClockIncludingPauseMs: 4000,
      pausedMs: 2000,
      wallClockExcludingPauseMs: 2000,
    });
  });

  it('意図方針の両腕で壁時計3値を summary とログに残す', () => {
    for (const arm of ['none', 'reserve'] as const) {
      const { summary, state } = runIntendedWithClock(arm);
      expect(summary.wallClockIncludingPauseMs).toBe(16400);
      expect(summary.pausedMs).toBe(2000);
      expect(summary.wallClockExcludingPauseMs).toBe(14400);
      expect(summary.wallClockMs).toBe(16400);
      expect(
        state.logs.some(
          (entry) => entry.reason === 'timing including=16400 paused=2000 excluding=14400',
        ),
      ).toBe(true);
    }
  });

  it('スクリプトログの壁時計3値は nowMs=0 のため 0', () => {
    const report = runScriptedPassFail('RI-735');
    for (const arm of [report.none, report.reserve]) {
      expect(arm.wallClockIncludingPauseMs).toBe(0);
      expect(arm.pausedMs).toBe(0);
      expect(arm.wallClockExcludingPauseMs).toBe(0);
      expect(arm.wallClockMs).toBe(0);
    }
  });
});

function runIntendedWithClock(arm: RdArm) {
  let now = 10_000;
  let state = recordIssue735Plan(createIssue735Experiment(arm, 'RI-735'), SCRIPTED_PLAN);
  state = startIssue735(state, now);
  now += 2000;
  if (arm === 'reserve') {
    state = enqueueReservedMove(state, 'splitPr', 0);
    state = enqueueReservedMove(state, 'pairReview');
    state = resumeIssue735(state, now);
  } else {
    state = resumeIssue735(state, now);
    state = requestIssue735Action(state, 'splitPr', 0);
    state = requestIssue735Action(state, 'pairReview');
  }
  while (!summarizeIssue735(state).ended) {
    now += 900;
    state = tickIssue735(state, now);
  }
  return { state, summary: summarizeIssue735(state) };
}

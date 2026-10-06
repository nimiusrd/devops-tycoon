import { describe, expect, it } from 'vitest';
import {
  createIssue735Experiment,
  enqueueReservedMove,
  moveReserved,
  requestIssue735Action,
  resumeIssue735,
  startIssue735,
  summarizeIssue735,
} from './experiment';
import { runIssue735Arm, runScriptedPassFail } from './scripted';

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
});

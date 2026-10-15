/**
 * #735 のパス/フェイル条件を自動確認する決定論ラン。
 * 比較腕は同じ seed・同じ意図方針。入力の形が違うのは仕様。
 */
import {
  cancelReservedMove,
  createIssue735Experiment,
  disappearIssue735Target,
  enqueueReservedMove,
  INTENDED_STRATEGY,
  recordIssue735Plan,
  requestIssue735Action,
  resumeIssue735,
  startIssue735,
  summarizeIssue735,
  tickIssue735,
  type ExperimentState,
  type Issue735ActionId,
} from './experiment';
import { RD_735_DEFAULT_SEED, type RdArm } from '../resolveRdExperiment';

export const SCRIPTED_PLAN = {
  moves: 'PR分割(タスク0) → ペアレビュー',
  predicted: '巨大PRを割ってからレビューを進め、出荷と完了が無介入より増える',
};

function playOut(state: ExperimentState): ExperimentState {
  let current = state;
  let guard = 0;
  while (!summarizeIssue735(current).ended && guard < 80) {
    current = tickIssue735(current, 0);
    guard += 1;
  }
  return current;
}

export function runIssue735Arm(
  arm: RdArm,
  seed: string = RD_735_DEFAULT_SEED,
  strategy: typeof INTENDED_STRATEGY = INTENDED_STRATEGY,
): ExperimentState {
  let state = recordIssue735Plan(createIssue735Experiment(arm, seed), SCRIPTED_PLAN);
  state = startIssue735(state, 0);
  if (arm === 'reserve') {
    for (const move of strategy) {
      state = enqueueReservedMove(state, move.actionId, move.targetTaskId);
    }
    state = resumeIssue735(state);
  } else {
    state = resumeIssue735(state);
    for (const move of strategy) {
      state = requestIssue735Action(state, move.actionId, move.targetTaskId);
    }
  }
  return playOut(state);
}

export function runDeterminismCheck(seed: string = RD_735_DEFAULT_SEED) {
  const a = runIssue735Arm('reserve', seed);
  const b = runIssue735Arm('reserve', seed);
  const summaryA = summarizeIssue735(a);
  const summaryB = summarizeIssue735(b);
  return {
    pass:
      JSON.stringify(summaryA) === JSON.stringify(summaryB) &&
      JSON.stringify(a.logs) === JSON.stringify(b.logs),
    first: summaryA,
    second: summaryB,
  };
}

export function runDoubleSpendCheck(seed: string = RD_735_DEFAULT_SEED) {
  let state = startIssue735(createIssue735Experiment('reserve', seed), 0);
  state.sprint.focus = 2;
  state = enqueueReservedMove(state, 'pairReview');
  state = enqueueReservedMove(state, 'splitPr', 0);
  state = resumeIssue735(state);
  state = playOut(state);
  const summary = summarizeIssue735(state);
  const reserved = summary.reserved;
  const first = reserved[0];
  const second = reserved[1];
  const pass =
    first?.status === 'success' &&
    second?.status === 'fail' &&
    second.failReason === 'no-focus' &&
    summary.focusSpent === 2 &&
    summary.interventionsUsed === 1 &&
    state.sprint.focus === 0;
  return { pass, summary, reserved };
}

export function runDoubleTriggerCheck(seed: string = RD_735_DEFAULT_SEED) {
  let state = startIssue735(createIssue735Experiment('reserve', seed), 0);
  state = enqueueReservedMove(state, 'splitPr', 0);
  state = enqueueReservedMove(state, 'pairReview');
  state = resumeIssue735(state);
  state = requestIssue735Action(state, 'splitPr', 0);
  const splitLogs = state.logs.filter((entry) => entry.actionId === 'splitPr');
  const successes = splitLogs.filter((entry) => entry.result === 'success');
  const cancelled = splitLogs.filter((entry) => entry.reason === 'double-trigger');
  const summary = summarizeIssue735(state);
  const pass =
    successes.length === 1 &&
    cancelled.length >= 1 &&
    (state.sprint.metrics.actionCounts.splitPr ?? 0) === 1 &&
    summary.focusSpent >= 2;
  return {
    pass,
    splitSuccesses: successes.length,
    splitCancelled: cancelled.length,
    splitCount: state.sprint.metrics.actionCounts.splitPr ?? 0,
    focusSpent: summary.focusSpent,
  };
}

export function runTargetDisappearCheck(seed: string = RD_735_DEFAULT_SEED) {
  let state = startIssue735(createIssue735Experiment('reserve', seed), 0);
  state = enqueueReservedMove(state, 'splitPr', 0);
  state = enqueueReservedMove(state, 'pairReview');
  state = disappearIssue735Target(state, 0);
  state = resumeIssue735(state);
  const first = state.reserved[0];
  const second = state.reserved[1];
  const pass =
    first?.status === 'cancelled' &&
    first.cancelReason === 'target-disappeared' &&
    (state.sprint.metrics.actionCounts.splitPr ?? 0) === 0 &&
    state.sprint.focus === state.sprint.config.focusMax &&
    Boolean(second);
  return {
    pass,
    first: first
      ? { status: first.status, cancelReason: first.cancelReason, failReason: first.failReason }
      : null,
    second: second ? { status: second.status } : null,
    splitCount: state.sprint.metrics.actionCounts.splitPr ?? 0,
    focus: state.sprint.focus,
  };
}

export function runManualBlockedWhilePausedCheck(seed: string = RD_735_DEFAULT_SEED) {
  let state = startIssue735(createIssue735Experiment('none', seed), 0);
  state = requestIssue735Action(state, 'splitPr', 0);
  const blocked = state.logs.some(
    (entry) => entry.result === 'paused' && entry.actionId === 'splitPr',
  );
  const pass = blocked && state.sprint.metrics.interventionsUsed === 0 && state.sprint.focus === 6;
  return {
    pass,
    interventionsUsed: state.sprint.metrics.interventionsUsed,
    focus: state.sprint.focus,
  };
}

export function runCancelDoesNotSpendCheck(seed: string = RD_735_DEFAULT_SEED) {
  let state = startIssue735(createIssue735Experiment('reserve', seed), 0);
  state = enqueueReservedMove(state, 'splitPr', 0);
  const id = state.reserved[0]!.id;
  state = cancelReservedMove(state, id);
  state = resumeIssue735(state);
  const pass =
    state.sprint.metrics.interventionsUsed === 0 && state.reserved[0]?.cancelReason === 'cleared';
  return { pass, interventionsUsed: state.sprint.metrics.interventionsUsed };
}

export function runScriptedPassFail(seed: string = RD_735_DEFAULT_SEED) {
  const none = runIssue735Arm('none', seed);
  const reserve = runIssue735Arm('reserve', seed);
  const determinism = runDeterminismCheck(seed);
  const doubleSpend = runDoubleSpendCheck(seed);
  const doubleTrigger = runDoubleTriggerCheck(seed);
  const targetDisappear = runTargetDisappearCheck(seed);
  const pausedBlock = runManualBlockedWhilePausedCheck(seed);
  const cancelSpend = runCancelDoesNotSpendCheck(seed);
  return {
    seed,
    intendedStrategy: 'PR分割(タスク0) → ペアレビュー',
    none: summarizeIssue735(none),
    reserve: summarizeIssue735(reserve),
    checks: {
      determinism,
      doubleSpend,
      doubleTrigger,
      targetDisappear,
      pausedBlock,
      cancelSpend,
    },
    allPass:
      determinism.pass &&
      doubleSpend.pass &&
      doubleTrigger.pass &&
      targetDisappear.pass &&
      pausedBlock.pass &&
      cancelSpend.pass,
  };
}

export function actionLabel(id: Issue735ActionId): string {
  return id === 'splitPr' ? 'PR分割' : 'ペアレビュー';
}

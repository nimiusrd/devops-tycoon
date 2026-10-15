/**
 * #735 R&D throwaway: 停止中に最大2手を予約し、再生時に実行する。
 * 本番の介入効果は `applyAction` / `stepSprint` を呼ぶだけ。バランスも UI も変えない。
 */
import { getAction } from '../../data/actions';
import { applyAction, canApplyAction } from '../../sim/actions';
import { splitPrCandidates } from '../../sim/assignTask';
import { createOrgState } from '../../sim/org';
import { createRng, createRngFromState, getRngState } from '../../sim/rng';
import { createSprint, resolveSprintConfig, stepSprint } from '../../sim/sprint';
import type { ActionTarget, InterventionOutcome, OrgState, SprintState } from '../../sim/types';
import { RD_735_DEFAULT_SEED, type RdArm } from '../resolveRdExperiment';

export const ISSUE_735_ACTIONS = ['splitPr', 'pairReview'] as const;
export type Issue735ActionId = (typeof ISSUE_735_ACTIONS)[number];

export const MAX_RESERVED_MOVES = 2;

export type ReservedMoveStatus = 'queued' | 'success' | 'fail' | 'cancelled';
export type ReservedCancelReason = 'target-disappeared' | 'double-trigger' | 'cleared';

export interface ReservedMove {
  id: string;
  actionId: Issue735ActionId;
  targetTaskId?: number;
  status: ReservedMoveStatus;
  failReason?: InterventionOutcome['reason'];
  cancelReason?: ReservedCancelReason;
  executedTick?: number;
}

export interface ExperimentLogEntry {
  tick: number;
  source: 'manual' | 'reserved' | 'system';
  actionId?: Issue735ActionId;
  targetTaskId?: number;
  result: 'success' | 'fail' | 'cancelled' | 'queued' | 'paused' | 'rejected';
  reason?: string;
}

export interface ExperimentPlan {
  moves: string;
  predicted: string;
}

export interface ExperimentState {
  kind: 'rd-735';
  version: 1;
  seed: string;
  arm: RdArm;
  tick: number;
  paused: boolean;
  started: boolean;
  org: OrgState;
  sprint: SprintState;
  rngState: number;
  reserved: ReservedMove[];
  nextReserveId: number;
  executedKeys: string[];
  logs: ExperimentLogEntry[];
  plan: ExperimentPlan | null;
  feel: 1 | 2 | 3 | 4 | 5 | null;
  wallClockStartedAtMs: number | null;
  wallClockEndedAtMs: number | null;
  pausedAccumulatedMs: number;
  pauseStartedAtMs: number | null;
}

export interface ExperimentSummary {
  ended: boolean;
  tick: number;
  delivered: number;
  doneCount: number;
  focus: number;
  focusSpent: number;
  interventionsUsed: number;
  seniorHp: number;
  morale: number;
  aiLiteracy: number;
  reserved: Array<{
    id: string;
    actionId: Issue735ActionId;
    targetTaskId?: number;
    status: ReservedMoveStatus;
    failReason?: InterventionOutcome['reason'];
    cancelReason?: ReservedCancelReason;
    executedTick?: number;
  }>;
  wallClockMs: number | null;
  wallClockIncludingPauseMs: number | null;
  pausedMs: number | null;
  wallClockExcludingPauseMs: number | null;
}

export interface Issue735Timing {
  wallClockIncludingPauseMs: number | null;
  pausedMs: number | null;
  wallClockExcludingPauseMs: number | null;
}

const ALLOWED = new Set<string>(ISSUE_735_ACTIONS);

export function clampNonNegativeMs(ms: number): number {
  return ms < 0 ? 0 : ms;
}

function accumulatedPausedMs(state: ExperimentState, nowMs: number): number {
  if (state.pauseStartedAtMs == null) return state.pausedAccumulatedMs;
  return state.pausedAccumulatedMs + clampNonNegativeMs(nowMs - state.pauseStartedAtMs);
}

function closeOpenPause(state: ExperimentState, nowMs: number): void {
  if (state.pauseStartedAtMs == null) return;
  state.pausedAccumulatedMs = accumulatedPausedMs(state, nowMs);
  state.pauseStartedAtMs = null;
}

export function measureIssue735Timing(state: ExperimentState, nowMs?: number): Issue735Timing {
  if (state.wallClockStartedAtMs == null) {
    return {
      wallClockIncludingPauseMs: null,
      pausedMs: null,
      wallClockExcludingPauseMs: null,
    };
  }
  const endMs = state.wallClockEndedAtMs ?? nowMs;
  if (endMs == null) {
    return {
      wallClockIncludingPauseMs: null,
      pausedMs: null,
      wallClockExcludingPauseMs: null,
    };
  }
  const including = clampNonNegativeMs(endMs - state.wallClockStartedAtMs);
  const paused = accumulatedPausedMs(state, endMs);
  return {
    wallClockIncludingPauseMs: including,
    pausedMs: paused,
    wallClockExcludingPauseMs: clampNonNegativeMs(including - paused),
  };
}

export function formatIssue735TimingReason(timing: Issue735Timing): string {
  return `timing including=${timing.wallClockIncludingPauseMs} paused=${timing.pausedMs} excluding=${timing.wallClockExcludingPauseMs}`;
}

export function isIssue735Action(id: string): id is Issue735ActionId {
  return ALLOWED.has(id);
}

export function moveKey(actionId: Issue735ActionId, targetTaskId?: number): string {
  return targetTaskId == null ? actionId : `${actionId}:${targetTaskId}`;
}

function cloneState(state: ExperimentState): ExperimentState {
  return structuredClone(state);
}

function makeTask(
  id: number,
  lane: SprintState['tasks'][number]['lane'],
  kind: SprintState['tasks'][number]['kind'],
  extras: Partial<SprintState['tasks'][number]> = {},
): SprintState['tasks'][number] {
  return {
    id,
    kind,
    highValue: kind === 'complex',
    aiAssisted: false,
    lane,
    progress: 0,
    reworkAttempts: 0,
    wasReworked: false,
    incident: false,
    debt: false,
    ...extras,
  };
}

/** 同じseedなら同じ初期盤面。PR分割とペアレビューがすぐ使える短い1スプリント。 */
export function createIssue735Experiment(
  arm: RdArm,
  seed: string = RD_735_DEFAULT_SEED,
): ExperimentState {
  const rng = createRng(seed);
  const org = {
    ...createOrgState('default', true),
    seniorHp: 70,
    morale: 60,
    aiLiteracy: 30,
  };
  const sprint = createSprint(
    resolveSprintConfig('default', {
      taskCount: 6,
      codingSlots: 2,
      maxTicks: 36,
      minCompleteTick: 16,
      focusMax: 6,
    }),
    org,
    rng,
  );
  sprint.tasks = [
    makeTask(0, 'coding', 'complex', { progress: 0.45 }),
    makeTask(1, 'review', 'complex', { progress: 0.2 }),
    makeTask(2, 'review', 'routine', { progress: 0.1 }),
    makeTask(3, 'coding', 'normal', { progress: 0.3, split: true }),
    makeTask(4, 'backlog', 'normal'),
    makeTask(5, 'backlog', 'routine'),
  ];
  sprint.nextTaskId = 6;
  return {
    kind: 'rd-735',
    version: 1,
    seed,
    arm,
    tick: 0,
    paused: true,
    started: false,
    org,
    sprint,
    rngState: getRngState(rng),
    reserved: [],
    nextReserveId: 1,
    executedKeys: [],
    logs: [],
    plan: null,
    feel: null,
    wallClockStartedAtMs: null,
    wallClockEndedAtMs: null,
    pausedAccumulatedMs: 0,
    pauseStartedAtMs: null,
  };
}

export function summarizeIssue735(state: ExperimentState): ExperimentSummary {
  const metrics = state.sprint.metrics;
  const timing = measureIssue735Timing(state);
  return {
    ended: state.sprint.complete || state.tick >= state.sprint.config.maxTicks,
    tick: state.tick,
    delivered: Math.round(metrics.delivered * 100) / 100,
    doneCount: metrics.doneCount,
    focus: state.sprint.focus,
    focusSpent: metrics.focusSpent,
    interventionsUsed: metrics.interventionsUsed,
    seniorHp: Math.round(state.org.seniorHp * 100) / 100,
    morale: Math.round(state.org.morale * 100) / 100,
    aiLiteracy: Math.round(state.org.aiLiteracy * 100) / 100,
    reserved: state.reserved.map((move) => ({
      id: move.id,
      actionId: move.actionId,
      targetTaskId: move.targetTaskId,
      status: move.status,
      failReason: move.failReason,
      cancelReason: move.cancelReason,
      executedTick: move.executedTick,
    })),
    wallClockMs: timing.wallClockIncludingPauseMs,
    wallClockIncludingPauseMs: timing.wallClockIncludingPauseMs,
    pausedMs: timing.pausedMs,
    wallClockExcludingPauseMs: timing.wallClockExcludingPauseMs,
  };
}

export function recordIssue735Plan(state: ExperimentState, plan: ExperimentPlan): ExperimentState {
  if (state.started) return state;
  return {
    ...cloneState(state),
    plan: { moves: plan.moves.trim(), predicted: plan.predicted.trim() },
  };
}

export function startIssue735(state: ExperimentState, nowMs: number): ExperimentState {
  if (state.started) return state;
  const next = cloneState(state);
  next.started = true;
  next.paused = true;
  next.wallClockStartedAtMs = nowMs;
  next.pausedAccumulatedMs = 0;
  next.pauseStartedAtMs = nowMs;
  next.logs.push({ tick: next.tick, source: 'system', result: 'paused', reason: 'start-paused' });
  return next;
}

export function setIssue735Feel(state: ExperimentState, feel: 1 | 2 | 3 | 4 | 5): ExperimentState {
  return { ...cloneState(state), feel };
}

export function pauseIssue735(state: ExperimentState, nowMs?: number): ExperimentState {
  if (!state.started || state.paused || summarizeIssue735(state).ended) return state;
  const next = cloneState(state);
  next.paused = true;
  if (nowMs != null && next.pauseStartedAtMs == null) {
    next.pauseStartedAtMs = nowMs;
  }
  next.logs.push({ tick: next.tick, source: 'system', result: 'paused', reason: 'player-pause' });
  return next;
}

function finishIfEnded(state: ExperimentState, nowMs?: number): void {
  if (!summarizeIssue735(state).ended) return;
  if (state.wallClockEndedAtMs != null || nowMs == null) return;
  closeOpenPause(state, nowMs);
  state.wallClockEndedAtMs = nowMs;
  state.logs.push({
    tick: state.tick,
    source: 'system',
    result: 'success',
    reason: formatIssue735TimingReason(measureIssue735Timing(state, nowMs)),
  });
}

function queuedMoves(state: ExperimentState): ReservedMove[] {
  return state.reserved.filter((move) => move.status === 'queued');
}

function targetStillValid(
  sprint: SprintState,
  actionId: Issue735ActionId,
  targetTaskId?: number,
): boolean {
  if (actionId === 'pairReview') return true;
  if (targetTaskId == null) return splitPrCandidates(sprint).length > 0;
  return splitPrCandidates(sprint).some((task) => task.id === targetTaskId);
}

function toTarget(targetTaskId?: number): ActionTarget | undefined {
  return targetTaskId == null ? undefined : { taskId: targetTaskId };
}

function applyAllowedAction(
  state: ExperimentState,
  actionId: Issue735ActionId,
  targetTaskId: number | undefined,
): InterventionOutcome {
  const rng = createRngFromState(state.rngState);
  const outcome = applyAction(
    actionId,
    state.sprint,
    state.org,
    rng,
    state.tick,
    toTarget(targetTaskId),
  );
  state.rngState = getRngState(rng);
  return outcome;
}

function executeOnce(
  state: ExperimentState,
  source: 'manual' | 'reserved',
  actionId: Issue735ActionId,
  targetTaskId: number | undefined,
  reserved?: ReservedMove,
): ExperimentLogEntry {
  const key = moveKey(actionId, targetTaskId);
  if (state.executedKeys.includes(key)) {
    if (reserved) {
      reserved.status = 'cancelled';
      reserved.cancelReason = 'double-trigger';
      reserved.executedTick = state.tick;
    }
    const entry: ExperimentLogEntry = {
      tick: state.tick,
      source,
      actionId,
      targetTaskId,
      result: 'cancelled',
      reason: 'double-trigger',
    };
    state.logs.push(entry);
    return entry;
  }
  if (!targetStillValid(state.sprint, actionId, targetTaskId)) {
    if (reserved) {
      reserved.status = 'cancelled';
      reserved.cancelReason = 'target-disappeared';
      reserved.executedTick = state.tick;
    }
    const entry: ExperimentLogEntry = {
      tick: state.tick,
      source,
      actionId,
      targetTaskId,
      result: 'cancelled',
      reason: 'target-disappeared',
    };
    state.logs.push(entry);
    return entry;
  }

  const outcome = applyAllowedAction(state, actionId, targetTaskId);
  if (outcome.ok) {
    state.executedKeys.push(key);
    if (reserved) {
      reserved.status = 'success';
      reserved.executedTick = state.tick;
    }
    const entry: ExperimentLogEntry = {
      tick: state.tick,
      source,
      actionId,
      targetTaskId,
      result: 'success',
    };
    state.logs.push(entry);
    return entry;
  }

  if (reserved) {
    reserved.status = 'fail';
    reserved.failReason = outcome.reason;
    reserved.executedTick = state.tick;
  }
  const entry: ExperimentLogEntry = {
    tick: state.tick,
    source,
    actionId,
    targetTaskId,
    result: 'fail',
    reason: outcome.reason,
  };
  state.logs.push(entry);
  return entry;
}

function flushNextReserved(state: ExperimentState): void {
  const next = queuedMoves(state)[0];
  if (!next) return;
  executeOnce(state, 'reserved', next.actionId, next.targetTaskId, next);
}

export function resumeIssue735(state: ExperimentState, nowMs?: number): ExperimentState {
  if (!state.started || !state.paused || summarizeIssue735(state).ended) return state;
  const next = cloneState(state);
  if (nowMs != null) closeOpenPause(next, nowMs);
  next.paused = false;
  next.logs.push({ tick: next.tick, source: 'system', result: 'success', reason: 'resume' });
  if (next.arm === 'reserve') flushNextReserved(next);
  return next;
}

export function tickIssue735(state: ExperimentState, nowMs?: number): ExperimentState {
  if (!state.started || state.paused || summarizeIssue735(state).ended) return state;
  const next = cloneState(state);
  const rng = createRngFromState(next.rngState);
  next.tick += 1;
  stepSprint(next.sprint, next.org, rng, next.tick);
  next.rngState = getRngState(rng);
  if (next.arm === 'reserve') flushNextReserved(next);
  finishIfEnded(next, nowMs);
  return next;
}

export function enqueueReservedMove(
  state: ExperimentState,
  actionId: Issue735ActionId,
  targetTaskId?: number,
): ExperimentState {
  if (!state.started || state.arm !== 'reserve') return state;
  if (!state.paused) return state;
  if (summarizeIssue735(state).ended) return state;
  if (queuedMoves(state).length >= MAX_RESERVED_MOVES) {
    const next = cloneState(state);
    next.logs.push({
      tick: next.tick,
      source: 'system',
      actionId,
      targetTaskId,
      result: 'rejected',
      reason: 'queue-full',
    });
    return next;
  }
  const next = cloneState(state);
  const move: ReservedMove = {
    id: `r${next.nextReserveId}`,
    actionId,
    targetTaskId,
    status: 'queued',
  };
  next.nextReserveId += 1;
  next.reserved.push(move);
  next.logs.push({
    tick: next.tick,
    source: 'reserved',
    actionId,
    targetTaskId,
    result: 'queued',
  });
  return next;
}

export function cancelReservedMove(state: ExperimentState, moveId: string): ExperimentState {
  const index = state.reserved.findIndex((move) => move.id === moveId && move.status === 'queued');
  if (index < 0) return state;
  const next = cloneState(state);
  const move = next.reserved[index]!;
  move.status = 'cancelled';
  move.cancelReason = 'cleared';
  next.logs.push({
    tick: next.tick,
    source: 'system',
    actionId: move.actionId,
    targetTaskId: move.targetTaskId,
    result: 'cancelled',
    reason: 'cleared',
  });
  return next;
}

export function moveReserved(
  state: ExperimentState,
  moveId: string,
  direction: -1 | 1,
): ExperimentState {
  const queued = state.reserved
    .map((move, index) => ({ move, index }))
    .filter((entry) => entry.move.status === 'queued');
  const from = queued.findIndex((entry) => entry.move.id === moveId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= queued.length) return state;
  const next = cloneState(state);
  const a = queued[from]!.index;
  const b = queued[to]!.index;
  const tmp = next.reserved[a]!;
  next.reserved[a] = next.reserved[b]!;
  next.reserved[b] = tmp;
  return next;
}

export function requestIssue735Action(
  state: ExperimentState,
  actionId: Issue735ActionId,
  targetTaskId?: number,
): ExperimentState {
  if (!state.started || summarizeIssue735(state).ended) return state;
  if (!isIssue735Action(actionId)) return state;

  if (state.paused) {
    if (state.arm === 'reserve') return enqueueReservedMove(state, actionId, targetTaskId);
    const next = cloneState(state);
    next.logs.push({
      tick: next.tick,
      source: 'manual',
      actionId,
      targetTaskId,
      result: 'paused',
      reason: 'paused',
    });
    return next;
  }

  const next = cloneState(state);
  const key = moveKey(actionId, targetTaskId);
  const colliding = queuedMoves(next).find(
    (move) => moveKey(move.actionId, move.targetTaskId) === key,
  );
  if (colliding) {
    colliding.status = 'cancelled';
    colliding.cancelReason = 'double-trigger';
    colliding.executedTick = next.tick;
    next.logs.push({
      tick: next.tick,
      source: 'reserved',
      actionId,
      targetTaskId,
      result: 'cancelled',
      reason: 'double-trigger',
    });
  }
  executeOnce(next, 'manual', actionId, targetTaskId);
  return next;
}

/** 予約対象が実行前に消えた状況を、スクリプトログ用に盤面へ起こす。 */
export function disappearIssue735Target(state: ExperimentState, taskId: number): ExperimentState {
  const next = cloneState(state);
  const task = next.sprint.tasks.find((item) => item.id === taskId);
  if (!task) return state;
  task.lane = 'done';
  task.split = true;
  task.progress = 1;
  next.logs.push({
    tick: next.tick,
    source: 'system',
    targetTaskId: taskId,
    result: 'cancelled',
    reason: 'target-forced-gone',
  });
  return next;
}

export function previewReservedQueue(state: ExperimentState): Array<{
  id: string;
  actionId: Issue735ActionId;
  targetTaskId?: number;
  focusCost: number;
  cooldownTicks: number;
  targetOk: boolean;
  predicted: 'success' | 'fail' | 'cancelled';
  reason?: string;
}> {
  const sim = cloneState(state);
  return queuedMoves(state).map((move) => {
    const def = getAction(move.actionId);
    const focusCost = def?.cost ?? 0;
    const cooldownTicks = def?.cooldownTicks ?? 0;
    if (sim.executedKeys.includes(moveKey(move.actionId, move.targetTaskId))) {
      return {
        id: move.id,
        actionId: move.actionId,
        targetTaskId: move.targetTaskId,
        focusCost,
        cooldownTicks,
        targetOk: false,
        predicted: 'cancelled',
        reason: 'double-trigger',
      };
    }
    if (!targetStillValid(sim.sprint, move.actionId, move.targetTaskId)) {
      return {
        id: move.id,
        actionId: move.actionId,
        targetTaskId: move.targetTaskId,
        focusCost,
        cooldownTicks,
        targetOk: false,
        predicted: 'cancelled',
        reason: 'target-disappeared',
      };
    }
    const gate = canApplyAction(
      move.actionId,
      sim.sprint,
      sim.org,
      sim.tick,
      toTarget(move.targetTaskId),
    );
    if (!gate.ok) {
      return {
        id: move.id,
        actionId: move.actionId,
        targetTaskId: move.targetTaskId,
        focusCost,
        cooldownTicks,
        targetOk: gate.reason !== 'no-target',
        predicted: 'fail',
        reason: gate.reason,
      };
    }
    applyAllowedAction(sim, move.actionId, move.targetTaskId);
    sim.executedKeys.push(moveKey(move.actionId, move.targetTaskId));
    return {
      id: move.id,
      actionId: move.actionId,
      targetTaskId: move.targetTaskId,
      focusCost,
      cooldownTicks,
      targetOk: true,
      predicted: 'success',
    };
  });
}

export const INTENDED_STRATEGY = [
  { actionId: 'splitPr' as const, targetTaskId: 0 },
  { actionId: 'pairReview' as const },
];

/** RI-220: 小PR憲章を1件だけ破る。RI-219 の禁止判定を共用する。 */

import { charterBlocks, SMALL_PR_LIMIT } from './smallPrCharter';

export type ExceptionBoard = 'deadline' | 'precedent';
export type ExceptionStrategy = 'hold' | 'except';
export type ExceptionInput =
  | { type: 'except' }
  | { type: 'ship-urgent' }
  | { type: 'ship' }
  | { type: 'ship-large' }
  | { type: 'wait' }
  | { type: 'view' };

export interface ExceptionState {
  version: 1;
  seed: string;
  board: ExceptionBoard;
  tick: number;
  horizon: number;
  charter: boolean;
  limit: typeof SMALL_PR_LIMIT;
  urgentSize: number;
  urgentValue: number;
  urgentDeadline: 0;
  urgentDone: boolean;
  urgentExpired: boolean;
  ordinaryValue: number;
  followUpCost: number;
  followUpTick: 3;
  followUpApplied: boolean;
  exceptionUsed: boolean;
  exceptionTick: number | null;
  value: number;
  trustCost: number;
  inputs: ExceptionInput[];
}

const PRESET: Record<ExceptionBoard, { urgent: number; followUp: number }> = {
  deadline: { urgent: 12, followUp: 4 },
  precedent: { urgent: 6, followUp: 8 },
};

export function createCharterException(seed: string, board: ExceptionBoard): ExceptionState {
  const preset = PRESET[board];
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 4,
    charter: true,
    limit: SMALL_PR_LIMIT,
    urgentSize: 4,
    urgentValue: preset.urgent,
    urgentDeadline: 0,
    urgentDone: false,
    urgentExpired: false,
    ordinaryValue: 3,
    followUpCost: preset.followUp,
    followUpTick: 3,
    followUpApplied: false,
    exceptionUsed: false,
    exceptionTick: null,
    value: 0,
    trustCost: 0,
    inputs: [],
  };
}

function expireAndFollowUp(state: ExceptionState): void {
  if (!state.urgentDone && state.tick > state.urgentDeadline) state.urgentExpired = true;
  if (state.exceptionUsed && state.tick === state.followUpTick && !state.followUpApplied) {
    state.trustCost += state.followUpCost;
    state.followUpApplied = true;
  }
}

export function applyCharterException(
  state: ExceptionState,
  input: ExceptionInput,
): ExceptionState {
  if (input.type === 'view') return state;
  if (state.tick >= state.horizon) return state;
  if (input.type === 'except') {
    if (
      !charterBlocks(state.charter, state.urgentSize) ||
      state.exceptionUsed ||
      state.urgentDone ||
      state.urgentExpired ||
      state.tick > state.urgentDeadline
    ) {
      return state;
    }
    const next = structuredClone(state);
    next.urgentDone = true;
    next.exceptionUsed = true;
    next.exceptionTick = state.tick;
    next.value += next.urgentValue;
    next.tick += 1;
    next.inputs.push({ type: 'except' });
    expireAndFollowUp(next);
    return next;
  }
  if (input.type === 'ship-urgent') {
    if (
      charterBlocks(state.charter, state.urgentSize) ||
      state.urgentDone ||
      state.urgentExpired ||
      state.tick > state.urgentDeadline
    ) {
      return state;
    }
    const next = structuredClone(state);
    next.urgentDone = true;
    next.value += next.urgentValue;
    next.tick += 1;
    next.inputs.push({ type: 'ship-urgent' });
    expireAndFollowUp(next);
    return next;
  }
  if (input.type === 'ship-large') {
    if (charterBlocks(state.charter, state.urgentSize)) return state;
    const next = structuredClone(state);
    next.value += 20;
    next.tick += 1;
    next.inputs.push({ type: 'ship-large' });
    expireAndFollowUp(next);
    return next;
  }
  if (input.type !== 'ship' && input.type !== 'wait') return state;
  const next = structuredClone(state);
  if (input.type === 'ship') next.value += next.ordinaryValue;
  next.tick += 1;
  next.inputs.push(input.type === 'ship' ? { type: 'ship' } : { type: 'wait' });
  expireAndFollowUp(next);
  return next;
}

function scheduledFollowUp(state: ExceptionState): number | null {
  if (state.followUpApplied) return null;
  const stillPossible =
    state.exceptionUsed ||
    (charterBlocks(state.charter, state.urgentSize) &&
      !state.urgentDone &&
      !state.urgentExpired &&
      state.tick <= state.urgentDeadline);
  return stillPossible ? state.followUpCost : null;
}

export function viewCharterException(state: ExceptionState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    charter: state.charter,
    limit: state.charter ? state.limit : null,
    brokenFor:
      state.exceptionTick === null ? null : 'tick ' + String(state.exceptionTick) + ' の1期間',
    urgent: {
      size: state.urgentSize,
      done: state.urgentDone,
      expired: state.urgentExpired,
      deadline: state.urgentDeadline,
      blocked:
        charterBlocks(state.charter, state.urgentSize) && !state.urgentDone && !state.urgentExpired,
    },
    followUp: {
      tick: state.followUpTick,
      applied: state.followUpApplied,
      trustCost: state.trustCost,
      scheduledCost: scheduledFollowUp(state),
    },
    blockedLarge: charterBlocks(state.charter, state.urgentSize),
  };
}

export function summarizeCharterException(state: ExceptionState) {
  return {
    value: state.value,
    trustCost: state.trustCost,
    score: state.value - state.trustCost,
    exceptionUsed: state.exceptionUsed,
    exceptionTick: state.exceptionTick,
    followUpApplied: state.followUpApplied,
    urgentDone: state.urgentDone,
    urgentExpired: state.urgentExpired,
    lost: false,
  };
}

export function chooseExceptionAction(
  state: ExceptionState,
  strategy: ExceptionStrategy,
): ExceptionInput {
  if (
    strategy === 'except' &&
    !state.exceptionUsed &&
    !state.urgentDone &&
    !state.urgentExpired &&
    state.tick <= state.urgentDeadline
  ) {
    return charterBlocks(state.charter, state.urgentSize)
      ? { type: 'except' }
      : { type: 'ship-urgent' };
  }
  return { type: 'ship' };
}

export function compareCharterExceptions(seed = 'RI-220') {
  return (['deadline', 'precedent'] as const).flatMap((board) =>
    (['hold', 'except'] as const).map((strategy) => {
      const initial = createCharterException(seed, board);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 20) throw new Error(`${board}:${strategy}`);
        const input = chooseExceptionAction(state, strategy);
        const next = applyCharterException(state, input);
        if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
        state = next;
      }
      return {
        board,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeCharterException(state),
      };
    }),
  );
}

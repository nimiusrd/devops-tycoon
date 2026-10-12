/** RI-246: 割り込みは仕事として残り、選択しただけでは出荷にならない。 */

export type InterruptBoard = 'slack' | 'cramped';
export type InterruptStrategy = 'accept' | 'decline';
export type InterruptInput =
  { type: 'view' } | { type: 'accept' } | { type: 'decline' } | { type: 'work' };

export interface InterruptPeriod {
  tick: number;
  action: 'accept' | 'decline' | 'work';
  interruptCleared: number;
  plannedCleared: number;
  value: number;
}

export interface InterruptState {
  version: 1;
  seed: string;
  board: InterruptBoard;
  tick: number;
  horizon: number;
  capacity: number;
  plannedTotal: number;
  plannedLeft: number;
  plannedDone: number;
  plannedValue: number;
  interruptTotal: number;
  interruptLeft: number;
  interruptDone: number;
  interruptValue: number;
  bonus: number;
  bonusPaid: boolean;
  trustCost: number;
  trust: number;
  accepted: boolean | null;
  value: number;
  periods: InterruptPeriod[];
  inputs: InterruptInput[];
}

const CAPACITY = 4;
const PLANNED_TOTAL = 6;
const PLANNED_VALUE = 5;
const INTERRUPT_TOTAL = 4;
const INTERRUPT_VALUE = 3;
const BONUS = 14;
const TRUST_COST = 6;
const WORK_TICKS: Record<InterruptBoard, number> = { slack: 3, cramped: 2 };

function scoreOf(state: InterruptState): number {
  return state.value - state.trust;
}

function pushPeriod(
  state: InterruptState,
  action: InterruptPeriod['action'],
  interruptCleared: number,
  plannedCleared: number,
) {
  state.periods.push({
    tick: state.tick,
    action,
    interruptCleared,
    plannedCleared,
    value: scoreOf(state),
  });
  state.tick += 1;
}

export function createCustomerInterrupt(seed: string, board: InterruptBoard): InterruptState {
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: WORK_TICKS[board] + 1,
    capacity: CAPACITY,
    plannedTotal: PLANNED_TOTAL,
    plannedLeft: PLANNED_TOTAL,
    plannedDone: 0,
    plannedValue: PLANNED_VALUE,
    interruptTotal: INTERRUPT_TOTAL,
    interruptLeft: INTERRUPT_TOTAL,
    interruptDone: 0,
    interruptValue: INTERRUPT_VALUE,
    bonus: BONUS,
    bonusPaid: false,
    trustCost: TRUST_COST,
    trust: 0,
    accepted: null,
    value: 0,
    periods: [],
    inputs: [],
  };
}

export function applyCustomerInterrupt(
  state: InterruptState,
  input: InterruptInput,
): InterruptState {
  if (input.type === 'view') return state;
  if (input.type === 'accept' || input.type === 'decline') {
    if (state.accepted !== null || state.tick !== 0) return state;
    const next = structuredClone(state);
    next.accepted = input.type === 'accept';
    if (!next.accepted) {
      next.trust += next.trustCost;
      next.interruptLeft = 0;
    }
    pushPeriod(next, input.type, 0, 0);
    next.inputs.push({ type: input.type });
    return next;
  }
  if (state.accepted === null || state.tick >= state.horizon) return state;
  const next = structuredClone(state);
  let room = next.capacity;
  let interruptCleared = 0;
  if (next.accepted) {
    interruptCleared = Math.min(room, next.interruptLeft);
    next.interruptLeft -= interruptCleared;
    next.interruptDone += interruptCleared;
    next.value += interruptCleared * next.interruptValue;
    room -= interruptCleared;
  }
  const plannedCleared = Math.min(room, next.plannedLeft);
  next.plannedLeft -= plannedCleared;
  next.plannedDone += plannedCleared;
  next.value += plannedCleared * next.plannedValue;
  if (!next.bonusPaid && next.plannedLeft === 0) {
    next.value += next.bonus;
    next.bonusPaid = true;
  }
  pushPeriod(next, 'work', interruptCleared, plannedCleared);
  next.inputs.push({ type: 'work' });
  return next;
}

export function summarizeCustomerInterrupt(state: InterruptState) {
  return {
    value: state.value,
    trust: state.trust,
    score: scoreOf(state),
    plannedDone: state.plannedDone,
    plannedLeft: state.plannedLeft,
    interruptDone: state.interruptDone,
    bonusPaid: state.bonusPaid,
    accepted: state.accepted === true,
    path: state.periods.map((period) => period.value),
    cleared: state.periods.map((period) => period.interruptCleared + period.plannedCleared),
    lost: false,
  };
}

export function chooseInterruptAction(
  state: InterruptState,
  strategy: InterruptStrategy,
): InterruptInput {
  if (state.tick >= state.horizon) return { type: 'view' };
  if (state.accepted === null) return { type: strategy };
  return { type: 'work' };
}

function runInterrupt(seed: string, board: InterruptBoard, strategy: InterruptStrategy) {
  const initial = createCustomerInterrupt(seed, board);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 8) throw new Error(`${board}:${strategy}`);
    const input = chooseInterruptAction(state, strategy);
    const next = applyCustomerInterrupt(state, input);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { initial, inputs: state.inputs, result: summarizeCustomerInterrupt(state) };
}

export function compareCustomerInterrupts(seed = 'RI-246') {
  return (['slack', 'cramped'] as const).flatMap((board) =>
    (['accept', 'decline'] as const).map((strategy) => ({
      board,
      strategy,
      ...runInterrupt(seed, board, strategy),
    })),
  );
}

function preview(state: InterruptState, strategy: InterruptStrategy) {
  let cursor = structuredClone(state);
  let guard = 0;
  while (cursor.tick < cursor.horizon) {
    if (++guard > 8) break;
    const next = applyCustomerInterrupt(cursor, chooseInterruptAction(cursor, strategy));
    if (next === cursor) break;
    cursor = next;
  }
  const summary = summarizeCustomerInterrupt(cursor);
  return {
    strategy,
    score: summary.score,
    plannedDone: summary.plannedDone,
    interruptDone: summary.interruptDone,
    bonusPaid: summary.bonusPaid,
    trust: summary.trust,
  };
}

export function viewCustomerInterrupt(state: InterruptState) {
  return {
    tick: state.tick,
    board: state.board,
    capacity: state.capacity,
    workTicks: state.horizon - 1,
    reason: 'customer-interrupt',
    helpsWhen: 'three-work-ticks',
    hindersWhen: 'two-work-ticks',
    planned: { left: state.plannedLeft, total: state.plannedTotal, valuePer: state.plannedValue },
    interrupt: {
      left: state.interruptLeft,
      total: state.interruptTotal,
      valuePer: state.interruptValue,
    },
    bonus: state.bonus,
    trustCost: state.trustCost,
    accepted: state.accepted,
    choices: state.accepted === null ? (['accept', 'decline'] as const) : [],
    forecasts:
      state.accepted === null
        ? (['accept', 'decline'] as const).map((strategy) => preview(state, strategy))
        : [],
  };
}

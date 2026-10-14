/** RI-243: 四半期内の返済記録だけを交渉材料にする。現在値の低さは実績にしない。 */

export type NegotiationBoard = 'loose' | 'tight' | 'healthy';
export type NegotiationStrategy = 'ship' | 'bargain';
export type NegotiationInput =
  | { type: 'view' }
  | { type: 'ship' }
  | { type: 'repay' }
  | { type: 'note' }
  | { type: 'negotiate' }
  | { type: 'pass' };

export interface NegotiationEntry {
  tick: number;
  kind: 'repay';
  amount: number;
}

export interface NegotiationPeriod {
  tick: number;
  action: 'ship' | 'repay' | 'negotiate' | 'pass';
  delivery: number;
  nextTarget: number;
  value: number;
}

export interface NegotiationState {
  version: 1;
  seed: string;
  board: NegotiationBoard;
  tick: number;
  horizon: number;
  debt: number;
  delivery: number;
  trust: number;
  nextTarget: number;
  nextCapacity: number;
  relief: number;
  trustCost: number;
  penaltyPer: number;
  shipValue: number;
  repayValue: number;
  repayAmount: number;
  entries: NegotiationEntry[];
  negotiated: boolean;
  closed: boolean;
  skippedRepay: boolean;
  skippedOffer: boolean;
  periods: NegotiationPeriod[];
  inputs: NegotiationInput[];
}

const NEXT_CAPACITY = 8;
const RELIEF = 4;
const TRUST_COST = 2;
const PENALTY_PER = 3;
const SHIP_VALUE = 4;
const REPAY_VALUE = 1;
const REPAY_AMOUNT = 3;
const REQUIRED_RECORD = 3;

function boardSetup(board: NegotiationBoard): { debt: number; nextTarget: number } {
  if (board === 'loose') return { debt: 6, nextTarget: 8 };
  if (board === 'tight') return { debt: 6, nextTarget: 14 };
  return { debt: 0, nextTarget: 14 };
}

function recorded(state: NegotiationState): number {
  return state.entries.reduce((sum, entry) => sum + entry.amount, 0);
}

function unmet(state: NegotiationState): number {
  return Math.max(0, state.nextTarget - state.nextCapacity);
}

function scoreOf(state: NegotiationState): number {
  return state.delivery - state.trust - unmet(state) * state.penaltyPer;
}

function pushPeriod(state: NegotiationState, action: NegotiationPeriod['action']) {
  state.periods.push({
    tick: state.tick,
    action,
    delivery: state.delivery,
    nextTarget: state.nextTarget,
    value: scoreOf(state),
  });
  state.tick += 1;
}

export function createNegotiationRecord(seed: string, board: NegotiationBoard): NegotiationState {
  const setup = boardSetup(board);
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 3,
    debt: setup.debt,
    delivery: 0,
    trust: 0,
    nextTarget: setup.nextTarget,
    nextCapacity: NEXT_CAPACITY,
    relief: RELIEF,
    trustCost: TRUST_COST,
    penaltyPer: PENALTY_PER,
    shipValue: SHIP_VALUE,
    repayValue: REPAY_VALUE,
    repayAmount: REPAY_AMOUNT,
    entries: [],
    negotiated: false,
    closed: false,
    skippedRepay: false,
    skippedOffer: false,
    periods: [],
    inputs: [],
  };
}

export function applyNegotiationRecord(
  state: NegotiationState,
  input: NegotiationInput,
): NegotiationState {
  if (input.type === 'view') return state;
  if (input.type === 'note') {
    if (state.skippedRepay || state.tick >= 2 || state.debt >= state.repayAmount) return state;
    const next = structuredClone(state);
    next.skippedRepay = true;
    next.inputs.push({ type: 'note' });
    return next;
  }
  if (input.type === 'ship') {
    if (state.tick >= 2 || state.closed) return state;
    const next = structuredClone(state);
    next.delivery += next.shipValue;
    pushPeriod(next, 'ship');
    next.inputs.push({ type: 'ship' });
    return next;
  }
  if (input.type === 'repay') {
    if (state.tick >= 2 || state.closed || state.debt < state.repayAmount) return state;
    const next = structuredClone(state);
    next.delivery += next.repayValue;
    next.debt -= next.repayAmount;
    next.entries.push({ tick: next.tick, kind: 'repay', amount: next.repayAmount });
    pushPeriod(next, 'repay');
    next.inputs.push({ type: 'repay' });
    return next;
  }
  if (input.type === 'negotiate') {
    if (state.tick !== 2 || state.closed || recorded(state) < REQUIRED_RECORD) return state;
    const next = structuredClone(state);
    next.trust += next.trustCost;
    next.nextTarget -= next.relief;
    next.negotiated = true;
    next.closed = true;
    pushPeriod(next, 'negotiate');
    next.inputs.push({ type: 'negotiate' });
    return next;
  }
  if (state.tick !== 2 || state.closed) return state;
  const next = structuredClone(state);
  next.closed = true;
  next.skippedOffer = recorded(state) < REQUIRED_RECORD;
  pushPeriod(next, 'pass');
  next.inputs.push({ type: 'pass' });
  return next;
}

export function summarizeNegotiationRecord(state: NegotiationState) {
  return {
    delivery: state.delivery,
    trust: state.trust,
    debt: state.debt,
    nextTarget: state.nextTarget,
    unmet: unmet(state),
    recorded: recorded(state),
    score: scoreOf(state),
    path: state.periods.map((period) => period.value),
    actions: state.periods.map((period) => period.action),
    negotiated: state.negotiated,
    skippedRepay: state.skippedRepay,
    skippedOffer: state.skippedOffer,
    lost: false,
  };
}

export function chooseNegotiationAction(
  state: NegotiationState,
  strategy: NegotiationStrategy,
): NegotiationInput {
  if (state.tick >= state.horizon || state.closed) return { type: 'view' };
  if (state.tick < 2) {
    if (strategy === 'bargain' && recorded(state) === 0 && !state.skippedRepay) {
      if (state.debt >= state.repayAmount) return { type: 'repay' };
      return { type: 'note' };
    }
    return { type: 'ship' };
  }
  if (strategy === 'bargain' && recorded(state) >= REQUIRED_RECORD) return { type: 'negotiate' };
  return { type: 'pass' };
}

function runNegotiation(seed: string, board: NegotiationBoard, strategy: NegotiationStrategy) {
  const initial = createNegotiationRecord(seed, board);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 8) throw new Error(`${board}:${strategy}`);
    const input = chooseNegotiationAction(state, strategy);
    const next = applyNegotiationRecord(state, input);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { initial, inputs: state.inputs, result: summarizeNegotiationRecord(state) };
}

export function compareNegotiationRecords(seed = 'RI-243') {
  return (['loose', 'tight', 'healthy'] as const).flatMap((board) =>
    (['ship', 'bargain'] as const).map((strategy) => ({
      board,
      strategy,
      ...runNegotiation(seed, board, strategy),
    })),
  );
}

function preview(state: NegotiationState, strategy: NegotiationStrategy) {
  let cursor = structuredClone(state);
  let guard = 0;
  while (cursor.tick < cursor.horizon) {
    if (++guard > 8) break;
    const next = applyNegotiationRecord(cursor, chooseNegotiationAction(cursor, strategy));
    if (next === cursor) break;
    cursor = next;
  }
  const summary = summarizeNegotiationRecord(cursor);
  return {
    strategy,
    delivery: summary.delivery,
    trust: summary.trust,
    nextTarget: summary.nextTarget,
    recorded: summary.recorded,
    score: summary.score,
    negotiated: summary.negotiated,
  };
}

export function viewNegotiationRecord(state: NegotiationState) {
  const amount = recorded(state);
  const qualified = amount >= REQUIRED_RECORD;
  const reason = qualified
    ? null
    : state.debt === 0 && amount === 0
      ? 'current-value-is-not-a-record'
      : 'no-quarter-record';
  return {
    tick: state.tick,
    debt: state.debt,
    delivery: state.delivery,
    recorded: amount,
    qualified,
    reason,
    nextTarget: state.nextTarget,
    nextCapacity: state.nextCapacity,
    offer:
      state.tick === 2 && qualified && !state.closed
        ? {
            relief: state.relief,
            trust: state.trustCost,
            nextTarget: state.nextTarget - state.relief,
          }
        : null,
    forecasts:
      state.tick === 0 && state.entries.length === 0 && state.delivery === 0
        ? (['ship', 'bargain'] as const).map((strategy) => preview(state, strategy))
        : [],
  };
}

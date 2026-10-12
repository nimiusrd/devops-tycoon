/** RI-237: 支給方式は一度だけ選び、未達の残額は返済しない。融資と利子は扱わない。 */

export type FundingMethod = 'advance' | 'staged' | 'conditional';
export type FundingBoard = 'early' | 'late';
export type FundingCondition = 'none' | 'previous-paid' | 'first-two-paid';
export type FundingInput =
  { type: 'choose'; method: FundingMethod } | { type: 'advance' } | { type: 'view' };

export interface FundingOffer {
  method: FundingMethod;
  total: number;
  schedule: number[];
  condition: FundingCondition;
  repayment: 0;
}

export interface FundingPeriod {
  tick: number;
  disbursed: number;
  cost: number;
  paid: boolean;
  cash: number;
  unpaid: number;
}

export interface BudgetState {
  version: 1;
  seed: string;
  board: FundingBoard;
  tick: number;
  horizon: number;
  startCash: number;
  completionValue: number;
  costs: number[];
  offers: FundingOffer[];
  method: FundingMethod | null;
  cash: number;
  received: number;
  unpaid: number;
  repayment: 0;
  shortfall: number;
  paid: boolean[];
  complete: boolean;
  periods: FundingPeriod[];
  inputs: FundingInput[];
}

const START_CASH = 3;
const COMPLETION = 10;
const COSTS: Record<FundingBoard, number[]> = {
  early: [8, 1, 1, 1],
  late: [1, 1, 1, 12],
};

const OFFERS: readonly FundingOffer[] = [
  { method: 'advance', total: 8, schedule: [8, 0, 0, 0], condition: 'none', repayment: 0 },
  { method: 'staged', total: 12, schedule: [3, 3, 3, 3], condition: 'previous-paid', repayment: 0 },
  {
    method: 'conditional',
    total: 16,
    schedule: [0, 0, 16, 0],
    condition: 'first-two-paid',
    repayment: 0,
  },
];

function isMethod(value: string): value is FundingMethod {
  return value === 'advance' || value === 'staged' || value === 'conditional';
}

function offerOf(offers: readonly FundingOffer[], method: FundingMethod): FundingOffer {
  const offer = offers.find((item) => item.method === method);
  if (!offer) throw new Error(method);
  return offer;
}

function previousPaid(paid: readonly boolean[], tick: number): boolean {
  return paid.slice(0, tick).every(Boolean);
}

function eligible(state: BudgetState, method: FundingMethod, tick: number): boolean {
  const offer = offerOf(state.offers, method);
  if ((offer.schedule[tick] ?? 0) <= 0) return false;
  if (offer.condition === 'none') return true;
  if (offer.condition === 'previous-paid') return previousPaid(state.paid, tick);
  return state.paid[0] === true && state.paid[1] === true;
}

export function createBudgetDisbursement(seed: string, board: FundingBoard): BudgetState {
  const costs = [...COSTS[board]];
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: costs.length,
    startCash: START_CASH,
    completionValue: COMPLETION,
    costs,
    offers: OFFERS.map((offer) => ({ ...offer, schedule: [...offer.schedule] })),
    method: null,
    cash: START_CASH,
    received: 0,
    unpaid: 0,
    repayment: 0,
    shortfall: 0,
    paid: costs.map(() => false),
    complete: false,
    periods: [],
    inputs: [],
  };
}

/** 方式の選択は一度だけ。期間の支給も一度だけで、閲覧は資金を動かさない。 */
export function applyBudgetDisbursement(state: BudgetState, input: FundingInput): BudgetState {
  if (input.type === 'view') return state;
  if (input.type === 'choose') {
    if (state.method !== null || !isMethod(input.method)) return state;
    const next = structuredClone(state);
    next.method = input.method;
    next.inputs.push({ type: 'choose', method: input.method });
    return next;
  }
  if (input.type !== 'advance' || state.method === null || state.tick >= state.horizon)
    return state;
  const method = state.method;
  const next = structuredClone(state);
  const tick = next.tick;
  const scheduled = offerOf(next.offers, method).schedule[tick] ?? 0;
  let disbursed = 0;
  if (eligible(next, method, tick)) {
    disbursed = scheduled;
    next.cash += disbursed;
    next.received += disbursed;
  } else if (scheduled > 0) {
    next.unpaid += scheduled;
  }
  const cost = next.costs[tick] ?? 0;
  const paid = next.cash >= cost;
  if (paid) next.cash -= cost;
  else next.shortfall += cost - next.cash;
  next.paid[tick] = paid;
  next.periods.push({ tick, disbursed, cost, paid, cash: next.cash, unpaid: next.unpaid });
  next.tick += 1;
  next.complete = next.paid.every(Boolean);
  next.inputs.push({ type: 'advance' });
  return next;
}

export function viewBudgetDisbursement(state: BudgetState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    cash: state.cash,
    method: state.method,
    received: state.received,
    unpaid: state.unpaid,
    repayment: state.repayment,
    costs: [...state.costs],
    offers: state.offers.map((offer) => ({
      method: offer.method,
      total: offer.total,
      schedule: [...offer.schedule],
      condition: offer.condition,
      repayment: offer.repayment,
    })),
  };
}

export function summarizeBudgetDisbursement(state: BudgetState) {
  return {
    cash: state.cash,
    received: state.received,
    unpaid: state.unpaid,
    repayment: state.repayment,
    complete: state.complete,
    shortfall: state.shortfall,
    path: state.periods.map((period) => period.cash),
    score: state.cash + (state.complete ? state.completionValue : 0),
    lost: false,
  };
}

export function chooseFundingAction(state: BudgetState, method: FundingMethod): FundingInput {
  if (state.method === null) return { type: 'choose', method };
  return { type: 'advance' };
}

function runFunding(seed: string, board: FundingBoard, method: FundingMethod) {
  const initial = createBudgetDisbursement(seed, board);
  let state = initial;
  let guard = 0;
  while (state.method === null || state.tick < state.horizon) {
    if (++guard > 10) throw new Error(`${board}:${method}`);
    const input = chooseFundingAction(state, method);
    const next = applyBudgetDisbursement(state, input);
    if (next === state) throw new Error(`${board}:${method}@${state.tick}`);
    state = next;
  }
  return { initial, inputs: state.inputs, result: summarizeBudgetDisbursement(state) };
}

export function compareBudgetDisbursements(seed = 'RI-237') {
  return (['early', 'late'] as const).flatMap((board) =>
    (['advance', 'staged', 'conditional'] as const).map((method) => ({
      board,
      method,
      ...runFunding(seed, board, method),
    })),
  );
}

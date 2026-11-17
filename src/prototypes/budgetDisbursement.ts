/** RI-237: 支給方式は一度だけ選び、未達の残額は返済しない。融資と利子は扱わない。 */

export type FundingMethod = 'advance' | 'staged' | 'conditional';
export type FundingBoard = 'early' | 'late';
export type FundingCondition =
  'none' | 'previous-paid' | 'first-paid' | 'first-two-paid' | 'first-three-paid';
export type FundingInput =
  { type: 'choose'; method: FundingMethod } | { type: 'advance' } | { type: 'view' };

export interface FundingOffer {
  method: FundingMethod;
  total: number;
  schedule: number[];
  condition: FundingCondition;
  repayment: 0;
}

/** 感度比較専用。条件達成直後の次期間に条件付き予算を一括支給する。 */
export interface FundingParameters {
  startCash: number;
  completionValue: number;
  conditionalAfterPaidPeriods: 1 | 2 | 3;
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
  const required =
    offer.condition === 'first-paid' ? 1 : offer.condition === 'first-two-paid' ? 2 : 3;
  return state.paid.slice(0, required).every(Boolean);
}

export function createBudgetDisbursement(
  seed: string,
  board: FundingBoard,
  parameters: Partial<FundingParameters> = {},
): BudgetState {
  const {
    startCash = START_CASH,
    completionValue = COMPLETION,
    conditionalAfterPaidPeriods = 2,
  } = parameters;
  if (
    !Number.isSafeInteger(startCash) ||
    startCash < 0 ||
    !Number.isSafeInteger(completionValue) ||
    completionValue < 0 ||
    ![1, 2, 3].includes(conditionalAfterPaidPeriods)
  ) {
    throw new Error('RI-237: invalid comparison parameters');
  }
  const costs = [...COSTS[board]];
  const offers = OFFERS.map((offer) => ({ ...offer, schedule: [...offer.schedule] }));
  const conditional = offerOf(offers, 'conditional');
  conditional.schedule = costs.map((_, tick) =>
    tick === conditionalAfterPaidPeriods ? conditional.total : 0,
  );
  conditional.condition = (['first-paid', 'first-two-paid', 'first-three-paid'] as const)[
    conditionalAfterPaidPeriods - 1
  ];
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: costs.length,
    startCash,
    completionValue,
    costs,
    offers,
    method: null,
    cash: startCash,
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

function runFunding(
  seed: string,
  board: FundingBoard,
  method: FundingMethod,
  parameters: Partial<FundingParameters> = {},
) {
  const initial = createBudgetDisbursement(seed, board, parameters);
  let state = initial;
  let guard = 0;
  while (state.method === null || state.tick < state.horizon) {
    if (++guard > 10) throw new Error(`${board}:${method}`);
    const input = chooseFundingAction(state, method);
    const next = applyBudgetDisbursement(state, input);
    if (next === state) throw new Error(`${board}:${method}@${state.tick}`);
    state = next;
  }
  return { initial, state };
}

export function compareBudgetDisbursements(seed = 'RI-237') {
  return (['early', 'late'] as const).flatMap((board) =>
    (['advance', 'staged', 'conditional'] as const).map((method) => {
      const { initial, state } = runFunding(seed, board, method);
      return {
        board,
        method,
        initial,
        inputs: state.inputs,
        result: summarizeBudgetDisbursement(state),
      };
    }),
  );
}

/** 境界を挟む条件を固定戦略で比較する。乱数・人間評価は含めない。 */
export function compareBudgetDisbursementSensitivity(seed = 'RI-237-sensitivity') {
  const defaults: FundingParameters = {
    startCash: START_CASH,
    completionValue: COMPLETION,
    conditionalAfterPaidPeriods: 2,
  };
  const scenarios: { id: string; board: FundingBoard; parameters: FundingParameters }[] = [];
  const add = (id: string, board: FundingBoard, parameters: Partial<FundingParameters>) =>
    scenarios.push({ id, board, parameters: { ...defaults, ...parameters } });

  for (const board of ['early', 'late'] as const) {
    // 完成可能な最小手持ち: early = 3/5/9、late = 7/3/2。
    const cash = board === 'early' ? [2, 3, 4, 5, 6, 8, 9, 10] : [1, 2, 3, 4, 6, 7, 8];
    for (const startCash of cash) add(`${board}-cash-${startCash}`, board, { startCash });
    const values = board === 'early' ? [2, 3, 4] : [3, 4, 5, 7, 8, 9];
    for (const completionValue of values) {
      add(`${board}-value-${completionValue}`, board, { completionValue });
    }
    // 支給を早めた/遅らせたときの条件付き予算の支払不能境界を挟む。
    for (const conditionalAfterPaidPeriods of [1, 3] as const) {
      const threshold =
        board === 'early' ? 7 + conditionalAfterPaidPeriods : conditionalAfterPaidPeriods;
      for (const startCash of [threshold - 1, threshold]) {
        add(`${board}-after-${conditionalAfterPaidPeriods}-cash-${startCash}`, board, {
          startCash,
          conditionalAfterPaidPeriods,
        });
      }
    }
  }

  return scenarios.map(({ id, board, parameters }) => {
    const initial = createBudgetDisbursement(seed, board, parameters);
    const strategies = (['advance', 'staged', 'conditional'] as const).map((method) => {
      const { state } = runFunding(seed, board, method, parameters);
      return {
        method,
        inputs: state.inputs,
        result: {
          ...summarizeBudgetDisbursement(state),
          paidCost: state.periods.reduce((sum, period) => sum + (period.paid ? period.cost : 0), 0),
          firstUnpaidTick: state.periods.find((period) => !period.paid)?.tick ?? null,
        },
      };
    });
    const scores = [...new Set(strategies.map(({ result }) => result.score))].sort((a, b) => b - a);
    const ranking = scores.map((score) =>
      strategies.filter(({ result }) => result.score === score).map(({ method }) => method),
    );
    return { id, parameters, initial, strategies, ranking };
  });
}

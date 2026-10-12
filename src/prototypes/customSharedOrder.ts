/** RI-230: 個別受注と共通機能を資金と保守で比べる。作業上限は RI-228、到達人数は RI-229。 */

import { applyFeatureWork, PRODUCT_CAPACITY } from './productGrowth';
import { rosterHeadcount } from './customerSegments';

export type OrderBoard = 'cash' | 'upkeep';
export type OrderStrategy = 'customFirst' | 'sharedFirst' | 'customOnly';
export type OrderSpend = { custom: number; shared: number };
export type OrderInput = { type: 'spend'; spend: OrderSpend } | { type: 'view' };

export interface OrderState {
  version: 1;
  seed: string;
  board: OrderBoard;
  tick: number;
  horizon: number;
  capacity: number;
  customNeed: number;
  sharedNeed: number;
  customDone: number;
  sharedDone: number;
  customComplete: boolean;
  sharedComplete: boolean;
  customPaid: boolean;
  sharedPaid: boolean;
  customReward: number;
  sharedReward: number;
  customUpkeep: number;
  sharedUpkeep: number;
  customReach: number;
  sharedReach: number;
  cash: number;
  upkeep: number;
  servedCustom: number;
  servedShared: number;
  bill: number;
  missPenalty: number;
  missedBill: boolean;
  slack: number;
  upkeepWeight: number;
  upkeepPenalty: number;
  inputs: OrderInput[];
}

const PLANS: Record<OrderStrategy, readonly OrderSpend[]> = {
  customFirst: [
    { custom: 4, shared: 0 },
    { custom: 0, shared: 4 },
    { custom: 0, shared: 4 },
  ],
  sharedFirst: [
    { custom: 0, shared: 4 },
    { custom: 0, shared: 4 },
    { custom: 4, shared: 0 },
  ],
  customOnly: [
    { custom: 4, shared: 0 },
    { custom: 4, shared: 0 },
    { custom: 4, shared: 0 },
  ],
};

const BOARDS: Record<OrderBoard, { bill: number; upkeepWeight: number }> = {
  cash: { bill: 10, upkeepWeight: 0 },
  upkeep: { bill: 0, upkeepWeight: 4 },
};

function isSpend(value: unknown): value is OrderSpend {
  if (typeof value !== 'object' || value === null) return false;
  const spend = value as Record<string, unknown>;
  return (
    Object.keys(spend).length === 2 &&
    Number.isInteger(spend.custom) &&
    Number.isInteger(spend.shared) &&
    typeof spend.custom === 'number' &&
    typeof spend.shared === 'number' &&
    spend.custom >= 0 &&
    spend.shared >= 0
  );
}

export function createCustomSharedOrder(seed: string, board: OrderBoard): OrderState {
  const preset = BOARDS[board];
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 3,
    capacity: PRODUCT_CAPACITY,
    customNeed: 4,
    sharedNeed: 6,
    customDone: 0,
    sharedDone: 0,
    customComplete: false,
    sharedComplete: false,
    customPaid: false,
    sharedPaid: false,
    customReward: 12,
    sharedReward: 4,
    customUpkeep: 3,
    sharedUpkeep: 1,
    customReach: 1,
    sharedReach: rosterHeadcount('pioneer'),
    cash: 0,
    upkeep: 0,
    servedCustom: 0,
    servedShared: 0,
    bill: preset.bill,
    missPenalty: 8,
    missedBill: false,
    slack: 1,
    upkeepWeight: preset.upkeepWeight,
    upkeepPenalty: 0,
    inputs: [],
  };
}

/** 報酬と到達人数は完成の一度だけ。完成後の保守は余力1を超えた分だけ罰にする。 */
export function applyOrderSpend(state: OrderState, spend: OrderSpend): OrderState {
  if (state.tick >= state.horizon || !isSpend(spend)) return state;
  if (spend.custom + spend.shared !== state.capacity) return state;
  const next = structuredClone(state);
  const custom = applyFeatureWork(next.customDone, next.customNeed, spend.custom);
  const shared = applyFeatureWork(next.sharedDone, next.sharedNeed, spend.shared);
  next.customDone = custom.done;
  next.sharedDone = shared.done;
  if (custom.completed && !next.customPaid) {
    next.customComplete = true;
    next.customPaid = true;
    next.cash += next.customReward;
    next.servedCustom = next.customReach;
  }
  if (shared.completed && !next.sharedPaid) {
    next.sharedComplete = true;
    next.sharedPaid = true;
    next.cash += next.sharedReward;
    next.servedShared = next.sharedReach;
  }
  next.upkeep =
    (next.customComplete ? next.customUpkeep : 0) + (next.sharedComplete ? next.sharedUpkeep : 0);
  next.upkeepPenalty += Math.max(0, next.upkeep - next.slack) * next.upkeepWeight;
  if (next.tick === 0 && next.cash < next.bill) next.missedBill = true;
  next.tick += 1;
  next.inputs.push({ type: 'spend', spend: { ...spend } });
  return next;
}

export function applyCustomSharedOrder(state: OrderState, input: OrderInput): OrderState {
  if (input.type === 'view') return state;
  if (input.type !== 'spend') return state;
  return applyOrderSpend(state, input.spend);
}

export function viewCustomSharedOrder(state: OrderState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    capacity: state.capacity,
    custom: {
      remaining: state.customNeed - state.customDone,
      reward: state.customPaid ? 0 : state.customReward,
      reach: state.customReach,
      upkeep: state.customUpkeep,
      paid: state.customPaid,
    },
    shared: {
      remaining: state.sharedNeed - state.sharedDone,
      reward: state.sharedPaid ? 0 : state.sharedReward,
      reach: state.sharedReach,
      upkeep: state.sharedUpkeep,
      paid: state.sharedPaid,
    },
    earlyBill: state.tick === 0 ? state.bill : 0,
    missPenalty: state.missedBill ? 0 : state.missPenalty,
    slack: state.slack,
    upkeepWeight: state.upkeepWeight,
  };
}

export function summarizeCustomSharedOrder(state: OrderState) {
  const miss = state.missedBill ? state.missPenalty : 0;
  return {
    cash: state.cash,
    miss,
    upkeepPenalty: state.upkeepPenalty,
    servedCustom: state.servedCustom,
    servedShared: state.servedShared,
    score: state.cash - miss - state.upkeepPenalty,
    lost: false,
  };
}

export function chooseOrderSpend(state: OrderState, strategy: OrderStrategy): OrderInput {
  return {
    type: 'spend',
    spend: { ...(PLANS[strategy][state.tick] ?? { custom: 0, shared: state.capacity }) },
  };
}

export function compareCustomSharedOrders(seed = 'RI-230') {
  return (['cash', 'upkeep'] as const).flatMap((board) =>
    (['customFirst', 'sharedFirst', 'customOnly'] as const).map((strategy) => {
      const initial = createCustomSharedOrder(seed, board);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 10) throw new Error(`${board}:${strategy}`);
        const input = chooseOrderSpend(state, strategy);
        const next = applyCustomSharedOrder(state, input);
        if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
        state = next;
      }
      return {
        board,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeCustomSharedOrder(state),
      };
    }),
  );
}

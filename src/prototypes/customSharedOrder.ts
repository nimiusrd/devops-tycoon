/** RI-230: 個別受注と共通機能を資金と保守で比べる。感度の係数は計算にだけ渡す。作業上限は RI-228、到達人数は RI-229。 */

import { applyFeatureWork, PRODUCT_CAPACITY } from './productGrowth';
import { rosterHeadcount } from './customerSegments';

export type OrderBoard = 'cash' | 'upkeep';
export type OrderStrategy = 'customFirst' | 'sharedFirst' | 'customOnly';
export type OrderSpend = { custom: number; shared: number };
export type OrderInput = { type: 'spend'; spend: OrderSpend } | { type: 'view' };

/** 感度で一つだけ動かす係数。共通の報酬と共通の保守は含めない。 */
export interface OrderFactorRules {
  customReward: number;
  customUpkeep: number;
  earlyBill: number;
}

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

const CUSTOM_REWARD = 12;
const SHARED_REWARD = 4;
const CUSTOM_UPKEEP = 3;
const SHARED_UPKEEP = 1;
const EARLY_BILL = 10;

/** 初回比較の係数。感度ではこのうち一つだけを変える。 */
export const baselineOrderRules: OrderFactorRules = {
  customReward: CUSTOM_REWARD,
  customUpkeep: CUSTOM_UPKEEP,
  earlyBill: EARLY_BILL,
};

const BOARDS: Record<OrderBoard, { bill: number; upkeepWeight: number }> = {
  cash: { bill: EARLY_BILL, upkeepWeight: 0 },
  upkeep: { bill: 0, upkeepWeight: 4 },
};

function nonNegativeInteger(value: number, fallback: number): number {
  if (!Number.isInteger(value) || value < 0) return fallback;
  return value;
}

function normalizeRules(rules?: OrderFactorRules): OrderFactorRules {
  const given = rules ?? baselineOrderRules;
  return {
    customReward: nonNegativeInteger(given.customReward, baselineOrderRules.customReward),
    customUpkeep: nonNegativeInteger(given.customUpkeep, baselineOrderRules.customUpkeep),
    earlyBill: nonNegativeInteger(given.earlyBill, baselineOrderRules.earlyBill),
  };
}

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
    customReward: CUSTOM_REWARD,
    sharedReward: SHARED_REWARD,
    customUpkeep: CUSTOM_UPKEEP,
    sharedUpkeep: SHARED_UPKEEP,
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

/** 報酬と到達人数は完成の一度だけ。完成後の保守は余力1を超えた分だけ罰にする。感度の係数はここだけで使い、状態へは書かない。 */
export function applyOrderSpend(
  state: OrderState,
  spend: OrderSpend,
  rules?: OrderFactorRules,
): OrderState {
  if (state.tick >= state.horizon || !isSpend(spend)) return state;
  if (spend.custom + spend.shared !== state.capacity) return state;
  const active = normalizeRules(rules);
  const next = structuredClone(state);
  const custom = applyFeatureWork(next.customDone, next.customNeed, spend.custom);
  const shared = applyFeatureWork(next.sharedDone, next.sharedNeed, spend.shared);
  next.customDone = custom.done;
  next.sharedDone = shared.done;
  if (custom.completed && !next.customPaid) {
    next.customComplete = true;
    next.customPaid = true;
    next.cash += active.customReward;
    next.servedCustom = next.customReach;
  }
  if (shared.completed && !next.sharedPaid) {
    next.sharedComplete = true;
    next.sharedPaid = true;
    next.cash += next.sharedReward;
    next.servedShared = next.sharedReach;
  }
  const customUpkeep = next.customComplete ? active.customUpkeep : 0;
  const sharedUpkeep = next.sharedComplete ? next.sharedUpkeep : 0;
  next.upkeep = customUpkeep + sharedUpkeep;
  next.upkeepPenalty += Math.max(0, next.upkeep - next.slack) * next.upkeepWeight;
  const bill = next.board === 'cash' ? active.earlyBill : next.bill;
  if (next.tick === 0 && next.cash < bill) next.missedBill = true;
  next.tick += 1;
  next.inputs.push({ type: 'spend', spend: { ...spend } });
  return next;
}

export function applyCustomSharedOrder(
  state: OrderState,
  input: OrderInput,
  rules?: OrderFactorRules,
): OrderState {
  if (input.type === 'view') return state;
  if (input.type !== 'spend') return state;
  return applyOrderSpend(state, input.spend, rules);
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

const FACTOR_SEED = 'RI-230';
const FACTOR_BOARDS = ['cash', 'upkeep'] as const;
const FACTOR_STRATEGIES = ['customFirst', 'sharedFirst', 'customOnly'] as const;
const REWARD_STEPS = [0, 9, 10, 12, 16] as const;
const UPKEEP_STEPS = [0, 1, 2, 3, 4] as const;
const BILL_STEPS = [0, 1, 10, 12, 13, 16] as const;
type OrderFactorAxis = 'reward' | 'upkeep' | 'earlyBill';
type OrderLeader = OrderStrategy | 'tie';
type OrderSummary = ReturnType<typeof summarizeCustomSharedOrder>;
interface OrderFactorRun {
  strategy: OrderStrategy;
  inputs: OrderInput[];
  result: OrderSummary;
}
interface OrderFactorBoard {
  board: OrderBoard;
  scores: Record<OrderStrategy, number>;
  order: OrderStrategy[][];
  leader: OrderLeader;
  runs: OrderFactorRun[];
}
interface OrderFactorPoint {
  axis: OrderFactorAxis;
  parameter: string;
  rules: OrderFactorRules;
  sameAsFirstComparison: boolean;
  boards: OrderFactorBoard[];
}
interface OrderFactorReversal {
  axis: OrderFactorAxis;
  board: OrderBoard;
  before: { parameter: string; order: OrderStrategy[][]; scores: Record<OrderStrategy, number> };
  after: { parameter: string; order: OrderStrategy[][]; scores: Record<OrderStrategy, number> };
}

function rulesMatchBaseline(rules: OrderFactorRules): boolean {
  return (
    rules.customReward === baselineOrderRules.customReward &&
    rules.customUpkeep === baselineOrderRules.customUpkeep &&
    rules.earlyBill === baselineOrderRules.earlyBill
  );
}

function runOrderFactor(
  board: OrderBoard,
  strategy: OrderStrategy,
  rules: OrderFactorRules,
): OrderFactorRun {
  let state = createCustomSharedOrder(FACTOR_SEED, board);
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 10) throw new Error(`${board}:${strategy}`);
    const input = chooseOrderSpend(state, strategy);
    const next = applyCustomSharedOrder(state, input, rules);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { strategy, inputs: state.inputs, result: summarizeCustomSharedOrder(state) };
}

function ranking(scores: Record<OrderStrategy, number>): OrderStrategy[][] {
  const pending: OrderStrategy[] = [...FACTOR_STRATEGIES];
  const groups: OrderStrategy[][] = [];
  while (pending.length > 0) {
    const best = Math.max(...pending.map((id) => scores[id]));
    const group = pending.filter((id) => scores[id] === best);
    groups.push(group);
    for (const id of group) pending.splice(pending.indexOf(id), 1);
  }
  return groups;
}

function leaderOf(order: OrderStrategy[][]): OrderLeader {
  const top = order[0];
  if (!top || top.length !== 1) return 'tie';
  return top[0];
}

function scoreOf(runs: OrderFactorRun[], strategy: OrderStrategy): number {
  const found = runs.find((run) => run.strategy === strategy);
  if (!found) throw new Error(strategy);
  return found.result.score;
}

function factorBoard(board: OrderBoard, rules: OrderFactorRules): OrderFactorBoard {
  const runs = FACTOR_STRATEGIES.map((strategy) => runOrderFactor(board, strategy, rules));
  const scores = {
    customFirst: scoreOf(runs, 'customFirst'),
    sharedFirst: scoreOf(runs, 'sharedFirst'),
    customOnly: scoreOf(runs, 'customOnly'),
  };
  const order = ranking(scores);
  return { board, scores, order, leader: leaderOf(order), runs };
}

function factorPoint(
  axis: OrderFactorAxis,
  parameter: string,
  rules: OrderFactorRules,
): OrderFactorPoint {
  return {
    axis,
    parameter,
    rules: { ...rules },
    sameAsFirstComparison: rulesMatchBaseline(rules),
    boards: FACTOR_BOARDS.map((board) => factorBoard(board, rules)),
  };
}

function boardAt(point: OrderFactorPoint, board: OrderBoard): OrderFactorBoard {
  const found = point.boards.find((item) => item.board === board);
  if (!found) throw new Error(board);
  return found;
}

function sameOrder(left: OrderStrategy[][], right: OrderStrategy[][]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function reversalsOf(rows: OrderFactorPoint[]): OrderFactorReversal[] {
  const found: OrderFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after) continue;
    for (const board of FACTOR_BOARDS) {
      const earlier = boardAt(before, board);
      const later = boardAt(after, board);
      if (sameOrder(earlier.order, later.order)) continue;
      found.push({
        axis: before.axis,
        board,
        before: { parameter: before.parameter, order: earlier.order, scores: earlier.scores },
        after: { parameter: after.parameter, order: later.order, scores: later.scores },
      });
    }
  }
  return found;
}

function factorResources(board: OrderBoard) {
  const state = createCustomSharedOrder(FACTOR_SEED, board);
  return {
    horizon: state.horizon,
    capacity: state.capacity,
    customNeed: state.customNeed,
    sharedNeed: state.sharedNeed,
    customReward: state.customReward,
    sharedReward: state.sharedReward,
    customUpkeep: state.customUpkeep,
    sharedUpkeep: state.sharedUpkeep,
    customReach: state.customReach,
    sharedReach: state.sharedReach,
    bill: state.bill,
    missPenalty: state.missPenalty,
    slack: state.slack,
    upkeepWeight: state.upkeepWeight,
  };
}

/** 初回と同じ資源で、個別の報酬・個別の保守・資金不足の初期支払を一つずつ動かす。固定戦略。 */
export function compareCustomSharedOrderFactorReversals() {
  const sweeps = {
    reward: REWARD_STEPS.map((customReward) =>
      factorPoint('reward', String(customReward), { ...baselineOrderRules, customReward }),
    ),
    upkeep: UPKEEP_STEPS.map((customUpkeep) =>
      factorPoint('upkeep', String(customUpkeep), { ...baselineOrderRules, customUpkeep }),
    ),
    earlyBill: BILL_STEPS.map((earlyBill) =>
      factorPoint('earlyBill', String(earlyBill), { ...baselineOrderRules, earlyBill }),
    ),
  };
  return {
    conditions: {
      seed: FACTOR_SEED,
      boards: {
        cash: factorResources('cash'),
        upkeep: factorResources('upkeep'),
      },
      decision: {
        strategies: [...FACTOR_STRATEGIES],
        score: 'cash - miss - upkeepPenalty' as const,
        order: '差引の高い順。同点は customFirst、sharedFirst、customOnly の並び',
      },
      baseline: { ...baselineOrderRules },
      held: {
        reward:
          '個別の報酬だけを動かす。共通の報酬4、個別の保守3、共通の保守1。初期支払は資金不足10、保守不足0',
        upkeep:
          '個別の保守だけを動かす。共通の保守1、個別の報酬12、共通の報酬4。初期支払は盤面のまま',
        earlyBill:
          '資金不足の初期支払だけを動かす。保守不足の初期支払は0。個別の報酬12、共通の報酬4、個別の保守3、共通の保守1',
      },
      rewardDefinition:
        '個別受注を完成したときに一度だけ入る報酬。共通の報酬は状態の4のまま。両方を完成する手順は共通の報酬を同じだけ受け取るので、個別先行と共通先行の差は共通の報酬では動かない。その増分は掃引しない',
      upkeepDefinition:
        '個別受注を完成した期間から毎期足す保守。共通の保守は状態の1のまま。余力1を超えた分に盤面の保守罰を掛ける。資金不足の保守罰は0なので、この軸では資金不足の差引は動かない',
      earlyBillDefinition:
        '資金不足の最初の期間に、その時点の資金が届かないと支払不足8を一度引く額。0は支払がない。保守不足の支払は0のまま。状態へ保存した支払額は書き換えない',
      steps: {
        reward: [...REWARD_STEPS],
        upkeep: [...UPKEEP_STEPS],
        earlyBill: [...BILL_STEPS],
      },
      omitted:
        '初回の2盤面×3戦略の表は再出力しない。基準行だけ初回JSONと照合する。共通の報酬と共通の保守は掃引しない',
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    },
    sweeps,
    reversals: [
      ...reversalsOf(sweeps.reward),
      ...reversalsOf(sweeps.upkeep),
      ...reversalsOf(sweeps.earlyBill),
    ],
  };
}

/** RI-235: 廃止完了まで保守は減らない。重要顧客は削除前から見える。RI-229 の人数を使う。 */

import { rosterHeadcount } from './customerSegments';
import { PRODUCT_CAPACITY } from './productGrowth';

export type RetirementBoard = 'unused' | 'relied';
export type RetirementStrategy = 'now' | 'staged' | 'keep';
export type RetirementPhase = 'live' | 'announced' | 'migrated' | 'removed';
export type RetirementInput =
  | { type: 'announce' }
  | { type: 'migrate' }
  | { type: 'remove' }
  | { type: 'hold' }
  | { type: 'view' };

export interface RetirementState {
  version: 1;
  seed: string;
  board: RetirementBoard;
  tick: number;
  horizon: number;
  capacity: number;
  respondents: number;
  feature: 'billing';
  users: number;
  important: number;
  maintenance: number;
  userCost: number;
  importantCost: number;
  migrationCostRate: number;
  recoverPer: number;
  phase: RetirementPhase;
  recovered: number;
  customerLoss: number;
  migrationCost: number;
  inputs: RetirementInput[];
}

const MAINTENANCE = 3;
const USERS = 1;
const USER_COST = 2;
const IMPORTANT_COST = 6;
const MIGRATION_COST = 3;
const RECOVER_PER = 4;

const BOARDS: Record<RetirementBoard, { important: number }> = {
  unused: { important: 0 },
  relied: { important: 2 },
};

export function createFeatureRetirement(seed: string, board: RetirementBoard): RetirementState {
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 3,
    capacity: PRODUCT_CAPACITY,
    respondents: rosterHeadcount('pioneer'),
    feature: 'billing',
    users: USERS,
    important: BOARDS[board].important,
    maintenance: MAINTENANCE,
    userCost: USER_COST,
    importantCost: IMPORTANT_COST,
    migrationCostRate: MIGRATION_COST,
    recoverPer: RECOVER_PER,
    phase: 'live',
    recovered: 0,
    customerLoss: 0,
    migrationCost: 0,
    inputs: [],
  };
}

function activeMaintenance(state: RetirementState): number {
  return state.phase === 'removed' ? 0 : state.maintenance;
}

/** 予告と移行では保守も回収も動かない。回収は廃止完了の一度だけ。 */
export function applyFeatureRetirement(
  state: RetirementState,
  input: RetirementInput,
): RetirementState {
  if (input.type === 'view' || state.tick >= state.horizon) return state;
  if (input.type === 'hold') {
    const next = structuredClone(state);
    next.tick += 1;
    next.inputs.push({ type: 'hold' });
    return next;
  }
  if (input.type === 'announce') {
    if (state.phase !== 'live') return state;
    const next = structuredClone(state);
    next.phase = 'announced';
    next.tick += 1;
    next.inputs.push({ type: 'announce' });
    return next;
  }
  if (input.type === 'migrate') {
    if (state.phase !== 'announced') return state;
    const next = structuredClone(state);
    next.phase = 'migrated';
    next.migrationCost += next.migrationCostRate;
    next.tick += 1;
    next.inputs.push({ type: 'migrate' });
    return next;
  }
  if (input.type !== 'remove') return state;
  if (state.phase !== 'live' && state.phase !== 'migrated') return state;
  const next = structuredClone(state);
  if (next.phase === 'live') {
    next.customerLoss += next.users * next.userCost + next.important * next.importantCost;
  }
  next.recovered += next.maintenance * next.recoverPer;
  next.phase = 'removed';
  next.tick += 1;
  next.inputs.push({ type: 'remove' });
  return next;
}

export function viewFeatureRetirement(state: RetirementState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    capacity: state.capacity,
    respondents: state.respondents,
    feature: state.feature,
    users: state.users,
    important: state.important,
    maintenance: state.maintenance,
    activeMaintenance: activeMaintenance(state),
    userCost: state.userCost,
    importantCost: state.importantCost,
    migrationCostRate: state.migrationCostRate,
    recoverPer: state.recoverPer,
    phase: state.phase,
    recovered: state.recovered,
  };
}

export function summarizeFeatureRetirement(state: RetirementState) {
  const maintenance = activeMaintenance(state);
  return {
    recovered: state.recovered,
    customerLoss: state.customerLoss,
    migrationCost: state.migrationCost,
    activeMaintenance: maintenance,
    nextSlack: state.capacity - maintenance,
    score: state.recovered - state.customerLoss - state.migrationCost,
    lost: false,
  };
}

export function chooseRetirementAction(
  state: RetirementState,
  strategy: RetirementStrategy,
): RetirementInput {
  if (strategy === 'keep') return { type: 'hold' };
  if (strategy === 'now') return state.phase === 'live' ? { type: 'remove' } : { type: 'hold' };
  if (state.phase === 'live') return { type: 'announce' };
  if (state.phase === 'announced') return { type: 'migrate' };
  if (state.phase === 'migrated') return { type: 'remove' };
  return { type: 'hold' };
}

function runRetirement(seed: string, board: RetirementBoard, strategy: RetirementStrategy) {
  const initial = createFeatureRetirement(seed, board);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 10) throw new Error(`${board}:${strategy}`);
    const input = chooseRetirementAction(state, strategy);
    const next = applyFeatureRetirement(state, input);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { initial, inputs: state.inputs, result: summarizeFeatureRetirement(state) };
}

export function compareFeatureRetirement(seed = 'RI-235') {
  return (['unused', 'relied'] as const).flatMap((board) =>
    (['now', 'staged', 'keep'] as const).map((strategy) => ({
      board,
      strategy,
      ...runRetirement(seed, board, strategy),
    })),
  );
}

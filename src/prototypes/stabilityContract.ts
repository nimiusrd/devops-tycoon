/** RI-236: 安定契約の報酬は期間に一度だけ。RI-229 の keeper 人数を使う。 */

import { rosterHeadcount } from './customerSegments';
import { applyFeatureWork, PRODUCT_CAPACITY, type ProductFeatureId } from './productGrowth';

export type ContractFeature = ProductFeatureId;
export type ContractBoard = 'calm' | 'strict';
export type ContractStrategy = 'steady' | 'rush';
export type ContractInput =
  { type: 'assign'; feature: ContractFeature; maintain: number } | { type: 'view' };

export interface ContractFeatureState {
  id: ContractFeature;
  need: number;
  done: number;
  complete: boolean;
}

export interface ContractPeriod {
  tick: number;
  feature: ContractFeature;
  maintain: number;
  built: number;
  completed: boolean;
  reward: number;
  penalty: number;
  budget: number;
}

export interface ContractState {
  version: 1;
  seed: string;
  board: ContractBoard;
  tick: number;
  horizon: number;
  capacity: number;
  respondents: number;
  segment: 'keeper';
  reserve: number;
  reward: number;
  penalty: number;
  featureValue: number;
  features: ContractFeatureState[];
  budget: number;
  rewards: number;
  breaches: number;
  periods: ContractPeriod[];
  inputs: ContractInput[];
}

const FEATURES: readonly ContractFeature[] = ['api', 'screen', 'billing'];
const NEED = 4;
const RESERVE = 2;
const REWARD = 4;
const FEATURE_VALUE = 12;

const BOARDS: Record<ContractBoard, { penalty: number }> = {
  calm: { penalty: 1 },
  strict: { penalty: 10 },
};

function isFeature(value: string): value is ContractFeature {
  return value === 'api' || value === 'screen' || value === 'billing';
}

export function createStabilityContract(seed: string, board: ContractBoard): ContractState {
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 3,
    capacity: PRODUCT_CAPACITY,
    respondents: rosterHeadcount('keeper'),
    segment: 'keeper',
    reserve: RESERVE,
    reward: REWARD,
    penalty: BOARDS[board].penalty,
    featureValue: FEATURE_VALUE,
    features: FEATURES.map((id) => ({ id, need: NEED, done: 0, complete: false })),
    budget: 0,
    rewards: 0,
    breaches: 0,
    periods: [],
    inputs: [],
  };
}

/** 報酬は割当の一度だけで、閲覧では期間も予算も動かない。 */
export function applyStabilityContract(state: ContractState, input: ContractInput): ContractState {
  if (input.type === 'view' || state.tick >= state.horizon) return state;
  if (input.type !== 'assign' || !isFeature(input.feature)) return state;
  if (!Number.isInteger(input.maintain) || input.maintain < 0 || input.maintain > state.capacity) {
    return state;
  }
  const next = structuredClone(state);
  const feature = next.features.find((item) => item.id === input.feature);
  if (!feature) return state;
  const applied = applyFeatureWork(feature.done, feature.need, next.capacity - input.maintain);
  feature.done = applied.done;
  let completed = false;
  if (applied.completed) {
    feature.complete = true;
    completed = true;
    next.budget += next.featureValue;
  }
  let reward = 0;
  let penalty = 0;
  if (input.maintain >= next.reserve) {
    reward = next.reward;
    next.rewards += 1;
    next.budget += reward;
  } else {
    penalty = next.penalty;
    next.breaches += 1;
    next.budget -= penalty;
  }
  next.periods.push({
    tick: next.tick,
    feature: input.feature,
    maintain: input.maintain,
    built: applied.accepted,
    completed,
    reward,
    penalty,
    budget: next.budget,
  });
  next.tick += 1;
  next.inputs.push({ type: 'assign', feature: input.feature, maintain: input.maintain });
  return next;
}

export function viewStabilityContract(state: ContractState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    capacity: state.capacity,
    respondents: state.respondents,
    segment: state.segment,
    reserve: state.reserve,
    reward: state.reward,
    penalty: state.penalty,
    featureValue: state.featureValue,
    budget: state.budget,
    features: state.features.map((feature) => ({
      id: feature.id,
      remaining: feature.need - feature.done,
      complete: feature.complete,
    })),
  };
}

export function summarizeStabilityContract(state: ContractState) {
  return {
    budget: state.budget,
    completed: state.features.filter((feature) => feature.complete).map((feature) => feature.id),
    rewards: state.rewards,
    breaches: state.breaches,
    path: state.periods.map((period) => period.budget),
    score: state.budget,
    lost: false,
  };
}

function nextFeature(state: ContractState): ContractFeature {
  return state.features.find((feature) => !feature.complete)?.id ?? 'api';
}

export function chooseContractAction(
  state: ContractState,
  strategy: ContractStrategy,
): ContractInput {
  return {
    type: 'assign',
    feature: nextFeature(state),
    maintain: strategy === 'steady' ? state.reserve : 0,
  };
}

function runContract(seed: string, board: ContractBoard, strategy: ContractStrategy) {
  const initial = createStabilityContract(seed, board);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 10) throw new Error(`${board}:${strategy}`);
    const input = chooseContractAction(state, strategy);
    const next = applyStabilityContract(state, input);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { initial, inputs: state.inputs, result: summarizeStabilityContract(state) };
}

export function compareStabilityContracts(seed = 'RI-236') {
  return (['calm', 'strict'] as const).flatMap((board) =>
    (['steady', 'rush'] as const).map((strategy) => ({
      board,
      strategy,
      ...runContract(seed, board, strategy),
    })),
  );
}

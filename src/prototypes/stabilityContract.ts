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

/** 通常ランへ接続しない、試作内の比較係数。 */
export interface StabilityContractRules {
  reserve: number;
  reward: number;
  penalty: number;
}

export function boardContractRules(board: ContractBoard): StabilityContractRules {
  return { reserve: RESERVE, reward: REWARD, penalty: BOARDS[board].penalty };
}

function isFeature(value: string): value is ContractFeature {
  return value === 'api' || value === 'screen' || value === 'billing';
}

export function createStabilityContract(
  seed: string,
  board: ContractBoard,
  rules: StabilityContractRules = boardContractRules(board),
): ContractState {
  if (
    ![rules.reserve, rules.reward, rules.penalty].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) ||
    rules.reserve > PRODUCT_CAPACITY
  ) {
    throw new RangeError('契約係数は非負の安全な整数、確保枠は余力以下にする');
  }
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 3,
    capacity: PRODUCT_CAPACITY,
    respondents: rosterHeadcount('keeper'),
    segment: 'keeper',
    reserve: rules.reserve,
    reward: rules.reward,
    penalty: rules.penalty,
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

function runContract(
  seed: string,
  board: ContractBoard,
  strategy: ContractStrategy,
  rules = boardContractRules(board),
) {
  const initial = createStabilityContract(seed, board, rules);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 10) throw new Error(`${board}:${strategy}`);
    const input = chooseContractAction(state, strategy);
    const next = applyStabilityContract(state, input);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { initial, inputs: state.inputs, result: summarizeStabilityContract(state), state };
}

export function compareStabilityContracts(seed = 'RI-236') {
  return (['calm', 'strict'] as const).flatMap((board) =>
    (['steady', 'rush'] as const).map((strategy) => {
      const { initial, inputs, result } = runContract(seed, board, strategy);
      return { board, strategy, initial, inputs, result };
    }),
  );
}

/** 同じ初期状態から二つの固定方針を実行し、成果と機会費用を分ける。 */
export function evaluateStabilityContractRules(seed: string, rules: StabilityContractRules) {
  const runs = (['steady', 'rush'] as const).map((strategy) => {
    // board は初回試作のラベル。感度比較の実効係数は rules / initial に保存する。
    const { inputs, result, state } = runContract(seed, 'calm', strategy, rules);
    const maintenanceWork = state.periods.reduce((sum, period) => sum + period.maintain, 0);
    const assignedFeatureWork = state.capacity * state.tick - maintenanceWork;
    const acceptedFeatureWork = state.periods.reduce((sum, period) => sum + period.built, 0);
    return {
      strategy,
      inputs,
      result,
      accounting: {
        completedValue: result.completed.length * state.featureValue,
        rewardIncome: state.periods.reduce((sum, period) => sum + period.reward, 0),
        breachLoss: state.periods.reduce((sum, period) => sum + period.penalty, 0),
        maintenanceWork,
        assignedFeatureWork,
        acceptedFeatureWork,
        discardedFeatureWork: assignedFeatureWork - acceptedFeatureWork,
        unfinishedWork: state.features
          .filter((feature) => !feature.complete)
          .reduce((sum, feature) => sum + feature.done, 0),
      },
    };
  });
  const margin = runs[0].result.budget - runs[1].result.budget;
  const preference: ContractStrategy | 'tie' = margin > 0 ? 'steady' : margin < 0 ? 'rush' : 'tie';
  return {
    rules: { ...rules },
    initial: createStabilityContract(seed, 'calm', rules),
    runs,
    margin,
    preference,
  };
}

/** 各列で一係数だけ変更する。確保枠の反転は損失5の別アンカーでも調べる。 */
export function compareStabilityContractSensitivity(seed = 'RI-236') {
  const baseline = boardContractRules('calm');
  const definitions: {
    id: string;
    axis: keyof StabilityContractRules;
    anchor: StabilityContractRules;
    values: number[];
  }[] = [
    { id: 'reserve-calm', axis: 'reserve', anchor: baseline, values: [0, 1, 2, 3, 4] },
    {
      id: 'reserve-boundary',
      axis: 'reserve',
      anchor: { ...baseline, penalty: 5 },
      values: [0, 1, 2, 3, 4],
    },
    { id: 'reward', axis: 'reward', anchor: baseline, values: [0, 4, 6, 7, 8] },
    { id: 'penalty', axis: 'penalty', anchor: baseline, values: [0, 1, 3, 4, 5, 10] },
  ];
  const sweeps = definitions.map(({ id, axis, anchor, values }) => {
    const points = values.map((value) => ({
      value,
      ...evaluateStabilityContractRules(seed, { ...anchor, [axis]: value }),
    }));
    return {
      id,
      axis,
      anchor: { ...anchor },
      points,
      transitions: points.slice(1).flatMap((after, index) => {
        const before = points[index];
        return before.preference === after.preference
          ? []
          : [
              {
                before: {
                  value: before.value,
                  preference: before.preference,
                  margin: before.margin,
                },
                after: { value: after.value, preference: after.preference, margin: after.margin },
              },
            ];
      }),
    };
  });
  return {
    conditions: {
      seed,
      horizon: 3,
      capacity: PRODUCT_CAPACITY,
      featureNeed: NEED,
      featureValue: FEATURE_VALUE,
      baseline,
      strategies: {
        steady: '毎期ちょうどreserveを確保し、残りを先頭の未完成機能へ投入',
        rush: '毎期確保0で先頭の未完成機能へ全投入。reserve=0なら契約も達成',
      },
      score: '完成価値 + 期間報酬 - 違反損失。未完成の進捗と捨てた作業に予算価値は付けない',
      margin: 'steady予算 - rush予算。正ならsteady、負ならrush、0ならtie',
      sampling: '各列のanchorからaxisだけ変更。離散サンプル間の未観測の同点は推定しない',
      fixedStrategies: true,
      randomized: false,
      humanPlaytest: false,
      productionAdoption: false,
    },
    sweeps,
  };
}

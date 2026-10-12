/** RI-234: 完成した機能は次の期間から保守を生む。同じ機能の二度目は増やさない。RI-228 の完成判定を使う。 */

import { applyFeatureWork, PRODUCT_CAPACITY, type ProductFeatureId } from './productGrowth';

export type UpkeepFeature = ProductFeatureId;
export type UpkeepBoard = 'light' | 'heavy';
export type UpkeepStrategy = 'rush' | 'staff';
export type UpkeepInput =
  { type: 'assign'; feature: UpkeepFeature; maintain: number } | { type: 'view' };

export interface UpkeepFeatureState {
  id: UpkeepFeature;
  need: number;
  done: number;
  complete: boolean;
  online: boolean;
}

export interface UpkeepPeriod {
  tick: number;
  feature: UpkeepFeature;
  maintain: number;
  built: number;
  completed: boolean;
  shortfall: number;
}

export interface UpkeepState {
  version: 1;
  seed: string;
  board: UpkeepBoard;
  tick: number;
  horizon: number;
  capacity: number;
  upkeepRate: number;
  shortfallPenalty: number;
  featureValue: number;
  features: UpkeepFeatureState[];
  completedValue: number;
  shortfall: number;
  periods: UpkeepPeriod[];
  inputs: UpkeepInput[];
}

const FEATURES: readonly UpkeepFeature[] = ['api', 'screen', 'billing'];
const NEED = 4;
const FEATURE_VALUE = 6;

const BOARDS: Record<UpkeepBoard, { upkeepRate: number; shortfallPenalty: number }> = {
  light: { upkeepRate: 1, shortfallPenalty: 1 },
  heavy: { upkeepRate: 2, shortfallPenalty: 4 },
};

function isFeature(value: string): value is UpkeepFeature {
  return value === 'api' || value === 'screen' || value === 'billing';
}

export function createFeatureUpkeep(seed: string, board: UpkeepBoard): UpkeepState {
  const preset = BOARDS[board];
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 3,
    capacity: PRODUCT_CAPACITY,
    upkeepRate: preset.upkeepRate,
    shortfallPenalty: preset.shortfallPenalty,
    featureValue: FEATURE_VALUE,
    features: FEATURES.map((id) => ({ id, need: NEED, done: 0, complete: false, online: false })),
    completedValue: 0,
    shortfall: 0,
    periods: [],
    inputs: [],
  };
}

function dueNow(state: UpkeepState): number {
  return state.upkeepRate * state.features.filter((feature) => feature.online).length;
}

function maintenanceOf(state: UpkeepState, feature: UpkeepFeatureState): number {
  return feature.online ? state.upkeepRate : 0;
}

/** 今期の保守は、前期までに完成した機能だけが生む。 */
export function applyFeatureUpkeep(state: UpkeepState, input: UpkeepInput): UpkeepState {
  if (input.type === 'view' || state.tick >= state.horizon) return state;
  if (input.type !== 'assign' || !isFeature(input.feature)) return state;
  if (!Number.isInteger(input.maintain) || input.maintain < 0 || input.maintain > state.capacity) {
    return state;
  }
  const next = structuredClone(state);
  const feature = next.features.find((item) => item.id === input.feature);
  if (!feature) return state;
  const due = dueNow(next);
  const applied = applyFeatureWork(feature.done, feature.need, next.capacity - input.maintain);
  feature.done = applied.done;
  if (applied.completed) {
    feature.complete = true;
    next.completedValue += next.featureValue;
  }
  const shortfall = Math.max(0, due - input.maintain);
  next.shortfall += shortfall;
  next.periods.push({
    tick: next.tick,
    feature: input.feature,
    maintain: input.maintain,
    built: applied.accepted,
    completed: applied.completed,
    shortfall,
  });
  for (const item of next.features) {
    if (item.complete) item.online = true;
  }
  next.tick += 1;
  next.inputs.push({ type: 'assign', feature: input.feature, maintain: input.maintain });
  return next;
}

export function viewFeatureUpkeep(state: UpkeepState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    capacity: state.capacity,
    board: state.board,
    upkeepRate: state.upkeepRate,
    shortfallPenalty: state.shortfallPenalty,
    featureValue: state.featureValue,
    obligation: dueNow(state),
    features: state.features.map((feature) => ({
      id: feature.id,
      remaining: feature.need - feature.done,
      complete: feature.complete,
      maintenance: maintenanceOf(state, feature),
    })),
  };
}

export function summarizeFeatureUpkeep(state: UpkeepState) {
  const maintenance = dueNow(state);
  return {
    completedValue: state.completedValue,
    completed: state.features.filter((feature) => feature.complete).map((feature) => feature.id),
    maintenance,
    shortfall: state.shortfall,
    nextSlack: state.capacity - maintenance,
    score: state.completedValue - state.shortfall * state.shortfallPenalty,
    lost: false,
  };
}

function nextFeature(state: UpkeepState): UpkeepFeature {
  return state.features.find((feature) => !feature.complete)?.id ?? 'api';
}

export function chooseUpkeepAction(state: UpkeepState, strategy: UpkeepStrategy): UpkeepInput {
  const maintain = strategy === 'staff' ? Math.min(dueNow(state), state.capacity) : 0;
  return { type: 'assign', feature: nextFeature(state), maintain };
}

function runUpkeep(seed: string, board: UpkeepBoard, strategy: UpkeepStrategy) {
  const initial = createFeatureUpkeep(seed, board);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 10) throw new Error(`${board}:${strategy}`);
    const input = chooseUpkeepAction(state, strategy);
    const next = applyFeatureUpkeep(state, input);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { initial, inputs: state.inputs, result: summarizeFeatureUpkeep(state) };
}

export function compareFeatureUpkeep(seed = 'RI-234') {
  return (['light', 'heavy'] as const).flatMap((board) =>
    (['rush', 'staff'] as const).map((strategy) => ({
      board,
      strategy,
      ...runUpkeep(seed, board, strategy),
    })),
  );
}

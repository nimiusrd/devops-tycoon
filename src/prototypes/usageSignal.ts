/** RI-233: 出荷完了は利用を保証しない。反応は seed の盤面で一度だけ。RI-229 の人数を使う。 */

import { rosterHeadcount } from './customerSegments';
import { PRODUCT_CAPACITY } from './productGrowth';

export type UsageFeature = 'api' | 'screen' | 'billing';
export type UsageSituation = 'star' | 'sleeper' | 'blocked';
export type UsageStrategy = 'skipRead' | 'extend' | 'repair';
export type UsageInput =
  | { type: 'ship' }
  | { type: 'observe' }
  | { type: 'extend'; feature: UsageFeature }
  | { type: 'repair'; feature: UsageFeature }
  | { type: 'collect' }
  | { type: 'view' };

export interface UsageState {
  version: 1;
  seed: string;
  situation: UsageSituation;
  tick: number;
  horizon: number;
  capacity: number;
  respondents: number;
  shipVolume: number;
  forecast: Record<UsageFeature, number>;
  actual: Record<UsageFeature, number>;
  retireValue: number;
  polishBonus: number;
  shipped: boolean;
  observed: boolean;
  repaired: UsageFeature | null;
  collected: boolean;
  value: number;
  inputs: UsageInput[];
}

const FEATURES: readonly UsageFeature[] = ['api', 'screen', 'billing'];
const FORECAST: Record<UsageFeature, number> = { api: 3, screen: 3, billing: 3 };
const WORK_PER_FEATURE = 5;
const RETIRE_VALUE = 8;
const POLISH_BONUS = 1;

const SITUATIONS: Record<UsageSituation, Record<UsageFeature, number>> = {
  star: { api: 4, screen: 1, billing: 1 },
  sleeper: { api: 1, screen: 2, billing: 4 },
  blocked: { api: 1, screen: 3, billing: 0 },
};

function isFeature(value: string): value is UsageFeature {
  return value === 'api' || value === 'screen' || value === 'billing';
}

function pickMax(usage: Record<UsageFeature, number>): UsageFeature {
  return FEATURES.reduce((best, id) => (usage[id] > usage[best] ? id : best));
}

function pickMin(usage: Record<UsageFeature, number>): UsageFeature {
  return FEATURES.reduce((best, id) => (usage[id] < usage[best] ? id : best));
}

export function createUsageSignal(seed: string, situation: UsageSituation): UsageState {
  return {
    version: 1,
    seed,
    situation,
    tick: 0,
    horizon: 4,
    capacity: PRODUCT_CAPACITY,
    respondents: rosterHeadcount('pioneer'),
    shipVolume: FEATURES.length * WORK_PER_FEATURE,
    forecast: { ...FORECAST },
    actual: { ...SITUATIONS[situation] },
    retireValue: RETIRE_VALUE,
    polishBonus: POLISH_BONUS,
    shipped: false,
    observed: false,
    repaired: null,
    collected: false,
    value: 0,
    inputs: [],
  };
}

function extendTarget(state: UsageState): UsageFeature {
  return pickMax(state.observed ? state.actual : state.forecast);
}

function repairGain(state: UsageState): number {
  if (state.repaired === null) return 0;
  const usage = state.actual[state.repaired];
  if (usage <= 0) return state.retireValue;
  return usage + state.polishBonus;
}

/** 出荷は機能を公開するだけで、利用量も価値も付けない。 */
export function applyUsageSignal(state: UsageState, input: UsageInput): UsageState {
  if (input.type === 'view' || state.tick >= state.horizon) return state;
  if (input.type === 'ship') {
    if (state.shipped) return state;
    const next = structuredClone(state);
    next.shipped = true;
    next.tick += 1;
    next.inputs.push({ type: 'ship' });
    return next;
  }
  if (!state.shipped) return state;
  if (input.type === 'observe') {
    if (state.observed) return state;
    const next = structuredClone(state);
    next.observed = true;
    next.tick += 1;
    next.inputs.push({ type: 'observe' });
    return next;
  }
  if (input.type === 'extend') {
    if (!isFeature(input.feature) || input.feature !== extendTarget(state)) return state;
    const next = structuredClone(state);
    next.value += next.actual[input.feature];
    next.tick += 1;
    next.inputs.push({ type: 'extend', feature: input.feature });
    return next;
  }
  if (input.type === 'repair') {
    if (!state.observed || state.repaired !== null || !isFeature(input.feature)) return state;
    if (input.feature !== pickMin(state.actual)) return state;
    const next = structuredClone(state);
    next.repaired = input.feature;
    next.tick += 1;
    next.inputs.push({ type: 'repair', feature: input.feature });
    return next;
  }
  if (input.type !== 'collect' || state.repaired === null || state.collected) return state;
  const next = structuredClone(state);
  next.value += repairGain(next);
  next.collected = true;
  next.tick += 1;
  next.inputs.push({ type: 'collect' });
  return next;
}

export function viewUsageSignal(state: UsageState) {
  const visible = {
    tick: state.tick,
    horizon: state.horizon,
    capacity: state.capacity,
    respondents: state.respondents,
    features: FEATURES,
    shipVolume: state.shipVolume,
    shipped: state.shipped,
    forecast: { ...state.forecast },
    observed: state.observed,
    retireValue: state.retireValue,
    polishBonus: state.polishBonus,
    repaired: state.repaired,
    collected: state.collected,
  };
  if (!state.observed) return visible;
  return { ...visible, usage: { ...state.actual } };
}

export function summarizeUsageSignal(state: UsageState) {
  return {
    value: state.value,
    shipVolume: state.shipVolume,
    observed: state.observed,
    repaired: state.repaired,
    score: state.value,
    lost: false,
  };
}

export function chooseUsageAction(state: UsageState, strategy: UsageStrategy): UsageInput {
  if (!state.shipped) return { type: 'ship' };
  if (strategy === 'skipRead') return { type: 'extend', feature: extendTarget(state) };
  if (!state.observed) return { type: 'observe' };
  if (strategy === 'extend') return { type: 'extend', feature: extendTarget(state) };
  if (state.repaired === null) return { type: 'repair', feature: pickMin(state.actual) };
  return { type: 'collect' };
}

function runUsage(seed: string, situation: UsageSituation, strategy: UsageStrategy) {
  const initial = createUsageSignal(seed, situation);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 10) throw new Error(`${situation}:${strategy}`);
    const input = chooseUsageAction(state, strategy);
    const next = applyUsageSignal(state, input);
    if (next === state) throw new Error(`${situation}:${strategy}@${state.tick}`);
    state = next;
  }
  return { initial, inputs: state.inputs, result: summarizeUsageSignal(state) };
}

export function compareUsageSignals(seed = 'RI-233') {
  return (['star', 'sleeper', 'blocked'] as const).flatMap((situation) =>
    (['skipRead', 'extend', 'repair'] as const).map((strategy) => ({
      situation,
      strategy,
      ...runUsage(seed, situation, strategy),
    })),
  );
}

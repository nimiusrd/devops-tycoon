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
  | { type: 'hold' }
  | { type: 'view' };

export interface UsageFactorRules {
  retireValue: number;
  observeTicks: number;
  forecastBias: number;
}

export interface UsageObserveRules {
  observeTicks: number;
}

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
const OBSERVE_TICKS = 1;

function forecastOf(bias: number): Record<UsageFeature, number> {
  return {
    api: Math.max(0, FORECAST.api + bias),
    screen: FORECAST.screen,
    billing: Math.max(0, FORECAST.billing - bias),
  };
}

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

export function createUsageSignal(
  seed: string,
  situation: UsageSituation,
  rules?: Partial<Pick<UsageFactorRules, 'retireValue' | 'forecastBias'>>,
): UsageState {
  return {
    version: 1,
    seed,
    situation,
    tick: 0,
    horizon: 4,
    capacity: PRODUCT_CAPACITY,
    respondents: rosterHeadcount('pioneer'),
    shipVolume: FEATURES.length * WORK_PER_FEATURE,
    forecast: forecastOf(rules?.forecastBias ?? 0),
    actual: { ...SITUATIONS[situation] },
    retireValue: rules?.retireValue ?? RETIRE_VALUE,
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

/** 出荷は機能を公開するだけで、利用量も価値も付けない。観測の期間は rules が無いとき 1。 */
export function applyUsageSignal(
  state: UsageState,
  input: UsageInput,
  rules?: UsageObserveRules,
): UsageState {
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
    const cost = rules?.observeTicks ?? OBSERVE_TICKS;
    if (!Number.isInteger(cost) || cost < 0 || state.tick + cost > state.horizon) return state;
    const next = structuredClone(state);
    next.observed = true;
    next.tick += cost;
    next.inputs.push({ type: 'observe' });
    return next;
  }
  if (input.type === 'hold') {
    if (!state.collected) return state;
    const next = structuredClone(state);
    next.tick += 1;
    next.inputs.push({ type: 'hold' });
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
  if (!state.collected) return { type: 'collect' };
  if (state.tick < state.horizon) return { type: 'hold' };
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

export type UsageFactorAxis = 'retireValue' | 'observeTicks' | 'forecastBias';
export type UsagePreference = 'extend' | 'repair' | 'tie';
export type UsageFactorHeld =
  | { observeTicks: number; forecastBias: number }
  | { retireValue: number; forecastBias: number }
  | { retireValue: number; observeTicks: number };

export interface UsageFactorRun {
  inputs: UsageInput[];
  result: ReturnType<typeof summarizeUsageSignal>;
}

export interface UsageFactorRow {
  axis: UsageFactorAxis;
  situation: UsageSituation;
  parameter: string;
  rules: UsageFactorRules;
  preference: UsagePreference;
  margin: number;
  leaders: UsageStrategy[];
  scores: Record<UsageStrategy, number>;
  runs: Record<UsageStrategy, UsageFactorRun>;
  initial: UsageState;
}

export interface UsageFactorReversal {
  axis: UsageFactorAxis;
  situation: UsageSituation;
  held: UsageFactorHeld;
  before: {
    parameter: string;
    preference: UsagePreference;
    skipRead: number;
    extend: number;
    repair: number;
  };
  after: {
    parameter: string;
    preference: UsagePreference;
    skipRead: number;
    extend: number;
    repair: number;
  };
}

export interface UsageFactorSeries {
  axis: UsageFactorAxis;
  situation: UsageSituation;
  held: UsageFactorHeld;
  rows: UsageFactorRow[];
  reversals: UsageFactorReversal[];
}

const FACTOR_AXES = ['retireValue', 'observeTicks', 'forecastBias'] as const;
const FACTOR_SITUATIONS = ['star', 'sleeper', 'blocked'] as const;
const FACTOR_STRATEGIES = ['skipRead', 'extend', 'repair'] as const;
const BASE_FACTOR: UsageFactorRules = {
  retireValue: RETIRE_VALUE,
  observeTicks: OBSERVE_TICKS,
  forecastBias: 0,
};
const FACTOR_VALUES: Record<UsageFactorAxis, readonly number[]> = {
  retireValue: [0, 5, 6, 7, 8, 12],
  observeTicks: [0, 1, 2, 3],
  forecastBias: [-2, -1, 0, 1, 2],
};

function rulesOnAxis(axis: UsageFactorAxis, value: number): UsageFactorRules {
  if (axis === 'retireValue') return { ...BASE_FACTOR, retireValue: value };
  if (axis === 'observeTicks') return { ...BASE_FACTOR, observeTicks: value };
  return { ...BASE_FACTOR, forecastBias: value };
}

function heldFor(axis: UsageFactorAxis): UsageFactorHeld {
  if (axis === 'retireValue') {
    return { observeTicks: BASE_FACTOR.observeTicks, forecastBias: BASE_FACTOR.forecastBias };
  }
  if (axis === 'observeTicks') {
    return { retireValue: BASE_FACTOR.retireValue, forecastBias: BASE_FACTOR.forecastBias };
  }
  return { retireValue: BASE_FACTOR.retireValue, observeTicks: BASE_FACTOR.observeTicks };
}

function playUsage(
  seed: string,
  situation: UsageSituation,
  strategy: UsageStrategy,
  rules: UsageFactorRules,
) {
  const initial = createUsageSignal(seed, situation, {
    retireValue: rules.retireValue,
    forecastBias: rules.forecastBias,
  });
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 10) throw new Error(`${situation}:${strategy}:${rules.observeTicks}`);
    const input = chooseUsageAction(state, strategy);
    const next = applyUsageSignal(state, input, { observeTicks: rules.observeTicks });
    if (next === state) throw new Error(`${situation}:${strategy}@${state.tick}`);
    state = next;
  }
  return { initial, inputs: state.inputs, result: summarizeUsageSignal(state) };
}

function sameUsage(left: UsageState, right: UsageState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function preferenceOf(extend: number, repair: number): UsagePreference {
  if (extend > repair) return 'extend';
  if (repair > extend) return 'repair';
  return 'tie';
}

function leadersOf(scores: Record<UsageStrategy, number>): UsageStrategy[] {
  const top = Math.max(scores.skipRead, scores.extend, scores.repair);
  return FACTOR_STRATEGIES.filter((strategy) => scores[strategy] === top);
}

function factorRow(
  seed: string,
  axis: UsageFactorAxis,
  situation: UsageSituation,
  value: number,
): UsageFactorRow {
  const rules = rulesOnAxis(axis, value);
  const skipRead = playUsage(seed, situation, 'skipRead', rules);
  const extend = playUsage(seed, situation, 'extend', rules);
  const repair = playUsage(seed, situation, 'repair', rules);
  if (
    !sameUsage(skipRead.initial, extend.initial) ||
    !sameUsage(skipRead.initial, repair.initial)
  ) {
    throw new Error(`${axis}:${situation}:${value}`);
  }
  const scores = {
    skipRead: skipRead.result.score,
    extend: extend.result.score,
    repair: repair.result.score,
  };
  return {
    axis,
    situation,
    parameter: String(value),
    rules,
    preference: preferenceOf(scores.extend, scores.repair),
    margin: scores.extend - scores.repair,
    leaders: leadersOf(scores),
    scores,
    runs: {
      skipRead: { inputs: skipRead.inputs, result: skipRead.result },
      extend: { inputs: extend.inputs, result: extend.result },
      repair: { inputs: repair.inputs, result: repair.result },
    },
    initial: skipRead.initial,
  };
}

function reversalsOf(rows: UsageFactorRow[], held: UsageFactorHeld): UsageFactorReversal[] {
  const found: UsageFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after || before.preference === after.preference) continue;
    found.push({
      axis: before.axis,
      situation: before.situation,
      held,
      before: {
        parameter: before.parameter,
        preference: before.preference,
        skipRead: before.scores.skipRead,
        extend: before.scores.extend,
        repair: before.scores.repair,
      },
      after: {
        parameter: after.parameter,
        preference: after.preference,
        skipRead: after.scores.skipRead,
        extend: after.scores.extend,
        repair: after.scores.repair,
      },
    });
  }
  return found;
}

function buildSeries(
  seed: string,
  axis: UsageFactorAxis,
  situation: UsageSituation,
): UsageFactorSeries {
  const held = heldFor(axis);
  const rows = FACTOR_VALUES[axis].map((value) => factorRow(seed, axis, situation, value));
  return { axis, situation, held, rows, reversals: reversalsOf(rows, held) };
}

/** 初回と同じ資源で、撤退値・観測期間・予測の偏りを一つずつ動かす。固定戦略。 */
export function compareUsageFactorReversals(seed = 'RI-233') {
  const sweeps = {
    retireValue: FACTOR_SITUATIONS.map((situation) => buildSeries(seed, 'retireValue', situation)),
    observeTicks: FACTOR_SITUATIONS.map((situation) =>
      buildSeries(seed, 'observeTicks', situation),
    ),
    forecastBias: FACTOR_SITUATIONS.map((situation) =>
      buildSeries(seed, 'forecastBias', situation),
    ),
  };
  return {
    conditions: {
      seed,
      features: [...FEATURES],
      capacity: PRODUCT_CAPACITY,
      respondents: rosterHeadcount('pioneer'),
      shipVolume: FEATURES.length * WORK_PER_FEATURE,
      horizon: 4,
      polishBonus: POLISH_BONUS,
      actual: {
        star: { ...SITUATIONS.star },
        sleeper: { ...SITUATIONS.sleeper },
        blocked: { ...SITUATIONS.blocked },
      },
      score:
        '観測後の追加は残期間×最大利用。撤退は利用0なら撤退値、それ以外は利用+改善の上乗せを一度',
      strategies: {
        skipRead: '出荷のあと予測の最大へ残期間を追加する。観測しない',
        extend: '出荷して観測し、見えた最大利用へ残期間を追加する',
        repair: '出荷して観測し、見えた最小利用を一度直し、次の期間に一度回収する',
      },
      decision: {
        compared: ['extend', 'repair'] as const,
        preference: '追加の得点が大きいとき追加、撤退の得点が大きいとき撤退、同じとき同点',
        margin: '追加の得点 - 撤退の得点',
        leaders: '予測のまま、追加、撤退のうち得点が最大の戦略。同点は複数',
      },
      baseline: { ...BASE_FACTOR },
      forecast:
        '偏り0は各機能3。正は api に足し billing から引く。負はその逆。screen は3。0未満は0',
      observe:
        '観測は一度で実際の利用を見せ、期間を observeTicks だけ進める。0は期間を使わない。改善と回収のあと余った期間は hold で得点を足さない',
      retire: '撤退値は利用0の機能を閉じたときだけ一度入る。利用1以上の改善は撤退値を使わない',
      held: {
        retireValue: '撤退値だけを動かす。観測は1期間。予測の偏りは0',
        observeTicks: '観測に使う期間だけを動かす。撤退値は8。予測の偏りは0。0から3まで',
        forecastBias: '予測の偏りだけを動かす。撤退値は8。観測は1期間。-2から2まで',
      },
      situations: {
        star: '利用が一つに偏る。実際は api 4、screen 1、billing 1',
        sleeper: '予測と違う機能が伸びる。実際は api 1、screen 2、billing 4',
        blocked: '使われない機能がある。実際は api 1、screen 3、billing 0',
      },
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    },
    sweeps,
    reversals: FACTOR_AXES.flatMap((axis) => sweeps[axis].flatMap((series) => series.reversals)),
  };
}

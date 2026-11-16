/** RI-198: 内製ハーネスの保守期限は最初から見え、導入直後には失効しない。 */
import { createRng, getRngState } from '../sim/rng';

export type HarnessKind = 'external' | 'inhouse';
export type HarnessStrategy = 'external' | 'skip' | 'on-time' | 'early';
export type HarnessInput =
  { type: 'choose'; kind: HarnessKind } | { type: 'update' } | { type: 'tick' };
export interface HarnessState {
  version: 1;
  seed: number;
  tick: number;
  horizon: number;
  kind: HarnessKind | null;
  generation: number;
  dueIn: number;
  updating: number;
  freshTicks: number;
  staleTicks: number;
  upkeepTicks: number;
  value: number;
  fees: number;
  inputs: HarnessInput[];
}
const GRACE = 4;
const UPDATE = 2;
const FRESH = 6;
const STALE = 2;
const FEE = 2;
export interface HarnessRules {
  grace: number;
  updateTicks: number;
  freshValue: number;
  staleValue: number;
  externalFee: number;
}
/** 初回比較の係数。猶予、更新tick、失効後の効果はここを基準に一つずつ動かす。 */
export const baselineHarnessRules: HarnessRules = {
  grace: GRACE,
  updateTicks: UPDATE,
  freshValue: FRESH,
  staleValue: STALE,
  externalFee: FEE,
};
export function createHarnessPrototype(
  seed: number,
  horizon: number,
  rules: HarnessRules = baselineHarnessRules,
): HarnessState {
  const rng = createRng(seed);
  rng();
  return {
    version: 1,
    seed,
    tick: 0,
    horizon,
    kind: null,
    generation: getRngState(rng),
    dueIn: rules.grace,
    updating: 0,
    freshTicks: 0,
    staleTicks: 0,
    upkeepTicks: 0,
    value: 0,
    fees: 0,
    inputs: [],
  };
}
export function viewHarness(state: HarnessState, rules: HarnessRules = baselineHarnessRules) {
  const effect =
    state.kind === null
      ? null
      : state.updating > 0
        ? 0
        : state.kind === 'external' || state.dueIn > 0
          ? rules.freshValue
          : rules.staleValue;
  return {
    tick: state.tick,
    horizon: state.horizon,
    kind: state.kind,
    generation: state.generation,
    grace: rules.grace,
    updateTicks: rules.updateTicks,
    freshValue: rules.freshValue,
    staleValue: rules.staleValue,
    externalFee: rules.externalFee,
    dueIn: state.kind === 'inhouse' ? state.dueIn : null,
    updating: state.updating,
    effect,
  };
}
export function applyHarnessInput(
  state: HarnessState,
  input: HarnessInput,
  rules: HarnessRules = baselineHarnessRules,
): HarnessState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'choose' && state.kind !== null) return state;
  if (input.type === 'update' && (state.kind !== 'inhouse' || state.updating > 0)) return state;
  if (input.type === 'tick' && state.kind === null) return state;
  if (input.type !== 'tick' && state.updating > 0) return state;
  const next = structuredClone(state);
  if (input.type === 'choose') next.kind = input.kind;
  else if (input.type === 'update') next.updating = rules.updateTicks;
  else if (next.updating > 0) {
    next.updating -= 1;
    next.upkeepTicks += 1;
    next.tick += 1;
    if (next.updating === 0) next.dueIn = rules.grace;
  } else if (next.kind === 'external') {
    next.value += rules.freshValue;
    next.fees += rules.externalFee;
    next.freshTicks += 1;
    next.tick += 1;
  } else if (next.dueIn === 0) {
    next.value += rules.staleValue;
    next.staleTicks += 1;
    next.tick += 1;
  } else {
    next.value += rules.freshValue;
    next.freshTicks += 1;
    next.dueIn -= 1;
    next.tick += 1;
  }
  next.inputs.push(structuredClone(input));
  return next;
}
export function summarizeHarness(state: HarnessState) {
  return {
    kind: state.kind,
    dueIn: state.kind === 'inhouse' ? state.dueIn : null,
    freshTicks: state.freshTicks,
    staleTicks: state.staleTicks,
    upkeepTicks: state.upkeepTicks,
    value: state.value,
    fees: state.fees,
    netValue: state.value - state.fees,
  };
}
export function chooseHarnessAction(
  state: HarnessState,
  strategy: HarnessStrategy,
  rules: HarnessRules = baselineHarnessRules,
): HarnessInput {
  if (state.kind === null) {
    return { type: 'choose', kind: strategy === 'external' ? 'external' : 'inhouse' };
  }
  if (state.updating > 0) return { type: 'tick' };
  if (
    strategy === 'early' &&
    state.kind === 'inhouse' &&
    state.dueIn === rules.grace &&
    state.upkeepTicks === 0 &&
    state.freshTicks === 0 &&
    state.staleTicks === 0
  ) {
    return { type: 'update' };
  }
  if (strategy === 'on-time' && state.kind === 'inhouse' && state.dueIn === 0)
    return { type: 'update' };
  return { type: 'tick' };
}
export function compareHarnessStrategies(seed = 198) {
  return ([4, 10] as const).flatMap((horizon) =>
    (['external', 'skip', 'on-time', 'early'] as const).map((strategy) => {
      const initial = createHarnessPrototype(seed, horizon);
      let state = initial;
      let guard = 0;
      while (state.tick < horizon) {
        if (++guard > 40) throw new Error(`${horizon}:${strategy}`);
        const next = applyHarnessInput(state, chooseHarnessAction(state, strategy));
        if (next === state) throw new Error(`${horizon}:${strategy}@${state.tick}`);
        state = next;
      }
      return { horizon, strategy, initial, inputs: state.inputs, result: summarizeHarness(state) };
    }),
  );
}
const FACTOR_SEED = 198;
const FACTOR_HORIZONS = [4, 10] as const;
const GRACE_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const UPDATE_VALUES = [1, 2, 3, 4, 5, 6] as const;
const STALE_VALUES = [0, 1, 2, 3, 4, 5, 6] as const;
export type HarnessFactorAxis = 'grace' | 'updateTicks' | 'staleValue';
export type HarnessPreference = 'maintain' | 'skip' | 'tie';
export interface HarnessFactorRun {
  inputs: HarnessInput[];
  result: ReturnType<typeof summarizeHarness>;
}
export interface HarnessFactorHorizon {
  horizon: (typeof FACTOR_HORIZONS)[number];
  preference: HarnessPreference;
  margin: number;
  maintain: HarnessFactorRun;
  skip: HarnessFactorRun;
}
export interface HarnessFactorPoint {
  axis: HarnessFactorAxis;
  parameter: string;
  rules: HarnessRules;
  sameAsFirstComparison: boolean;
  horizons: HarnessFactorHorizon[];
}
export interface HarnessFactorReversal {
  axis: HarnessFactorAxis;
  horizon: (typeof FACTOR_HORIZONS)[number];
  before: { parameter: string; preference: HarnessPreference; maintain: number; skip: number };
  after: { parameter: string; preference: HarnessPreference; maintain: number; skip: number };
}
function preferenceOf(maintainNet: number, skipNet: number): HarnessPreference {
  if (maintainNet > skipNet) return 'maintain';
  if (skipNet > maintainNet) return 'skip';
  return 'tie';
}
function rulesMatchBaseline(rules: HarnessRules) {
  return (
    rules.grace === baselineHarnessRules.grace &&
    rules.updateTicks === baselineHarnessRules.updateTicks &&
    rules.freshValue === baselineHarnessRules.freshValue &&
    rules.staleValue === baselineHarnessRules.staleValue &&
    rules.externalFee === baselineHarnessRules.externalFee
  );
}
function runHarnessFactor(
  rules: HarnessRules,
  horizon: number,
  strategy: 'on-time' | 'skip',
): HarnessFactorRun {
  let state = createHarnessPrototype(FACTOR_SEED, horizon, rules);
  let guard = 0;
  while (state.tick < horizon) {
    if (++guard > 80) throw new Error(`${horizon}:${strategy}:${rules.grace}`);
    const action = chooseHarnessAction(state, strategy, rules);
    const next = applyHarnessInput(state, action, rules);
    if (next === state) throw new Error(`${horizon}:${strategy}@${state.tick}`);
    state = next;
  }
  return { inputs: state.inputs, result: summarizeHarness(state) };
}
function factorPoint(
  axis: HarnessFactorAxis,
  parameter: string,
  rules: HarnessRules,
): HarnessFactorPoint {
  const horizons = FACTOR_HORIZONS.map((horizon) => {
    const maintain = runHarnessFactor(rules, horizon, 'on-time');
    const skip = runHarnessFactor(rules, horizon, 'skip');
    return {
      horizon,
      preference: preferenceOf(maintain.result.netValue, skip.result.netValue),
      margin: maintain.result.netValue - skip.result.netValue,
      maintain,
      skip,
    };
  });
  return {
    axis,
    parameter,
    rules: { ...rules },
    sameAsFirstComparison: rulesMatchBaseline(rules),
    horizons,
  };
}
function reversalsOf(rows: HarnessFactorPoint[]): HarnessFactorReversal[] {
  const found: HarnessFactorReversal[] = [];
  for (const horizon of FACTOR_HORIZONS) {
    const series = rows.map((row) => {
      const point = row.horizons.find((item) => item.horizon === horizon);
      if (!point) throw new Error(`${row.axis}:${row.parameter}:${horizon}`);
      return { parameter: row.parameter, axis: row.axis, point };
    });
    for (let index = 1; index < series.length; index += 1) {
      const before = series[index - 1];
      const after = series[index];
      if (!before || !after || before.point.preference === after.point.preference) continue;
      found.push({
        axis: before.axis,
        horizon,
        before: {
          parameter: before.parameter,
          preference: before.point.preference,
          maintain: before.point.maintain.result.netValue,
          skip: before.point.skip.result.netValue,
        },
        after: {
          parameter: after.parameter,
          preference: after.point.preference,
          maintain: after.point.maintain.result.netValue,
          skip: after.point.skip.result.netValue,
        },
      });
    }
  }
  return found;
}
/** 初回と同じ資源で、猶予、更新tick、失効後の効果を一つずつ動かす。固定戦略。 */
export function compareHarnessFactorReversals() {
  const sweeps = {
    grace: GRACE_VALUES.map((grace) =>
      factorPoint('grace', String(grace), { ...baselineHarnessRules, grace }),
    ),
    updateTicks: UPDATE_VALUES.map((updateTicks) =>
      factorPoint('updateTicks', String(updateTicks), { ...baselineHarnessRules, updateTicks }),
    ),
    staleValue: STALE_VALUES.map((staleValue) =>
      factorPoint('staleValue', String(staleValue), { ...baselineHarnessRules, staleValue }),
    ),
  };
  return {
    conditions: {
      seed: FACTOR_SEED,
      horizons: [...FACTOR_HORIZONS],
      freshValue: baselineHarnessRules.freshValue,
      externalFee: baselineHarnessRules.externalFee,
      decision: { maintain: 'on-time' as const, skip: 'skip' as const, score: 'netValue' as const },
      baseline: { ...baselineHarnessRules },
      held: {
        grace:
          '猶予だけを1から10まで動かす。更新tickは2、失効後の効果は2。満額は6、外部利用費は2。期末は4と10',
        updateTicks:
          '更新tickだけを1から6まで動かす。猶予は4、失効後の効果は2。満額は6、外部利用費は2。期末は4と10',
        staleValue:
          '失効後の効果だけを0から6まで動かす。猶予は4、更新tickは2。満額は6、外部利用費は2。期末は4と10',
      },
      updateRestoresGrace: true,
      staleStartsAfterDue: true,
      omitted: '外部道具と序盤更新は初回JSONのまま再出力しない',
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    },
    sweeps,
    reversals: [
      ...reversalsOf(sweeps.grace),
      ...reversalsOf(sweeps.updateTicks),
      ...reversalsOf(sweeps.staleValue),
    ],
  };
}

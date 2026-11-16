/** RI-229: 同じ製品出荷でも顧客構成で満足が変わる。人数は固定で、RI-228 の機能完成を使う。感度では完成点数、事故の不満、人数比を一つずつ動かす。 */

import {
  applyProductGrowth,
  chooseProductSpend,
  createProductGrowth,
  summarizeProductGrowth,
  viewProductGrowth,
  type ProductInput,
  type ProductState,
  type ProductStrategy,
} from './productGrowth';

export type CustomerMix = 'pioneer' | 'keeper';
export type CustomerStrategy = ProductStrategy;

export interface CustomerRoster {
  pioneers: number;
  keepers: number;
}

export interface CustomerState {
  version: 1;
  seed: string;
  mix: CustomerMix;
  pioneers: number;
  keepers: number;
  pioneerPerFeature: number;
  pioneerIfNoFeature: number;
  keeperPerSafe: number;
  keeperPerIncident: number;
  product: ProductState;
  pioneerScore: number;
  keeperScore: number;
  inputs: ProductInput[];
}

const PIONEER_PER_FEATURE = 10;
const PIONEER_IF_NO_FEATURE = -3;
const KEEPER_PER_SAFE = 2;
const KEEPER_PER_INCIDENT = -4;

const ROSTERS: Record<CustomerMix, CustomerRoster> = {
  pioneer: { pioneers: 3, keepers: 1 },
  keeper: { pioneers: 1, keepers: 3 },
};

/** 初回比較の係数。感度では完成点数か事故の不満か人数のどれか一つだけを変える。 */
export const baselineCustomerCoefficients = {
  pioneerPerFeature: PIONEER_PER_FEATURE,
  pioneerIfNoFeature: PIONEER_IF_NO_FEATURE,
  keeperPerSafe: KEEPER_PER_SAFE,
  keeperPerIncident: KEEPER_PER_INCIDENT,
} as const;

export interface CustomerFactorPatch {
  pioneers: number;
  keepers: number;
  pioneerPerFeature: number;
  keeperPerIncident: number;
}

export function rosterOf(mix: CustomerMix): CustomerRoster {
  return { ...ROSTERS[mix] };
}

/** 顧客層の合計人数。構成が違っても総数は増えない。 */
export function rosterHeadcount(mix: CustomerMix): number {
  const roster = ROSTERS[mix];
  return roster.pioneers + roster.keepers;
}

export function createCustomerSegments(seed: string, mix: CustomerMix): CustomerState {
  const roster = rosterOf(mix);
  return {
    version: 1,
    seed,
    mix,
    pioneers: roster.pioneers,
    keepers: roster.keepers,
    pioneerPerFeature: PIONEER_PER_FEATURE,
    pioneerIfNoFeature: PIONEER_IF_NO_FEATURE,
    keeperPerSafe: KEEPER_PER_SAFE,
    keeperPerIncident: KEEPER_PER_INCIDENT,
    product: createProductGrowth(seed, 'blocked'),
    pioneerScore: 0,
    keeperScore: 0,
    inputs: [],
  };
}

/** 新機能層は完成機能、安定層は事故の有無で満足が変わる。未投入は割当合計が0の期間だけ。 */
export function applyCustomerSegments(state: CustomerState, input: ProductInput): CustomerState {
  if (input.type === 'view') return state;
  const product = applyProductGrowth(state.product, input);
  if (product === state.product) return state;
  const period = product.periods[product.periods.length - 1];
  if (!period) return state;
  const next = structuredClone(state);
  next.product = product;
  next.inputs = product.inputs;
  const assigned =
    input.type === 'spend' ? input.spend.api + input.spend.screen + input.spend.billing : 0;
  const pioneerEach =
    period.completed.length * next.pioneerPerFeature +
    (assigned === 0 ? next.pioneerIfNoFeature : 0);
  const keeperEach = period.incident > 0 ? next.keeperPerIncident : next.keeperPerSafe;
  next.pioneerScore += pioneerEach * next.pioneers;
  next.keeperScore += keeperEach * next.keepers;
  return next;
}

export function viewCustomerSegments(state: CustomerState) {
  return {
    tick: state.product.tick,
    mix: state.mix,
    pioneers: state.pioneers,
    keepers: state.keepers,
    pioneerWants: 'feature-completion' as const,
    pioneerRejects: 'no-feature-work' as const,
    keeperWants: 'ops-cover' as const,
    keeperRejects: 'incident' as const,
    pioneerPerFeature: state.pioneerPerFeature,
    pioneerIfNoFeature: state.pioneerIfNoFeature,
    keeperPerSafe: state.keeperPerSafe,
    keeperPerIncident: state.keeperPerIncident,
    product: viewProductGrowth(state.product),
  };
}

export function summarizeCustomerSegments(state: CustomerState) {
  const product = summarizeProductGrowth(state.product);
  return {
    pioneerScore: state.pioneerScore,
    keeperScore: state.keeperScore,
    score: state.pioneerScore + state.keeperScore,
    shippedWork: product.shippedWork,
    completed: product.completed,
    incident: product.incident,
    lost: false,
  };
}

export function chooseCustomerAction(
  state: CustomerState,
  strategy: CustomerStrategy,
): ProductInput {
  return chooseProductSpend(state.product, strategy);
}

export function compareCustomerSegments(seed = 'RI-229') {
  return (['pioneer', 'keeper'] as const).flatMap((mix) =>
    (['focus', 'spread', 'ops'] as const).map((strategy) => {
      const initial = createCustomerSegments(seed, mix);
      let state = initial;
      let guard = 0;
      while (state.product.tick < state.product.horizon) {
        if (++guard > 10) throw new Error(`${mix}:${strategy}`);
        const input = chooseCustomerAction(state, strategy);
        const next = applyCustomerSegments(state, input);
        if (next === state) throw new Error(`${mix}:${strategy}@${state.product.tick}`);
        state = next;
      }
      return {
        mix,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeCustomerSegments(state),
      };
    }),
  );
}

export type CustomerPreference = 'focus' | 'ops' | 'tie';

/** 人数が同数のとき mix は pioneer になる。比較に使う人数は pioneers と keepers。 */
export function createCustomerFactorState(seed: string, patch: CustomerFactorPatch): CustomerState {
  const mix: CustomerMix = patch.keepers > patch.pioneers ? 'keeper' : 'pioneer';
  const created = createCustomerSegments(seed, mix);
  return {
    ...created,
    pioneers: patch.pioneers,
    keepers: patch.keepers,
    pioneerPerFeature: patch.pioneerPerFeature,
    keeperPerIncident: patch.keeperPerIncident,
  };
}

function preferenceOf(focus: number, ops: number): CustomerPreference {
  if (focus > ops) return 'focus';
  if (ops > focus) return 'ops';
  return 'tie';
}

function sameInputs(actual: ProductInput[], expected: ProductInput[]): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function runFactorStrategy(
  seed: string,
  patch: CustomerFactorPatch,
  strategy: CustomerStrategy,
  expectedInputs: ProductInput[],
) {
  let state = createCustomerFactorState(seed, patch);
  let guard = 0;
  while (state.product.tick < state.product.horizon) {
    if (++guard > 10) throw new Error(`${strategy}@${state.product.tick}`);
    const input = chooseCustomerAction(state, strategy);
    const next = applyCustomerSegments(state, input);
    if (next === state) throw new Error(`${strategy}@${state.product.tick}`);
    state = next;
  }
  if (!sameInputs(state.inputs, expectedInputs)) throw new Error(`${strategy}:inputs`);
  return summarizeCustomerSegments(state);
}

interface FactorRoster {
  pioneers: number;
  keepers: number;
  focus: ReturnType<typeof summarizeCustomerSegments>;
  ops: ReturnType<typeof summarizeCustomerSegments>;
  spread: ReturnType<typeof summarizeCustomerSegments>;
  preference: CustomerPreference;
  margin: number;
}

function factorRoster(
  seed: string,
  patch: CustomerFactorPatch,
  inputs: Record<CustomerStrategy, ProductInput[]>,
): FactorRoster {
  const focus = runFactorStrategy(seed, patch, 'focus', inputs.focus);
  const ops = runFactorStrategy(seed, patch, 'ops', inputs.ops);
  const spread = runFactorStrategy(seed, patch, 'spread', inputs.spread);
  return {
    pioneers: patch.pioneers,
    keepers: patch.keepers,
    focus,
    ops,
    spread,
    preference: preferenceOf(focus.score, ops.score),
    margin: focus.score - ops.score,
  };
}

interface FactorPoint {
  axis: 'featurePoints' | 'incidentDissatisfaction' | 'headcountRatio';
  parameter: string;
  pioneerPerFeature: number;
  keeperPerIncident: number;
  rosters: FactorRoster[];
}

function featurePoint(
  seed: string,
  pioneerPerFeature: number,
  inputs: Record<CustomerStrategy, ProductInput[]>,
): FactorPoint {
  const keeperPerIncident = KEEPER_PER_INCIDENT;
  return {
    axis: 'featurePoints',
    parameter: String(pioneerPerFeature),
    pioneerPerFeature,
    keeperPerIncident,
    rosters: [
      factorRoster(seed, { pioneers: 3, keepers: 1, pioneerPerFeature, keeperPerIncident }, inputs),
      factorRoster(seed, { pioneers: 1, keepers: 3, pioneerPerFeature, keeperPerIncident }, inputs),
    ],
  };
}

function incidentPoint(
  seed: string,
  keeperPerIncident: number,
  inputs: Record<CustomerStrategy, ProductInput[]>,
): FactorPoint {
  const pioneerPerFeature = PIONEER_PER_FEATURE;
  return {
    axis: 'incidentDissatisfaction',
    parameter: String(keeperPerIncident),
    pioneerPerFeature,
    keeperPerIncident,
    rosters: [
      factorRoster(seed, { pioneers: 3, keepers: 1, pioneerPerFeature, keeperPerIncident }, inputs),
      factorRoster(seed, { pioneers: 1, keepers: 3, pioneerPerFeature, keeperPerIncident }, inputs),
    ],
  };
}

function ratioPoint(
  seed: string,
  pioneers: number,
  keepers: number,
  inputs: Record<CustomerStrategy, ProductInput[]>,
): FactorPoint {
  return {
    axis: 'headcountRatio',
    parameter: `${pioneers}:${keepers}`,
    pioneerPerFeature: PIONEER_PER_FEATURE,
    keeperPerIncident: KEEPER_PER_INCIDENT,
    rosters: [
      factorRoster(
        seed,
        {
          pioneers,
          keepers,
          pioneerPerFeature: PIONEER_PER_FEATURE,
          keeperPerIncident: KEEPER_PER_INCIDENT,
        },
        inputs,
      ),
    ],
  };
}

function reversalsOf(rows: FactorPoint[]) {
  const found: {
    axis: FactorPoint['axis'];
    before: {
      parameter: string;
      pioneers: number;
      keepers: number;
      preference: CustomerPreference;
      focus: number;
      ops: number;
    };
    after: {
      parameter: string;
      pioneers: number;
      keepers: number;
      preference: CustomerPreference;
      focus: number;
      ops: number;
    };
  }[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after) continue;
    const count = Math.max(before.rosters.length, after.rosters.length);
    for (let rosterIndex = 0; rosterIndex < count; rosterIndex += 1) {
      const early = before.rosters[rosterIndex];
      const late = after.rosters[rosterIndex];
      if (!early || !late || early.preference === late.preference) continue;
      found.push({
        axis: before.axis,
        before: {
          parameter: before.parameter,
          pioneers: early.pioneers,
          keepers: early.keepers,
          preference: early.preference,
          focus: early.focus.score,
          ops: early.ops.score,
        },
        after: {
          parameter: after.parameter,
          pioneers: late.pioneers,
          keepers: late.keepers,
          preference: late.preference,
          focus: late.focus.score,
          ops: late.ops.score,
        },
      });
    }
  }
  return found;
}

function canonicalInputs(seed: string) {
  const patch: CustomerFactorPatch = {
    pioneers: 3,
    keepers: 1,
    pioneerPerFeature: PIONEER_PER_FEATURE,
    keeperPerIncident: KEEPER_PER_INCIDENT,
  };
  const read = (strategy: CustomerStrategy) => {
    let state = createCustomerFactorState(seed, patch);
    let guard = 0;
    while (state.product.tick < state.product.horizon) {
      if (++guard > 10) throw new Error(strategy);
      const input = chooseCustomerAction(state, strategy);
      const next = applyCustomerSegments(state, input);
      if (next === state) throw new Error(`${strategy}@${state.product.tick}`);
      state = next;
    }
    return state.inputs;
  };
  return { focus: read('focus'), spread: read('spread'), ops: read('ops') };
}

/** 初回と同じ資源で、完成点数・事故の不満・人数比を一つずつ動かす。固定戦略。 */
export function compareCustomerSegmentFactorReversals(seed = 'RI-229') {
  const inputs = canonicalInputs(seed);
  const probe = createCustomerSegments(seed, 'pioneer');
  const feature = probe.product.features[0];
  if (!feature) throw new Error('feature');
  const sweeps = {
    featurePoints: [0, 5, 6, 7, 10, 53, 54, 55].map((points) => featurePoint(seed, points, inputs)),
    incidentDissatisfaction: [-9, -8, -7, -4, 0].map((dissatisfaction) =>
      incidentPoint(seed, dissatisfaction, inputs),
    ),
    headcountRatio: (
      [
        [4, 0],
        [3, 1],
        [2, 2],
        [1, 3],
        [0, 4],
      ] as const
    ).map(([pioneers, keepers]) => ratioPoint(seed, pioneers, keepers, inputs)),
  };
  return {
    conditions: {
      seed,
      board: probe.product.board,
      horizon: probe.product.horizon,
      capacity: probe.product.capacity,
      featureNeed: feature.need,
      incidentIfIdle: probe.product.incidentIfIdle,
      totalHeadcount: rosterHeadcount('pioneer'),
      pioneerIfNoFeature: PIONEER_IF_NO_FEATURE,
      keeperPerSafe: KEEPER_PER_SAFE,
      baseline: {
        pioneerPerFeature: PIONEER_PER_FEATURE,
        keeperPerIncident: KEEPER_PER_INCIDENT,
        rosters: [rosterOf('pioneer'), rosterOf('keeper')],
      },
      inputs,
      held: {
        featurePoints:
          '完成点数だけを動かす。事故の不満は-4、人数は3対1と1対3、未投入の失敗は-3、無事故は2',
        incidentDissatisfaction:
          '事故の不満だけを動かす。完成点数は10、人数は3対1と1対3、未投入の失敗は-3、無事故は2。不満は0以下',
        headcountRatio:
          '人数比だけを動かす。合計は4人。完成点数は10、事故の不満は-4、未投入の失敗は-3、無事故は2',
      },
      decision: {
        focus: 'focus',
        stability: 'ops',
        score: 'pioneerScore + keeperScore',
        preference:
          '集中の差引が大きいとき新機能層を優先、運用枠が大きいとき安定層を優先、同じとき同点',
      },
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    },
    sweeps,
    reversals: [
      ...reversalsOf(sweeps.featurePoints),
      ...reversalsOf(sweeps.incidentDissatisfaction),
      ...reversalsOf(sweeps.headcountRatio),
    ],
  };
}

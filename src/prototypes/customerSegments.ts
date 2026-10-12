/** RI-229: 同じ製品出荷でも顧客構成で満足が変わる。人数は固定で、RI-228 の機能完成を使う。 */

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

const ROSTERS: Record<CustomerMix, CustomerRoster> = {
  pioneer: { pioneers: 3, keepers: 1 },
  keeper: { pioneers: 1, keepers: 3 },
};

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
    pioneerPerFeature: 10,
    pioneerIfNoFeature: -3,
    keeperPerSafe: 2,
    keeperPerIncident: -4,
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

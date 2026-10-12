/** RI-232: 試作品は完成品の報酬を出さない。反応は seed の盤面で一度だけ。RI-229 の人数を使う。 */

import { rosterHeadcount } from './customerSegments';
import { PRODUCT_CAPACITY } from './productGrowth';

export type ProbeFeature = 'api' | 'screen';
export type ProbeSituation = 'confident' | 'unsure' | 'open';
export type ProbeStrategy = 'shipNow' | 'probeThen' | 'shipOther';
export type ProbeReaction = 'yes' | 'no';
export type ProbeInput =
  | { type: 'probe'; feature: ProbeFeature }
  | { type: 'ship'; feature: ProbeFeature }
  | { type: 'view' };

export interface ProbeState {
  version: 1;
  seed: string;
  situation: ProbeSituation;
  tick: number;
  horizon: number;
  capacity: number;
  respondents: number;
  demand: ProbeFeature;
  rumor: ProbeFeature;
  fades: boolean;
  rumorWeight: number;
  otherWeight: number;
  fullReward: number;
  lateReward: number;
  probeReward: number;
  probed: boolean;
  probedFeature: ProbeFeature | null;
  reaction: ProbeReaction | null;
  shipped: boolean;
  delivered: boolean;
  value: number;
  probeValue: number;
  opportunityLoss: number;
  inputs: ProbeInput[];
}

const SITUATIONS: Record<
  ProbeSituation,
  { fades: boolean; rumorWeight: number; otherWeight: number }
> = {
  confident: { fades: true, rumorWeight: 4, otherWeight: 1 },
  unsure: { fades: true, rumorWeight: 1, otherWeight: 1 },
  open: { fades: false, rumorWeight: 1, otherWeight: 1 },
};

function isFeature(value: string): value is ProbeFeature {
  return value === 'api' || value === 'screen';
}

export function createDemandProbe(
  seed: string,
  situation: ProbeSituation,
  demand: ProbeFeature,
): ProbeState {
  const preset = SITUATIONS[situation];
  return {
    version: 1,
    seed,
    situation,
    tick: 0,
    horizon: 3,
    capacity: PRODUCT_CAPACITY,
    respondents: rosterHeadcount('pioneer'),
    demand,
    rumor: 'api',
    fades: preset.fades,
    rumorWeight: preset.rumorWeight,
    otherWeight: preset.otherWeight,
    fullReward: 14,
    lateReward: 6,
    probeReward: 2,
    probed: false,
    probedFeature: null,
    reaction: null,
    shipped: false,
    delivered: false,
    value: 0,
    probeValue: 0,
    opportunityLoss: 0,
    inputs: [],
  };
}

function other(feature: ProbeFeature): ProbeFeature {
  return feature === 'api' ? 'screen' : 'api';
}

/** 消失する観測では、最初の期間に全額を取れなければ機会損失を一度だけ記録する。 */
function closeFirstPeriod(next: ProbeState) {
  const opened = next.tick;
  if (opened === 0 && next.fades && !(next.delivered && next.value >= next.fullReward)) {
    next.opportunityLoss = next.fullReward - next.lateReward;
  }
  next.tick = opened + 1;
}

/** 試作品の反応は需要で決まり、二度目と、一度でも出荷したあとは状態を変えない。 */
export function applyDemandProbe(state: ProbeState, input: ProbeInput): ProbeState {
  if (input.type === 'view' || state.tick >= state.horizon) return state;
  if (input.type === 'probe') {
    if (state.probed || state.shipped || !isFeature(input.feature)) return state;
    const next = structuredClone(state);
    next.probed = true;
    next.probedFeature = input.feature;
    next.reaction = input.feature === next.demand ? 'yes' : 'no';
    next.probeValue += next.probeReward;
    next.value += next.probeReward;
    closeFirstPeriod(next);
    next.inputs.push({ type: 'probe', feature: input.feature });
    return next;
  }
  if (input.type !== 'ship' || !isFeature(input.feature)) return state;
  const next = structuredClone(state);
  next.shipped = true;
  if (!next.delivered && input.feature === next.demand) {
    next.delivered = true;
    const faded = next.fades && next.tick > 0;
    next.value += faded ? next.lateReward : next.fullReward;
  }
  closeFirstPeriod(next);
  next.inputs.push({ type: 'ship', feature: input.feature });
  return next;
}

export function viewDemandProbe(state: ProbeState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    capacity: state.capacity,
    respondents: state.respondents,
    candidates: ['api', 'screen'] as const,
    rumor: state.rumor,
    situation: state.situation,
    rumorWeight: state.rumorWeight,
    otherWeight: state.otherWeight,
    probed: state.probed,
    probedFeature: state.probedFeature,
    reaction: state.reaction,
    shipped: state.shipped,
    fullReward: state.fullReward,
    lateReward: state.fades ? state.lateReward : state.fullReward,
    probeReward: state.probeReward,
    fades: state.fades,
  };
}

export function summarizeDemandProbe(state: ProbeState) {
  return {
    value: state.value,
    probeValue: state.probeValue,
    opportunityLoss: state.opportunityLoss,
    delivered: state.delivered,
    score: state.value,
    lost: false,
  };
}

export function chooseDemandAction(state: ProbeState, strategy: ProbeStrategy): ProbeInput {
  if (strategy === 'shipNow') return { type: 'ship', feature: state.rumor };
  if (strategy === 'shipOther') return { type: 'ship', feature: other(state.rumor) };
  if (!state.probed || state.probedFeature === null || state.reaction === null) {
    return { type: 'probe', feature: state.rumor };
  }
  const feature = state.reaction === 'yes' ? state.probedFeature : other(state.probedFeature);
  return { type: 'ship', feature };
}

function runWorld(
  seed: string,
  situation: ProbeSituation,
  demand: ProbeFeature,
  strategy: ProbeStrategy,
) {
  const initial = createDemandProbe(seed, situation, demand);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 10) throw new Error(`${situation}:${demand}:${strategy}`);
    const input = chooseDemandAction(state, strategy);
    const next = applyDemandProbe(state, input);
    if (next === state) throw new Error(`${situation}:${demand}:${strategy}@${state.tick}`);
    state = next;
  }
  return { demand, initial, inputs: state.inputs, result: summarizeDemandProbe(state) };
}

export function compareDemandProbes(seed = 'RI-232') {
  return (['confident', 'unsure', 'open'] as const).flatMap((situation) =>
    (['shipNow', 'probeThen', 'shipOther'] as const).map((strategy) => {
      const rumorWorld = runWorld(seed, situation, 'api', strategy);
      const otherWorld = runWorld(seed, situation, 'screen', strategy);
      const { rumorWeight, otherWeight } = rumorWorld.initial;
      return {
        situation,
        strategy,
        rumorWeight,
        otherWeight,
        expected: rumorWeight * rumorWorld.result.score + otherWeight * otherWorld.result.score,
        opportunity:
          rumorWeight * rumorWorld.result.opportunityLoss +
          otherWeight * otherWorld.result.opportunityLoss,
        worlds: [rumorWorld, otherWorld],
      };
    }),
  );
}

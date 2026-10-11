/** RI-232: 試作品は完成品の報酬を出さない。反応は seed の盤面で一度だけ。RI-229 の人数を使う。 */

import { rosterHeadcount } from './customerSegments';
import { PRODUCT_CAPACITY } from './productGrowth';

export type ProbeFeature = 'api' | 'screen';
export type ProbeBoard = 'fade' | 'decoy';
export type ProbeStrategy = 'shipNow' | 'probeThen' | 'shipOther';
export type ProbeReaction = 'yes' | 'no';
export type ProbeInput =
  | { type: 'probe'; feature: ProbeFeature }
  | { type: 'ship'; feature: ProbeFeature }
  | { type: 'view' };

export interface ProbeState {
  version: 1;
  seed: string;
  board: ProbeBoard;
  tick: number;
  horizon: number;
  capacity: number;
  respondents: number;
  demand: ProbeFeature;
  rumor: ProbeFeature;
  fades: boolean;
  fullReward: number;
  lateReward: number;
  probeReward: number;
  probed: boolean;
  probedFeature: ProbeFeature | null;
  reaction: ProbeReaction | null;
  delivered: boolean;
  value: number;
  probeValue: number;
  opportunityLoss: number;
  inputs: ProbeInput[];
}

const BOARDS: Record<ProbeBoard, { demand: ProbeFeature; fades: boolean; lateReward: number }> = {
  fade: { demand: 'api', fades: true, lateReward: 6 },
  decoy: { demand: 'screen', fades: false, lateReward: 14 },
};

function isFeature(value: string): value is ProbeFeature {
  return value === 'api' || value === 'screen';
}

export function createDemandProbe(seed: string, board: ProbeBoard): ProbeState {
  const preset = BOARDS[board];
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 3,
    capacity: PRODUCT_CAPACITY,
    respondents: rosterHeadcount('pioneer'),
    demand: preset.demand,
    rumor: 'api',
    fades: preset.fades,
    fullReward: 14,
    lateReward: preset.lateReward,
    probeReward: 2,
    probed: false,
    probedFeature: null,
    reaction: null,
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

/** 試作品の反応は盤面で決まり、二度目は状態を変えない。完成報酬は出荷の一度だけ。 */
export function applyDemandProbe(state: ProbeState, input: ProbeInput): ProbeState {
  if (input.type === 'view' || state.tick >= state.horizon) return state;
  if (input.type === 'probe') {
    if (state.probed || !isFeature(input.feature)) return state;
    const next = structuredClone(state);
    next.probed = true;
    next.probedFeature = input.feature;
    next.reaction = input.feature === next.demand ? 'yes' : 'no';
    next.probeValue += next.probeReward;
    next.value += next.probeReward;
    next.tick += 1;
    next.inputs.push({ type: 'probe', feature: input.feature });
    return next;
  }
  if (input.type !== 'ship' || !isFeature(input.feature)) return state;
  const next = structuredClone(state);
  if (!next.delivered && input.feature === next.demand) {
    next.delivered = true;
    const faded = next.fades && next.tick > 0;
    next.value += faded ? next.lateReward : next.fullReward;
    if (faded) next.opportunityLoss += next.fullReward - next.lateReward;
  }
  next.tick += 1;
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
    probed: state.probed,
    probedFeature: state.probedFeature,
    reaction: state.reaction,
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
  if (!state.probed) return { type: 'probe', feature: state.rumor };
  const feature = state.reaction === 'yes' ? state.rumor : other(state.rumor);
  return { type: 'ship', feature };
}

export function compareDemandProbes(seed = 'RI-232') {
  return (['fade', 'decoy'] as const).flatMap((board) =>
    (['shipNow', 'probeThen', 'shipOther'] as const).map((strategy) => {
      const initial = createDemandProbe(seed, board);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 10) throw new Error(`${board}:${strategy}`);
        const input = chooseDemandAction(state, strategy);
        const next = applyDemandProbe(state, input);
        if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
        state = next;
      }
      return {
        board,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeDemandProbe(state),
      };
    }),
  );
}

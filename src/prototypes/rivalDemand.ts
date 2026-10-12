/** RI-239: 競合の公開時刻は自社の選択で変わらない。需要は完成した時点の表を一度だけ使う。 */

import { rosterHeadcount } from './customerSegments';
import { applyFeatureWork } from './productGrowth';

export type RivalBoard = 'preempt' | 'proof';
export type RivalStrategy = 'follow' | 'differentiate';
export type RivalFeature = 'match' | 'own';
export type RivalInput = { type: 'work'; feature: RivalFeature } | { type: 'view' };

export interface RivalPrices {
  match: number;
  own: number;
}

export interface RivalNotice {
  feature: 'match';
  releaseTick: number;
  segment: 'pioneer';
  respondents: number;
  before: RivalPrices;
  after: RivalPrices;
}

export interface RivalPart {
  id: RivalFeature;
  need: number;
  done: number;
}

export interface RivalPeriod {
  tick: number;
  feature: RivalFeature;
  completed: boolean;
  price: number;
  value: number;
}

export interface RivalState {
  version: 1;
  seed: string;
  board: RivalBoard;
  tick: number;
  horizon: number;
  capacity: number;
  rival: RivalNotice;
  parts: RivalPart[];
  value: number;
  periods: RivalPeriod[];
  inputs: RivalInput[];
}

const NEED = 4;
const CAPACITY = 4;
const BEFORE: RivalPrices = { match: 8, own: 8 };
const AFTER: Record<RivalBoard, RivalPrices> = {
  preempt: { match: 3, own: 10 },
  proof: { match: 14, own: 6 },
};

function isFeature(value: string): value is RivalFeature {
  return value === 'match' || value === 'own';
}

function prices(state: RivalState): RivalPrices {
  return state.tick < state.rival.releaseTick ? state.rival.before : state.rival.after;
}

export function createRivalDemand(seed: string, board: RivalBoard): RivalState {
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 2,
    capacity: CAPACITY,
    rival: {
      feature: 'match',
      releaseTick: 1,
      segment: 'pioneer',
      respondents: rosterHeadcount('pioneer'),
      before: { ...BEFORE },
      after: { ...AFTER[board] },
    },
    parts: [
      { id: 'match', need: NEED, done: 0 },
      { id: 'own', need: NEED, done: 0 },
    ],
    value: 0,
    periods: [],
    inputs: [],
  };
}

/** 予告済みの価格表は入力で書き換わらない。完成済みの機能へは価値を足さない。 */
export function applyRivalDemand(state: RivalState, input: RivalInput): RivalState {
  if (input.type === 'view') return state;
  if (input.type !== 'work' || !isFeature(input.feature) || state.tick >= state.horizon)
    return state;
  const current = state.parts.find((item) => item.id === input.feature);
  if (!current || current.done >= current.need) return state;
  const next = structuredClone(state);
  const target = next.parts.find((item) => item.id === input.feature);
  if (!target) return state;
  const applied = applyFeatureWork(target.done, target.need, next.capacity);
  target.done = applied.done;
  const price = prices(next)[target.id];
  if (applied.completed) next.value += price;
  next.periods.push({
    tick: next.tick,
    feature: target.id,
    completed: applied.completed,
    price,
    value: next.value,
  });
  next.tick += 1;
  next.inputs.push({ type: 'work', feature: input.feature });
  return next;
}

export function viewRivalDemand(state: RivalState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    capacity: state.capacity,
    value: state.value,
    announcement: {
      feature: state.rival.feature,
      releaseTick: state.rival.releaseTick,
      segment: state.rival.segment,
      respondents: state.rival.respondents,
    },
    changeTick: state.rival.releaseTick,
    before: { ...state.rival.before },
    after: { ...state.rival.after },
    now: { ...prices(state) },
    features: state.parts.map((item) => ({
      id: item.id,
      remaining: item.need - item.done,
      complete: item.done >= item.need,
    })),
  };
}

export function summarizeRivalDemand(state: RivalState) {
  return {
    value: state.value,
    completed: state.parts.filter((item) => item.done >= item.need).map((item) => item.id),
    path: state.periods.map((period) => period.value),
    after: { ...state.rival.after },
    score: state.value,
    lost: false,
  };
}

export function chooseRivalAction(state: RivalState, strategy: RivalStrategy): RivalInput {
  const order: RivalFeature[] = strategy === 'follow' ? ['match', 'own'] : ['own', 'match'];
  const feature = order.find((id) => {
    const item = state.parts.find((part) => part.id === id);
    return item !== undefined && item.done < item.need;
  });
  if (!feature || state.tick >= state.horizon) return { type: 'view' };
  return { type: 'work', feature };
}

function runRival(seed: string, board: RivalBoard, strategy: RivalStrategy) {
  const initial = createRivalDemand(seed, board);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 8) throw new Error(`${board}:${strategy}`);
    const input = chooseRivalAction(state, strategy);
    const next = applyRivalDemand(state, input);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { initial, inputs: state.inputs, result: summarizeRivalDemand(state) };
}

export function compareRivalDemand(seed = 'RI-239') {
  return (['preempt', 'proof'] as const).flatMap((board) =>
    (['follow', 'differentiate'] as const).map((strategy) => ({
      board,
      strategy,
      ...runRival(seed, board, strategy),
    })),
  );
}

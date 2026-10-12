/** RI-238: 核が完成するまで報酬は出ない。先行納品の価値は最終納品で足さない。 */

import { applyFeatureWork } from './productGrowth';

export type DeliveryMode = 'lump' | 'staged';
export type DeliveryBoard = 'tight' | 'short';
export type DeliveryPartId = 'core' | 'extra';
export type DeliveryInput =
  | { type: 'choose'; mode: DeliveryMode }
  | { type: 'work' }
  | { type: 'deliver' }
  | { type: 'view' };

export interface DeliveryPart {
  id: DeliveryPartId;
  need: number;
  done: number;
  value: number;
  delivered: boolean;
}

export interface DeliveryPeriod {
  tick: number;
  part: DeliveryPartId;
  accepted: number;
  done: number;
}

export interface DeliveryState {
  version: 1;
  seed: string;
  board: DeliveryBoard;
  tick: number;
  horizon: number;
  capacity: number;
  reviewCost: number;
  mode: DeliveryMode | null;
  parts: DeliveryPart[];
  value: number;
  reviews: number;
  periods: DeliveryPeriod[];
  inputs: DeliveryInput[];
}

const CAPACITY = 4;
const REVIEW = 3;
const HORIZON: Record<DeliveryBoard, number> = { tight: 2, short: 1 };

function isMode(value: string): value is DeliveryMode {
  return value === 'lump' || value === 'staged';
}

function part(state: DeliveryState, id: DeliveryPartId): DeliveryPart {
  const found = state.parts.find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found;
}

function ready(item: DeliveryPart): boolean {
  return item.done >= item.need;
}

function nextPart(state: DeliveryState): DeliveryPart | undefined {
  return state.parts.find((item) => item.done < item.need);
}

/** 未完成の核は納品できない。一括は両方、段階は完成した部品を一度だけ。 */
function deliver(state: DeliveryState): DeliveryState {
  if (state.mode === null) return state;
  const core = part(state, 'core');
  const extra = part(state, 'extra');
  if (state.mode === 'lump') {
    if (!ready(core) || !ready(extra) || core.delivered || extra.delivered) return state;
    const next = structuredClone(state);
    part(next, 'core').delivered = true;
    part(next, 'extra').delivered = true;
    next.reviews += 1;
    next.value += core.value + extra.value - next.reviewCost;
    next.inputs.push({ type: 'deliver' });
    return next;
  }
  const target =
    !core.delivered && ready(core) ? core : !extra.delivered && ready(extra) ? extra : null;
  if (!target) return state;
  const next = structuredClone(state);
  part(next, target.id).delivered = true;
  next.reviews += 1;
  next.value += target.value - next.reviewCost;
  next.inputs.push({ type: 'deliver' });
  return next;
}

export function createStagedDelivery(seed: string, board: DeliveryBoard): DeliveryState {
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: HORIZON[board],
    capacity: CAPACITY,
    reviewCost: REVIEW,
    mode: null,
    parts: [
      { id: 'core', need: 4, done: 0, value: 12, delivered: false },
      { id: 'extra', need: 4, done: 0, value: 8, delivered: false },
    ],
    value: 0,
    reviews: 0,
    periods: [],
    inputs: [],
  };
}

/** 作業は期限内だけ進む。納品は完成条件を満たした部品へ一度だけ報酬を出す。 */
export function applyStagedDelivery(state: DeliveryState, input: DeliveryInput): DeliveryState {
  if (input.type === 'view') return state;
  if (input.type === 'choose') {
    if (state.mode !== null || !isMode(input.mode)) return state;
    const next = structuredClone(state);
    next.mode = input.mode;
    next.inputs.push({ type: 'choose', mode: input.mode });
    return next;
  }
  if (input.type === 'deliver') return deliver(state);
  if (input.type !== 'work' || state.mode === null || state.tick >= state.horizon) return state;
  const current = nextPart(state);
  if (!current) return state;
  const next = structuredClone(state);
  const target = part(next, current.id);
  const applied = applyFeatureWork(target.done, target.need, next.capacity);
  target.done = applied.done;
  next.periods.push({
    tick: next.tick,
    part: target.id,
    accepted: applied.accepted,
    done: target.done,
  });
  next.tick += 1;
  next.inputs.push({ type: 'work' });
  return next;
}

export function viewStagedDelivery(state: DeliveryState) {
  const core = part(state, 'core');
  const extra = part(state, 'extra');
  return {
    tick: state.tick,
    horizon: state.horizon,
    capacity: state.capacity,
    mode: state.mode,
    reviewCost: state.reviewCost,
    earliestCoreTick: 1,
    core: {
      remaining: core.need - core.done,
      complete: ready(core),
      delivered: core.delivered,
      value: core.value,
    },
    extra: {
      remaining: extra.need - extra.done,
      complete: ready(extra),
      delivered: extra.delivered,
      value: extra.value,
    },
    value: state.value,
    reviews: state.reviews,
  };
}

export function summarizeStagedDelivery(state: DeliveryState) {
  const extra = part(state, 'extra');
  const core = part(state, 'core');
  return {
    value: state.value,
    reviews: state.reviews,
    reviewSpend: state.reviews * state.reviewCost,
    carry: extra.need - extra.done,
    coreDelivered: core.delivered,
    extraDelivered: extra.delivered,
    score: state.value,
    lost: false,
  };
}

export function chooseDeliveryAction(state: DeliveryState, mode: DeliveryMode): DeliveryInput {
  if (state.mode === null) return { type: 'choose', mode };
  const core = part(state, 'core');
  const extra = part(state, 'extra');
  if (!ready(core) && state.tick < state.horizon) return { type: 'work' };
  if (state.mode === 'staged' && ready(core) && !core.delivered) return { type: 'deliver' };
  if (!ready(extra) && state.tick < state.horizon) return { type: 'work' };
  if (state.mode === 'staged' && ready(extra) && !extra.delivered) return { type: 'deliver' };
  if (state.mode === 'lump' && ready(core) && ready(extra) && !core.delivered)
    return { type: 'deliver' };
  return { type: 'view' };
}

function runDelivery(seed: string, board: DeliveryBoard, mode: DeliveryMode) {
  const initial = createStagedDelivery(seed, board);
  let state = initial;
  let guard = 0;
  while (guard < 12) {
    guard += 1;
    const input = chooseDeliveryAction(state, mode);
    const next = applyStagedDelivery(state, input);
    if (next === state) break;
    state = next;
  }
  if (guard >= 12) throw new Error(`${board}:${mode}`);
  return { initial, inputs: state.inputs, result: summarizeStagedDelivery(state) };
}

export function compareStagedDeliveries(seed = 'RI-238') {
  return (['tight', 'short'] as const).flatMap((board) =>
    (['lump', 'staged'] as const).map((mode) => ({
      board,
      mode,
      ...runDelivery(seed, board, mode),
    })),
  );
}

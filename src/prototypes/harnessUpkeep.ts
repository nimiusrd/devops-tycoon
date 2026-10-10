/** RI-198: 内製ハーネスの保守期限は最初から見え、導入直後には失効しない。 */
import { createRng, getRngState } from '../sim/rng';

export type HarnessKind = 'external' | 'inhouse';
export type HarnessStrategy = 'external' | 'skip' | 'on-time' | 'early';
export type HarnessInput =
  | { type: 'choose'; kind: HarnessKind }
  | { type: 'update' }
  | { type: 'tick' };
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
export function createHarnessPrototype(seed: number, horizon: number): HarnessState {
  const rng = createRng(seed);
  rng();
  return {
    version: 1,
    seed,
    tick: 0,
    horizon,
    kind: null,
    generation: getRngState(rng),
    dueIn: GRACE,
    updating: 0,
    freshTicks: 0,
    staleTicks: 0,
    upkeepTicks: 0,
    value: 0,
    fees: 0,
    inputs: [],
  };
}
export function viewHarness(state: HarnessState) {
  const effect =
    state.kind === null
      ? null
      : state.updating > 0
        ? 0
        : state.kind === 'external' || state.dueIn > 0
          ? FRESH
          : STALE;
  return {
    tick: state.tick,
    horizon: state.horizon,
    kind: state.kind,
    generation: state.generation,
    grace: GRACE,
    updateTicks: UPDATE,
    freshValue: FRESH,
    staleValue: STALE,
    externalFee: FEE,
    dueIn: state.kind === 'inhouse' ? state.dueIn : null,
    updating: state.updating,
    effect,
  };
}
export function applyHarnessInput(state: HarnessState, input: HarnessInput): HarnessState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'choose' && state.kind !== null) return state;
  if (input.type === 'update' && (state.kind !== 'inhouse' || state.updating > 0)) return state;
  if (input.type === 'tick' && state.kind === null) return state;
  if (input.type !== 'tick' && state.updating > 0) return state;
  const next = structuredClone(state);
  if (input.type === 'choose') next.kind = input.kind;
  else if (input.type === 'update') next.updating = UPDATE;
  else if (next.updating > 0) {
    next.updating -= 1;
    next.upkeepTicks += 1;
    next.tick += 1;
    if (next.updating === 0) next.dueIn = GRACE;
  } else if (next.kind === 'external') {
    next.value += FRESH;
    next.fees += FEE;
    next.freshTicks += 1;
    next.tick += 1;
  } else if (next.dueIn === 0) {
    next.value += STALE;
    next.staleTicks += 1;
    next.tick += 1;
  } else {
    next.value += FRESH;
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
export function chooseHarnessAction(state: HarnessState, strategy: HarnessStrategy): HarnessInput {
  if (state.kind === null) {
    return { type: 'choose', kind: strategy === 'external' ? 'external' : 'inhouse' };
  }
  if (state.updating > 0) return { type: 'tick' };
  if (
    strategy === 'early' &&
    state.kind === 'inhouse' &&
    state.dueIn === GRACE &&
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

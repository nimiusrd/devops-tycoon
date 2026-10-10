/** RI-196: 兆候は確認対象であり、実リスクは確認完了まで公開しない。 */
import { createRng, getRngState } from '../sim/rng';

export type Signal = 'clear' | 'uncertain';
export type Verifier = 'thin' | 'thick';
export type UncertaintyPolicy = 'ship' | 'flagged' | 'all';
export type UncertaintyInput =
  { type: 'check'; id: string } | { type: 'ship'; id: string } | { type: 'tick' };
export interface UncertaintyTask {
  id: string;
  signal: Signal;
  actualRisk: number;
  value: number;
  checkTicksSpent: number;
  riskReduced: number | null;
  shipped: boolean;
  checkLeft: number;
  shipLeft: number;
}
export interface UncertaintyState {
  version: 1;
  seed: number;
  tick: number;
  horizon: number;
  verifier: Verifier;
  generation: number;
  tasks: UncertaintyTask[];
  inputs: UncertaintyInput[];
}
const CHECK_TICKS: Record<Verifier, number> = { thin: 3, thick: 1 };
const PENALTY = 3;
export function createUncertaintyPrototype(
  seed: number,
  horizon: number,
  verifier: Verifier,
): UncertaintyState {
  const rng = createRng(seed);
  rng();
  return {
    version: 1,
    seed,
    tick: 0,
    horizon,
    verifier,
    generation: getRngState(rng),
    tasks: (
      [
        { id: 'alarm', signal: 'uncertain', actualRisk: 0, value: 10 },
        { id: 'flagged', signal: 'uncertain', actualRisk: 6, value: 10 },
        { id: 'miss', signal: 'clear', actualRisk: 4, value: 10 },
      ] as const
    ).map((task) => ({
      ...task,
      checkTicksSpent: 0,
      riskReduced: null,
      shipped: false,
      checkLeft: 0,
      shipLeft: 0,
    })),
    inputs: [],
  };
}
function busy(task: UncertaintyTask) {
  return task.checkLeft > 0 || task.shipLeft > 0;
}
export function viewUncertainty(state: UncertaintyState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    verifier: state.verifier,
    generation: state.generation,
    checkTicks: CHECK_TICKS[state.verifier],
    tasks: state.tasks.map((task) => ({
      id: task.id,
      signal: task.signal,
      value: task.value,
      shipped: task.shipped,
      checkTicksSpent: task.checkTicksSpent,
      riskReduced: task.riskReduced,
    })),
  };
}
export function applyUncertaintyInput(
  state: UncertaintyState,
  input: UncertaintyInput,
): UncertaintyState {
  if (state.tick >= state.horizon) return state;
  const active = state.tasks.find(busy);
  if (input.type === 'tick' && !active && state.tasks.every((task) => task.shipped)) {
    const next = structuredClone(state);
    next.tick += 1;
    next.inputs.push({ type: 'tick' });
    return next;
  }
  if (input.type !== 'tick' && active) return state;
  if (input.type === 'tick' && !active) return state;
  const target = input.type === 'tick' ? active : state.tasks.find((task) => task.id === input.id);
  if (!target) return state;
  if (
    input.type === 'check' &&
    (target.shipped || target.checkTicksSpent > 0 || target.riskReduced !== null)
  ) {
    return state;
  }
  if (input.type === 'ship' && target.shipped) return state;
  const next = structuredClone(state);
  const task = next.tasks.find((item) => item.id === target.id)!;
  if (input.type === 'check') task.checkLeft = CHECK_TICKS[next.verifier];
  else if (input.type === 'ship') task.shipLeft = 1;
  else {
    next.tick += 1;
    if (task.checkLeft > 0) {
      task.checkLeft -= 1;
      task.checkTicksSpent += 1;
      if (task.checkLeft === 0) task.riskReduced = task.actualRisk;
    } else {
      task.shipLeft -= 1;
      if (task.shipLeft === 0) task.shipped = true;
    }
  }
  next.inputs.push(structuredClone(input));
  return next;
}
export function summarizeUncertainty(state: UncertaintyState) {
  const tasks = state.tasks.map((task) => ({
    id: task.id,
    signal: task.signal,
    shipped: task.shipped,
    checkTicksSpent: task.checkTicksSpent,
    riskReduced: task.riskReduced,
    realizedRisk: task.shipped && task.riskReduced === null ? task.actualRisk : 0,
    falseAlarm: task.signal === 'uncertain' && task.riskReduced === 0,
    missedSignal: task.signal === 'clear' && task.actualRisk > 0,
  }));
  const shippedValue = state.tasks.reduce((sum, task) => sum + (task.shipped ? task.value : 0), 0);
  const realizedRisk = tasks.reduce((sum, task) => sum + task.realizedRisk, 0);
  const unfinishedPenalty = state.tasks.filter((task) => !task.shipped).length * PENALTY;
  return {
    tasks,
    shippedValue,
    realizedRisk,
    checkTicks: state.tasks.reduce((sum, task) => sum + task.checkTicksSpent, 0),
    riskReduced: state.tasks.reduce((sum, task) => sum + (task.riskReduced ?? 0), 0),
    unfinishedPenalty,
    netValue: shippedValue - realizedRisk - unfinishedPenalty,
  };
}
export function chooseUncertaintyAction(
  state: UncertaintyState,
  policy: UncertaintyPolicy,
): UncertaintyInput {
  if (state.tasks.some(busy)) return { type: 'tick' };
  const pendingCheck = state.tasks.find(
    (task) =>
      !task.shipped &&
      task.riskReduced === null &&
      task.checkTicksSpent === 0 &&
      (policy === 'all' || (policy === 'flagged' && task.signal === 'uncertain')),
  );
  if (policy !== 'ship' && pendingCheck) return { type: 'check', id: pendingCheck.id };
  const pendingShip = state.tasks.find((task) => !task.shipped);
  if (pendingShip) return { type: 'ship', id: pendingShip.id };
  return { type: 'tick' };
}
export function compareUncertaintyPolicies(seed = 196) {
  return (['thin', 'thick'] as const).flatMap((verifier) =>
    ([5, 10] as const).flatMap((horizon) =>
      (['ship', 'flagged', 'all'] as const).map((policy) => {
        const initial = createUncertaintyPrototype(seed, horizon, verifier);
        let state = initial;
        let guard = 0;
        while (state.tick < horizon) {
          if (++guard > 80) throw new Error(`${verifier}:${horizon}:${policy}`);
          const next = applyUncertaintyInput(state, chooseUncertaintyAction(state, policy));
          if (next === state) throw new Error(`${verifier}:${horizon}:${policy}@${state.tick}`);
          state = next;
        }
        return {
          verifier,
          horizon,
          policy,
          initial,
          inputs: state.inputs,
          result: summarizeUncertainty(state),
        };
      }),
    ),
  );
}

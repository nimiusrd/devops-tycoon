/** RI-195: 探索は一度だけ払い、採用しない案の成果は出荷へ足さない。選択中は時間を止める。 */
import { createRng, getRngState } from '../sim/rng';

export type ProposalId = 'fast' | 'durable';
export type CompanyPosture = 'launch' | 'maintain';
export type SolutionStrategy = 'rush' | 'compare-fast' | 'compare-durable' | 'wait';
export type SolutionInput =
  { type: 'explore' } | { type: 'adopt'; proposal: ProposalId } | { type: 'tick' };
export interface SolutionState {
  version: 1;
  seed: number;
  tick: number;
  horizon: number;
  posture: CompanyPosture;
  focus: number;
  focusSpent: number;
  explored: boolean;
  phase: 'ready' | 'exploring' | 'choosing' | 'implementing' | 'shipped';
  workLeft: number;
  adopted: ProposalId | null;
  rejected: ProposalId | null;
  shippedValue: number;
  followUp: number;
  upkeep: number;
  safetyLoss: number;
  generation: number;
  inputs: SolutionInput[];
}
const SHIP = 8;
const FOLLOW = 4;
const FAST_WORK = 2;
const DURABLE_WORK = 5;
const EXPLORE_WORK = 2;
const SAFETY = 4;
const PENALTY = 12;
export function createSolutionPrototype(
  seed: number,
  horizon: number,
  posture: CompanyPosture,
): SolutionState {
  const rng = createRng(seed);
  rng();
  return {
    version: 1,
    seed,
    tick: 0,
    horizon,
    posture,
    focus: 2,
    focusSpent: 0,
    explored: false,
    phase: 'ready',
    workLeft: 0,
    adopted: null,
    rejected: null,
    shippedValue: 0,
    followUp: 0,
    upkeep: 0,
    safetyLoss: 0,
    generation: getRngState(rng),
    inputs: [],
  };
}
function upkeepRate(posture: CompanyPosture, id: ProposalId) {
  if (id === 'durable') return 0;
  return posture === 'launch' ? 1 : 3;
}
export function viewSolution(state: SolutionState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    posture: state.posture,
    phase: state.phase,
    generation: state.generation,
    exploreFocus: 1,
    exploreTicks: EXPLORE_WORK,
    timeStopped: state.phase === 'choosing',
    proposals: (['fast', 'durable'] as const).map((id) => {
      const known = (state.explored && state.phase !== 'exploring') || state.adopted === id;
      const firstDraft = id === 'fast';
      return {
        id,
        revealed: known,
        work: known || firstDraft ? (id === 'fast' ? FAST_WORK : DURABLE_WORK) : null,
        shipValue: known || firstDraft ? SHIP : null,
        upkeepPerTick: known ? upkeepRate(state.posture, id) : null,
        safetyLoss: known ? (id === 'fast' ? SAFETY : 0) : null,
      };
    }),
  };
}
export function applySolutionInput(state: SolutionState, input: SolutionInput): SolutionState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'tick' && state.phase === 'choosing') return state;
  if (input.type === 'explore' && (state.phase !== 'ready' || state.explored || state.focus < 1)) {
    return state;
  }
  if (
    input.type === 'adopt' &&
    (state.phase === 'exploring' ||
      state.phase === 'implementing' ||
      state.phase === 'shipped' ||
      (state.phase === 'ready' && input.proposal !== 'fast'))
  ) {
    return state;
  }
  const next = structuredClone(state);
  if (input.type === 'explore') {
    next.phase = 'exploring';
    next.workLeft = EXPLORE_WORK;
    next.focus -= 1;
    next.focusSpent += 1;
    next.explored = true;
  } else if (input.type === 'adopt') {
    next.adopted = input.proposal;
    next.rejected = input.proposal === 'fast' ? 'durable' : 'fast';
    next.phase = 'implementing';
    next.workLeft = input.proposal === 'fast' ? FAST_WORK : DURABLE_WORK;
  } else {
    next.tick += 1;
    if (next.phase === 'exploring' || next.phase === 'implementing') {
      next.workLeft -= 1;
      if (next.workLeft === 0 && next.phase === 'exploring') next.phase = 'choosing';
      if (next.workLeft === 0 && next.phase === 'implementing' && next.adopted !== null) {
        next.phase = 'shipped';
        next.shippedValue += SHIP;
        next.safetyLoss += next.adopted === 'fast' ? SAFETY : 0;
        next.upkeep += upkeepRate(next.posture, next.adopted) * next.horizon;
      }
    } else if (next.phase === 'shipped') {
      next.followUp += FOLLOW;
    }
  }
  next.inputs.push(structuredClone(input));
  return next;
}
export function summarizeSolution(state: SolutionState) {
  const withheldValue = state.rejected === null ? 0 : SHIP;
  const unfinishedPenalty = state.phase === 'shipped' ? 0 : PENALTY;
  return {
    phase: state.phase,
    adopted: state.adopted,
    rejected: state.rejected,
    explored: state.explored,
    shippedValue: state.shippedValue,
    followUp: state.followUp,
    upkeep: state.upkeep,
    safetyLoss: state.safetyLoss,
    focusSpent: state.focusSpent,
    withheldValue,
    unfinishedPenalty,
    netValue:
      state.shippedValue +
      state.followUp -
      state.upkeep -
      state.safetyLoss -
      state.focusSpent -
      unfinishedPenalty,
  };
}
export function chooseSolutionAction(
  state: SolutionState,
  strategy: SolutionStrategy,
): SolutionInput {
  if (state.phase === 'choosing') {
    return { type: 'adopt', proposal: strategy === 'compare-durable' ? 'durable' : 'fast' };
  }
  if (state.phase === 'ready' && strategy !== 'wait') {
    if (strategy === 'rush') return { type: 'adopt', proposal: 'fast' };
    return { type: 'explore' };
  }
  return { type: 'tick' };
}
export function compareSolutionStrategies(seed = 195) {
  return (['launch', 'maintain'] as const).flatMap((posture) =>
    ([6, 14] as const).flatMap((horizon) =>
      (['rush', 'compare-fast', 'compare-durable', 'wait'] as const).map((strategy) => {
        const initial = createSolutionPrototype(seed, horizon, posture);
        let state = initial;
        let guard = 0;
        while (state.tick < horizon) {
          if (++guard > 80) throw new Error(`${posture}:${horizon}:${strategy}`);
          const next = applySolutionInput(state, chooseSolutionAction(state, strategy));
          if (next === state) throw new Error(`${posture}:${horizon}:${strategy}@${state.tick}`);
          state = next;
        }
        return {
          posture,
          horizon,
          strategy,
          initial,
          inputs: state.inputs,
          result: summarizeSolution(state),
        };
      }),
    ),
  );
}

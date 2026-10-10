/** RI-197: 評価結果は仕事種類ごとに残し、一つの点数へは合算しない。 */
import { createRng, getRngState } from '../sim/rng';

export type ToolId = 'swift' | 'careful';
export type JobKind = 'routine' | 'migration' | 'incident';
export type ProductionMix = 'balanced' | 'routineHeavy';
export type EvalStrategy = 'swift' | 'careful' | 'perKind' | 'pooled';
export type EvalInput =
  | { type: 'benchmark'; tool: ToolId; kind: JobKind }
  | { type: 'adopt'; tool: ToolId }
  | { type: 'start' }
  | { type: 'tick' };
export interface Observation {
  tool: ToolId;
  kind: JobKind;
  ticks: number;
  rework: number;
}
export interface EvalState {
  version: 1;
  seed: number;
  tick: number;
  horizon: number;
  mix: ProductionMix;
  generation: number;
  adopted: ToolId | null;
  observations: Observation[];
  benchmark: { tool: ToolId; kind: JobKind } | null;
  jobLeft: number;
  queue: JobKind[];
  completed: number;
  shippedValue: number;
  rework: number;
  followUp: number;
  inputs: EvalInput[];
}
const PROFILE: Record<ToolId, Record<JobKind, { ticks: number; rework: number }>> = {
  swift: {
    routine: { ticks: 1, rework: 0 },
    migration: { ticks: 1, rework: 14 },
    incident: { ticks: 1, rework: 10 },
  },
  careful: {
    routine: { ticks: 3, rework: 0 },
    migration: { ticks: 3, rework: 1 },
    incident: { ticks: 3, rework: 1 },
  },
};
const KINDS: JobKind[] = ['routine', 'migration', 'incident'];
const CELLS: Array<{ tool: ToolId; kind: JobKind }> = [
  { tool: 'swift', kind: 'routine' },
  { tool: 'swift', kind: 'migration' },
  { tool: 'swift', kind: 'incident' },
  { tool: 'careful', kind: 'routine' },
  { tool: 'careful', kind: 'migration' },
  { tool: 'careful', kind: 'incident' },
];
const VALUE = 8;
const FOLLOW = 1;
const PENALTY = 12;
export function productionJobs(mix: ProductionMix): JobKind[] {
  return mix === 'balanced'
    ? ['migration', 'incident', 'routine']
    : ['routine', 'routine', 'routine', 'routine'];
}
export function createAdoptionEval(seed: number, horizon: number, mix: ProductionMix): EvalState {
  const rng = createRng(seed);
  rng();
  return {
    version: 1,
    seed,
    tick: 0,
    horizon,
    mix,
    generation: getRngState(rng),
    adopted: null,
    observations: [],
    benchmark: null,
    jobLeft: 0,
    queue: productionJobs(mix),
    completed: 0,
    shippedValue: 0,
    rework: 0,
    followUp: 0,
    inputs: [],
  };
}
function findObservation(state: EvalState, tool: ToolId, kind: JobKind) {
  return state.observations.find((item) => item.tool === tool && item.kind === kind) ?? null;
}
export function viewAdoptionEval(state: EvalState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    mix: state.mix,
    production: state.queue,
    generation: state.generation,
    adopted: state.adopted,
    observations: state.observations.map((item) => ({ ...item })),
    tools: (['swift', 'careful'] as const).map((tool) => ({
      tool,
      jobs: KINDS.map((kind) => {
        const seen = findObservation(state, tool, kind);
        return {
          kind,
          ticks: PROFILE[tool][kind].ticks,
          rework: seen ? seen.rework : null,
        };
      }),
    })),
  };
}
function project(state: EvalState, tool: ToolId, weight: 'perKind' | 'pooled') {
  const pooled =
    KINDS.reduce((sum, kind) => sum + (findObservation(state, tool, kind)?.rework ?? 0), 0) /
    KINDS.length;
  let time = state.horizon - state.tick;
  let net = 0;
  let unfinished = state.queue.length;
  for (const kind of state.queue) {
    const cell = PROFILE[tool][kind];
    if (cell.ticks > time) break;
    time -= cell.ticks;
    const rework = weight === 'pooled' ? pooled : (findObservation(state, tool, kind)?.rework ?? 0);
    net += VALUE - rework;
    unfinished -= 1;
  }
  return net + time * FOLLOW - unfinished * PENALTY;
}
export function chooseAdoptionTool(state: EvalState, weight: 'perKind' | 'pooled'): ToolId {
  const swift = project(state, 'swift', weight);
  const careful = project(state, 'careful', weight);
  return careful > swift ? 'careful' : 'swift';
}
export function applyAdoptionInput(state: EvalState, input: EvalInput): EvalState {
  if (state.tick >= state.horizon) return state;
  const busy = state.benchmark !== null || state.jobLeft > 0;
  if (input.type === 'tick' && !busy && !(state.adopted !== null && state.queue.length === 0)) {
    return state;
  }
  if (input.type !== 'tick' && busy) return state;
  if (input.type === 'benchmark') {
    if (state.adopted !== null || findObservation(state, input.tool, input.kind)) return state;
  }
  if (input.type === 'adopt' && state.adopted !== null) return state;
  if (input.type === 'start' && (state.adopted === null || state.queue.length === 0)) return state;
  const next = structuredClone(state);
  if (input.type === 'benchmark') {
    next.benchmark = { tool: input.tool, kind: input.kind };
  } else if (input.type === 'adopt') {
    next.adopted = input.tool;
  } else if (input.type === 'start' && next.adopted !== null) {
    next.jobLeft = PROFILE[next.adopted][next.queue[0]!].ticks;
  } else if (next.benchmark) {
    const cell = PROFILE[next.benchmark.tool][next.benchmark.kind];
    next.observations.push({
      tool: next.benchmark.tool,
      kind: next.benchmark.kind,
      ticks: cell.ticks,
      rework: cell.rework,
    });
    next.benchmark = null;
    next.tick += 1;
  } else if (next.jobLeft > 0 && next.adopted !== null) {
    next.jobLeft -= 1;
    next.tick += 1;
    if (next.jobLeft === 0) {
      const kind = next.queue.shift()!;
      next.completed += 1;
      next.shippedValue += VALUE;
      next.rework += PROFILE[next.adopted][kind].rework;
    }
  } else {
    next.followUp += FOLLOW;
    next.tick += 1;
  }
  next.inputs.push(structuredClone(input));
  return next;
}
export function summarizeAdoption(state: EvalState) {
  const unfinished = state.queue.length;
  return {
    adopted: state.adopted,
    observations: state.observations.length,
    completed: state.completed,
    shippedValue: state.shippedValue,
    rework: state.rework,
    followUp: state.followUp,
    unfinishedPenalty: unfinished * PENALTY,
    netValue: state.shippedValue - state.rework + state.followUp - unfinished * PENALTY,
  };
}
export function chooseAdoptionAction(state: EvalState, strategy: EvalStrategy): EvalInput {
  if (state.benchmark || state.jobLeft > 0) return { type: 'tick' };
  if (state.adopted === null) {
    if (strategy === 'swift' || strategy === 'careful') return { type: 'adopt', tool: strategy };
    const missing = CELLS.find((cell) => !findObservation(state, cell.tool, cell.kind));
    if (missing) return { type: 'benchmark', tool: missing.tool, kind: missing.kind };
    return { type: 'adopt', tool: chooseAdoptionTool(state, strategy) };
  }
  if (state.queue.length > 0) return { type: 'start' };
  return { type: 'tick' };
}
export function compareAdoptionStrategies(seed = 197) {
  return (['balanced', 'routineHeavy'] as const).flatMap((mix) =>
    ([8, 20] as const).flatMap((horizon) =>
      (['swift', 'careful', 'perKind', 'pooled'] as const).map((strategy) => {
        const initial = createAdoptionEval(seed, horizon, mix);
        let state = initial;
        let guard = 0;
        while (state.tick < horizon) {
          if (++guard > 80) throw new Error(`${mix}:${horizon}:${strategy}`);
          const next = applyAdoptionInput(state, chooseAdoptionAction(state, strategy));
          if (next === state) throw new Error(`${mix}:${horizon}:${strategy}@${state.tick}`);
          state = next;
        }
        return {
          mix,
          horizon,
          strategy,
          initial,
          inputs: state.inputs,
          result: summarizeAdoption(state),
        };
      }),
    ),
  );
}

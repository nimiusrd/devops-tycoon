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
  benchmark: { tool: ToolId; kind: JobKind; left: number } | null;
  jobLeft: number;
  queue: JobKind[];
  completed: number;
  shippedValue: number;
  rework: number;
  followUp: number;
  inputs: EvalInput[];
}
/** 初回比較の資源。手戻りは基準表に倍率を掛け、評価tickは代表仕事1件の消費。 */
export interface AdoptionRules {
  evalTicks: number;
  reworkScale: number;
  penalty: number;
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
export const baselineAdoptionRules: AdoptionRules = {
  evalTicks: 1,
  reworkScale: 1,
  penalty: PENALTY,
};
function scaledRework(tool: ToolId, kind: JobKind, rules: AdoptionRules) {
  return PROFILE[tool][kind].rework * rules.reworkScale;
}
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
    production: [...state.queue],
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
function project(
  state: EvalState,
  tool: ToolId,
  weight: 'perKind' | 'pooled',
  rules: AdoptionRules,
) {
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
  return net + time * FOLLOW - unfinished * rules.penalty;
}
export function chooseAdoptionTool(
  state: EvalState,
  weight: 'perKind' | 'pooled',
  rules: AdoptionRules = baselineAdoptionRules,
): ToolId {
  const swift = project(state, 'swift', weight, rules);
  const careful = project(state, 'careful', weight, rules);
  return careful > swift ? 'careful' : 'swift';
}
function recordObservation(state: EvalState, tool: ToolId, kind: JobKind, rules: AdoptionRules) {
  const cell = PROFILE[tool][kind];
  state.observations.push({
    tool,
    kind,
    ticks: cell.ticks,
    rework: scaledRework(tool, kind, rules),
  });
}
export function applyAdoptionInput(
  state: EvalState,
  input: EvalInput,
  rules: AdoptionRules = baselineAdoptionRules,
): EvalState {
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
    if (rules.evalTicks <= 0) recordObservation(next, input.tool, input.kind, rules);
    else next.benchmark = { tool: input.tool, kind: input.kind, left: rules.evalTicks };
  } else if (input.type === 'adopt') {
    next.adopted = input.tool;
  } else if (input.type === 'start' && next.adopted !== null) {
    next.jobLeft = PROFILE[next.adopted][next.queue[0]!].ticks;
  } else if (next.benchmark) {
    const remain = next.benchmark.left - 1;
    next.tick += 1;
    if (remain > 0) next.benchmark = { ...next.benchmark, left: remain };
    else {
      recordObservation(next, next.benchmark.tool, next.benchmark.kind, rules);
      next.benchmark = null;
    }
  } else if (next.jobLeft > 0 && next.adopted !== null) {
    next.jobLeft -= 1;
    next.tick += 1;
    if (next.jobLeft === 0) {
      const kind = next.queue.shift()!;
      next.completed += 1;
      next.shippedValue += VALUE;
      next.rework += scaledRework(next.adopted, kind, rules);
    }
  } else {
    next.followUp += FOLLOW;
    next.tick += 1;
  }
  next.inputs.push(structuredClone(input));
  return next;
}
export function summarizeAdoption(state: EvalState, rules: AdoptionRules = baselineAdoptionRules) {
  const unfinished = state.queue.length;
  const unfinishedPenalty = unfinished * rules.penalty;
  return {
    adopted: state.adopted,
    observations: state.observations.length,
    completed: state.completed,
    shippedValue: state.shippedValue,
    rework: state.rework,
    followUp: state.followUp,
    unfinishedPenalty,
    netValue: state.shippedValue - state.rework + state.followUp - unfinishedPenalty,
  };
}
export function chooseAdoptionAction(
  state: EvalState,
  strategy: EvalStrategy,
  rules: AdoptionRules = baselineAdoptionRules,
): EvalInput {
  if (state.benchmark || state.jobLeft > 0) return { type: 'tick' };
  if (state.adopted === null) {
    if (strategy === 'swift' || strategy === 'careful') return { type: 'adopt', tool: strategy };
    const missing = CELLS.find((cell) => !findObservation(state, cell.tool, cell.kind));
    if (missing) return { type: 'benchmark', tool: missing.tool, kind: missing.kind };
    return { type: 'adopt', tool: chooseAdoptionTool(state, strategy, rules) };
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
const FACTOR_SEED = 197;
const FACTOR_HORIZONS = [8, 20] as const;
const FACTOR_MIXES = ['balanced', 'routineHeavy'] as const;
const SKIP_TOOLS = ['swift', 'careful'] as const;
export type AdoptionPreference = 'evaluate' | 'skip' | 'tie';
export interface AdoptionFactorRun {
  inputs: EvalInput[];
  result: ReturnType<typeof summarizeAdoption>;
}
export interface AdoptionSkipComparison {
  opponent: (typeof SKIP_TOOLS)[number];
  preference: AdoptionPreference;
  margin: number;
  skip: AdoptionFactorRun;
}
export interface AdoptionFactorBoard {
  mix: ProductionMix;
  horizon: number;
  evaluate: AdoptionFactorRun;
  skips: AdoptionSkipComparison[];
}
export interface AdoptionFactorPoint {
  axis: string;
  parameter: string;
  rules: AdoptionRules;
  boards: AdoptionFactorBoard[];
}
export interface AdoptionFactorReversal {
  axis: string;
  mix: ProductionMix;
  horizon: number;
  opponent: (typeof SKIP_TOOLS)[number];
  before: { parameter: string; preference: AdoptionPreference; evaluate: number; skip: number };
  after: { parameter: string; preference: AdoptionPreference; evaluate: number; skip: number };
}
function cloneRules(rules: AdoptionRules): AdoptionRules {
  return { ...rules };
}
function withRules(patch: Partial<AdoptionRules>): AdoptionRules {
  return { ...baselineAdoptionRules, ...patch };
}
function preferenceOf(evaluate: number, skip: number): AdoptionPreference {
  if (evaluate > skip) return 'evaluate';
  if (skip > evaluate) return 'skip';
  return 'tie';
}
function runAdoption(
  mix: ProductionMix,
  horizon: number,
  strategy: EvalStrategy,
  rules: AdoptionRules,
): AdoptionFactorRun {
  let state = createAdoptionEval(FACTOR_SEED, horizon, mix);
  let guard = 0;
  while (state.tick < horizon) {
    if (++guard > 160) throw new Error(`${mix}:${horizon}:${strategy}`);
    const next = applyAdoptionInput(state, chooseAdoptionAction(state, strategy, rules), rules);
    if (next === state) throw new Error(`${mix}:${horizon}:${strategy}@${state.tick}`);
    state = next;
  }
  return { inputs: state.inputs, result: summarizeAdoption(state, rules) };
}
function factorPoint(axis: string, parameter: string, rules: AdoptionRules): AdoptionFactorPoint {
  const boards = FACTOR_MIXES.flatMap((mix) =>
    FACTOR_HORIZONS.map((horizon) => {
      const evaluate = runAdoption(mix, horizon, 'perKind', rules);
      const skips = SKIP_TOOLS.map((opponent) => {
        const skip = runAdoption(mix, horizon, opponent, rules);
        const evaluateNet = evaluate.result.netValue;
        const skipNet = skip.result.netValue;
        return {
          opponent,
          preference: preferenceOf(evaluateNet, skipNet),
          margin: evaluateNet - skipNet,
          skip,
        };
      });
      return { mix, horizon, evaluate, skips };
    }),
  );
  return { axis, parameter, rules: cloneRules(rules), boards };
}
function reversalsOf(rows: AdoptionFactorPoint[]): AdoptionFactorReversal[] {
  const found: AdoptionFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after) continue;
    for (const mix of FACTOR_MIXES) {
      for (const horizon of FACTOR_HORIZONS) {
        const earlier = before.boards.find((item) => item.mix === mix && item.horizon === horizon);
        const later = after.boards.find((item) => item.mix === mix && item.horizon === horizon);
        if (!earlier || !later) continue;
        for (const opponent of SKIP_TOOLS) {
          const earlySkip = earlier.skips.find((item) => item.opponent === opponent);
          const lateSkip = later.skips.find((item) => item.opponent === opponent);
          if (!earlySkip || !lateSkip || earlySkip.preference === lateSkip.preference) continue;
          found.push({
            axis: before.axis,
            mix,
            horizon,
            opponent,
            before: {
              parameter: before.parameter,
              preference: earlySkip.preference,
              evaluate: earlier.evaluate.result.netValue,
              skip: earlySkip.skip.result.netValue,
            },
            after: {
              parameter: after.parameter,
              preference: lateSkip.preference,
              evaluate: later.evaluate.result.netValue,
              skip: lateSkip.skip.result.netValue,
            },
          });
        }
      }
    }
  }
  return found;
}
/** 初回と同じ資源で、評価tick・手戻り倍率・未完了ペナルティを一つずつ動かす。固定戦略。 */
export function compareAdoptionFactorReversals() {
  const sweeps = {
    evalTicks: [0, 1, 2, 3].map((evalTicks) =>
      factorPoint('evalTicks', String(evalTicks), withRules({ evalTicks })),
    ),
    reworkScale: [0, 0.5, 1, 2].map((reworkScale) =>
      factorPoint('reworkScale', String(reworkScale), withRules({ reworkScale })),
    ),
    penalty: [0, 6, 12, 24].map((penalty) =>
      factorPoint('penalty', String(penalty), withRules({ penalty })),
    ),
  };
  return {
    conditions: {
      seed: FACTOR_SEED,
      horizons: [...FACTOR_HORIZONS],
      mixes: [...FACTOR_MIXES],
      decision: {
        evaluate: 'perKind',
        skip: [...SKIP_TOOLS],
        score: 'netValue',
        preference: '評価の差引が大きいとき評価、見切りが大きいとき見切り、同じとき同点',
      },
      baseline: cloneRules(baselineAdoptionRules),
      held: {
        evalTicks:
          '代表仕事1件の消費tickだけを動かす。手戻りは基準、未完了は12。出荷8、追随1、本番はswiftが1tick、carefulが3tick',
        reworkScale: '基準の手戻りへ掛ける倍率だけを動かす。評価tickは1、未完了は12',
        penalty: '未完了1件のペナルティだけを動かす。評価tickは1、手戻りは基準',
      },
      value: VALUE,
      follow: FOLLOW,
      cells: CELLS.length,
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    },
    sweeps,
    reversals: Object.values(sweeps).flatMap((rows) => reversalsOf(rows)),
  };
}

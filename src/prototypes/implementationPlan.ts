/** RI-190: 実装前の計画tick。通常ランの工程とカードには接続しない。 */
import {
  applyModelInput,
  createModelBoard,
  summarizeModel,
  type ModelInput,
  type ModelState,
} from './modelAssignment';

export const PLAN_TICKS = 2;
export const WANDER_WORK = 3;
export const WANDER_PENALTY = 6;
export const COMPLEX_FINDING = 'dependency:ledger-order';
export type PlanScenario = 'simpleShort' | 'complexTight' | 'complexLong';
export type PlanStrategy = 'rush' | 'plan';
export type PlanInput = ModelInput | { type: 'plan' };
export interface PlanState {
  version: 1;
  scenario: PlanScenario;
  board: ModelState;
  planned: string[];
  planningId: string | null;
  planningTicks: number;
  findings: string[];
  wandered: string[];
  inputs: PlanInput[];
}

const SCENARIOS: Record<
  PlanScenario,
  { horizon: number; kinds: ModelState['jobs'][number]['kind'][] }
> = {
  simpleShort: { horizon: 6, kinds: ['simple'] },
  complexTight: { horizon: 8, kinds: ['complex'] },
  complexLong: { horizon: 12, kinds: ['complex'] },
};

export function createPlanPrototype(seed: string, scenario: PlanScenario): PlanState {
  const preset = SCENARIOS[scenario];
  return {
    version: 1,
    scenario,
    board: createModelBoard(seed, 0, preset.horizon, preset.kinds),
    planned: [],
    planningId: null,
    planningTicks: 0,
    findings: [],
    wandered: [],
    inputs: [],
  };
}

export function viewPlan(state: PlanState) {
  return {
    tick: state.board.tick,
    horizon: state.board.horizon,
    planningId: state.planningId,
    planningTicks: state.planningTicks,
    planned: [...state.planned],
    findings: [...state.findings],
    wandered: [...state.wandered],
    jobs: state.board.jobs.map((job) => ({
      id: job.id,
      kind: job.kind,
      progress: job.progress,
      work: job.work,
      shipped: job.shipped,
    })),
  };
}

function openJob(state: PlanState) {
  return state.board.jobs.find((job) => job.shipped === null);
}

export function applyPlanInput(state: PlanState, input: PlanInput): PlanState {
  if (state.board.tick >= state.board.horizon) return state;
  if (state.planningId !== null && input.type === 'tick') return state;
  if (input.type === 'plan') return planTick(state);
  if (input.type === 'assign') {
    const board = applyModelInput(state.board, input);
    if (board === state.board) return state;
    return { ...state, board, inputs: [...state.inputs, structuredClone(input)] };
  }
  return codeTick(state);
}

function planTick(state: PlanState): PlanState {
  const job = openJob(state);
  if (!job || job.progress > 0 || state.planned.includes(job.id)) return state;
  if (state.planningId && state.planningId !== job.id) return state;
  const next = structuredClone(state);
  next.board.tick += 1;
  next.planningId = job.id;
  next.planningTicks += 1;
  const notes = [`t${next.board.tick}:plan:${job.id}`];
  if (next.planningTicks >= PLAN_TICKS) {
    next.planned.push(job.id);
    const finding =
      job.kind === 'complex' ? `${job.id}:${COMPLEX_FINDING}` : `${job.id}:no-hidden-scope`;
    next.findings.push(finding);
    notes.push(finding);
    next.planningId = null;
    next.planningTicks = 0;
  }
  next.board.resolutions.push(notes.join(','));
  next.inputs.push({ type: 'plan' });
  return next;
}

function codeTick(state: PlanState): PlanState {
  const job = openJob(state);
  const next = structuredClone(state);
  if (
    job &&
    job.progress === 0 &&
    job.kind === 'complex' &&
    !next.planned.includes(job.id) &&
    !next.wandered.includes(job.id)
  ) {
    const target = next.board.jobs.find((item) => item.id === job.id)!;
    target.work += WANDER_WORK;
    next.wandered.push(job.id);
    next.board.resolutions.push(`wander:${job.id}+${WANDER_WORK}`);
  }
  const before = new Map(next.board.jobs.map((item) => [item.id, item.shipped]));
  next.board = applyModelInput(next.board, { type: 'tick' });
  for (const item of next.board.jobs) {
    if (before.get(item.id) === null && item.shipped !== null && next.wandered.includes(item.id)) {
      item.shipped -= WANDER_PENALTY;
      next.board.shippedValue -= WANDER_PENALTY;
      next.board.resolutions.push(`wander-penalty:${item.id}-${WANDER_PENALTY}`);
    }
  }
  next.inputs.push({ type: 'tick' });
  return next;
}

export function summarizePlan(state: PlanState) {
  const board = summarizeModel(state.board);
  return {
    tick: board.tick,
    shippedValue: board.shippedValue,
    spent: board.spent,
    planned: state.planned,
    findings: state.findings,
    wandered: state.wandered,
    resolutions: state.board.resolutions,
    netValue: board.netValue,
  };
}

export function choosePlanAction(state: PlanState, strategy: PlanStrategy): PlanInput {
  const job = openJob(state);
  if (
    strategy === 'plan' &&
    job &&
    job.progress === 0 &&
    !state.planned.includes(job.id) &&
    (state.planningId === null || state.planningId === job.id)
  ) {
    return { type: 'plan' };
  }
  return { type: 'tick' };
}

const COMPARE_ROWS: { scenario: PlanScenario; strategies: PlanStrategy[] }[] = [
  { scenario: 'simpleShort', strategies: ['rush', 'plan'] },
  { scenario: 'complexTight', strategies: ['rush', 'plan'] },
  { scenario: 'complexLong', strategies: ['rush', 'plan'] },
];

export function comparePlanStrategies(seed: string) {
  return COMPARE_ROWS.flatMap(({ scenario, strategies }) =>
    strategies.map((strategy) => {
      const initial = createPlanPrototype(seed, scenario);
      let state = initial;
      let guard = 0;
      while (state.board.tick < state.board.horizon) {
        if (++guard > 40) throw new Error(`${scenario}:${strategy}`);
        const action = choosePlanAction(state, strategy);
        const next = applyPlanInput(state, action);
        if (next === state) throw new Error(`${scenario}:${strategy} tick ${state.board.tick}`);
        state = next;
      }
      return {
        scenario,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizePlan(state),
      };
    }),
  );
}

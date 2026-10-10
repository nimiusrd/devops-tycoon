/** RI-189: 架空の2モデルを仕事へ割り当てる。通常ランのAI配布booleanとは接続しない。 */
export type ModelId = 'fast' | 'precise';
export type JobKind = 'simple' | 'complex';
export type ModelScenario = 'volume' | 'hard' | 'mixed' | 'broke';
export type ModelStrategy = 'none' | 'fast' | 'precise' | 'match';
export type AssignedModel = ModelId | 'none';
export interface ModelJob {
  id: string;
  kind: JobKind;
  work: number;
  progress: number;
  value: number;
  model: AssignedModel | null;
  shipped: number | null;
  defect: boolean;
}
export type ModelInput = { type: 'assign'; model: string } | { type: 'tick' };
export interface ModelState {
  version: 1;
  seed: string;
  scenario: ModelScenario | 'custom';
  tick: number;
  horizon: number;
  budget: number;
  spent: number;
  pendingModel: AssignedModel | null;
  reviewLoad: number;
  shippedValue: number;
  jobs: ModelJob[];
  resolutions: string[];
  inputs: ModelInput[];
}
export const MODEL_STATS = {
  fast: { speed: 3, cost: 1 },
  precise: { speed: 2, cost: 2 },
} as const;
export const HUMAN_SPEED = 1;
export const JOB_WORK = 6;
export const JOB_VALUE = { simple: 10, complex: 18 } as const;
export const COMPLEX_FAST_PENALTY = 12;
export const PRECISE_SIMPLE_REVIEW = 3;

const SCENARIOS: Record<ModelScenario, { budget: number; horizon: number; jobs: JobKind[] }> = {
  volume: { budget: 8, horizon: 8, jobs: ['simple', 'simple', 'simple', 'simple'] },
  hard: { budget: 16, horizon: 8, jobs: ['complex', 'complex', 'complex'] },
  mixed: { budget: 10, horizon: 8, jobs: ['simple', 'complex', 'simple'] },
  broke: { budget: 1, horizon: 8, jobs: ['complex', 'simple'] },
};

export function createModelBoard(
  seed: string,
  budget: number,
  horizon: number,
  kinds: readonly JobKind[],
  ids?: readonly string[],
  scenario: ModelState['scenario'] = 'custom',
): ModelState {
  return {
    version: 1,
    seed,
    scenario,
    tick: 0,
    horizon,
    budget,
    spent: 0,
    pendingModel: null,
    reviewLoad: 0,
    shippedValue: 0,
    jobs: kinds.map((kind, index) => ({
      id: ids?.[index] ?? `${kind === 'simple' ? 's' : 'c'}${index + 1}`,
      kind,
      work: JOB_WORK,
      progress: 0,
      value: JOB_VALUE[kind],
      model: null,
      shipped: null,
      defect: false,
    })),
    resolutions: [],
    inputs: [],
  };
}

export function createModelPrototype(seed: string, scenario: ModelScenario): ModelState {
  const preset = SCENARIOS[scenario];
  return createModelBoard(seed, preset.budget, preset.horizon, preset.jobs, undefined, scenario);
}

export function viewModel(state: ModelState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    remainingBudget: state.budget - state.spent,
    pendingModel: state.pendingModel,
    reviewLoad: state.reviewLoad,
    shippedValue: state.shippedValue,
    jobs: state.jobs.map((job) => ({
      id: job.id,
      kind: job.kind,
      progress: job.progress,
      work: job.work,
      value: job.value,
      model: job.model,
      shipped: job.shipped,
      defect: job.defect,
    })),
    models: {
      none: { speed: HUMAN_SPEED, cost: 0 },
      fast: { ...MODEL_STATS.fast, complexPenalty: COMPLEX_FAST_PENALTY },
      precise: { ...MODEL_STATS.precise, simpleReview: PRECISE_SIMPLE_REVIEW },
    },
  };
}

function isAssignable(model: string): model is AssignedModel {
  return model === 'none' || model === 'fast' || model === 'precise';
}

function openJob(state: ModelState): ModelJob | undefined {
  return state.jobs.find((job) => job.shipped === null);
}

export function canAffordModel(state: ModelState, model: string): boolean {
  if (model === 'none') return true;
  if (model !== 'fast' && model !== 'precise') return false;
  return state.budget - state.spent >= MODEL_STATS[model].cost;
}

export function applyModelInput(state: ModelState, input: ModelInput): ModelState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'assign') return assignModel(state, input.model);
  return workTick(state);
}

function assignModel(state: ModelState, model: string): ModelState {
  if (!isAssignable(model) || !openJob(state) || !canAffordModel(state, model)) return state;
  if (state.pendingModel === model) return state;
  const next = structuredClone(state);
  next.pendingModel = model;
  next.inputs.push({ type: 'assign', model });
  return next;
}

function workTick(state: ModelState): ModelState {
  const next = structuredClone(state);
  next.tick += 1;
  const job = openJob(next);
  if (!job) {
    next.resolutions.push(`t${next.tick}:idle`);
    next.inputs.push({ type: 'tick' });
    return next;
  }
  const lockedNow = job.model === null;
  let clearedPending = false;
  if (
    lockedNow &&
    next.pendingModel !== null &&
    next.pendingModel !== 'none' &&
    !canAffordModel(next, next.pendingModel)
  ) {
    next.pendingModel = null;
    clearedPending = true;
  }
  if (lockedNow) job.model = next.pendingModel ?? 'none';
  const model = job.model ?? 'none';
  let speed = HUMAN_SPEED;
  let note = clearedPending
    ? 'budget:clear'
    : model === 'none' && lockedNow && next.pendingModel === null
      ? 'default-none'
      : model;
  if (model === 'fast' || model === 'precise') {
    const stats = MODEL_STATS[model];
    if (next.budget - next.spent >= stats.cost) {
      next.spent += stats.cost;
      speed = stats.speed;
      note = model;
    } else {
      speed = HUMAN_SPEED;
      note = 'budget:fallback';
    }
  }
  job.progress += speed;
  const notes = [`t${next.tick}:${job.id}:${note}+${speed}`];
  if (job.progress >= job.work) {
    const defect = model === 'fast' && job.kind === 'complex';
    job.defect = defect;
    job.shipped = job.value - (defect ? COMPLEX_FAST_PENALTY : 0);
    next.shippedValue += job.shipped;
    notes.push(`ship:${job.shipped}`);
    if (defect) notes.push('defect');
    if (model === 'precise' && job.kind === 'simple') {
      next.reviewLoad += PRECISE_SIMPLE_REVIEW;
      notes.push(`review+${PRECISE_SIMPLE_REVIEW}`);
    }
  }
  next.resolutions.push(notes.join(','));
  next.inputs.push({ type: 'tick' });
  return next;
}

export function summarizeModel(state: ModelState) {
  return {
    tick: state.tick,
    spent: state.spent,
    remainingBudget: state.budget - state.spent,
    shippedValue: state.shippedValue,
    reviewLoad: state.reviewLoad,
    defects: state.jobs.filter((job) => job.defect).map((job) => job.id),
    shippedJobs: state.jobs
      .filter((job) => job.shipped !== null)
      .map((job) => ({
        id: job.id,
        model: job.model,
        shipped: job.shipped,
        defect: job.defect,
      })),
    resolutions: state.resolutions,
    netValue: state.shippedValue - state.spent - state.reviewLoad,
  };
}

export function chooseModelAction(state: ModelState, strategy: ModelStrategy): ModelInput {
  const job = openJob(state);
  if (!job) return { type: 'tick' };
  const desired: AssignedModel =
    strategy === 'match' ? (job.kind === 'complex' ? 'precise' : 'fast') : strategy;
  if (job.model === null && state.pendingModel !== desired && canAffordModel(state, desired)) {
    return { type: 'assign', model: desired };
  }
  if (
    job.model === null &&
    state.pendingModel !== null &&
    state.pendingModel !== 'none' &&
    !canAffordModel(state, state.pendingModel)
  ) {
    return { type: 'assign', model: 'none' };
  }
  return { type: 'tick' };
}

const COMPARE_ROWS: { scenario: ModelScenario; strategies: ModelStrategy[] }[] = [
  { scenario: 'volume', strategies: ['fast', 'precise', 'none'] },
  { scenario: 'hard', strategies: ['fast', 'precise', 'none'] },
  { scenario: 'mixed', strategies: ['match', 'fast', 'precise', 'none'] },
  { scenario: 'broke', strategies: ['none', 'fast', 'precise'] },
];

export function compareModelStrategies(seed: string) {
  return COMPARE_ROWS.flatMap(({ scenario, strategies }) =>
    strategies.map((strategy) => {
      const initial = createModelPrototype(seed, scenario);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 40) throw new Error(`${scenario}:${strategy}`);
        const action = chooseModelAction(state, strategy);
        const next = applyModelInput(state, action);
        if (next === state) throw new Error(`${scenario}:${strategy} tick ${state.tick}`);
        state = next;
      }
      return {
        scenario,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeModel(state),
      };
    }),
  );
}

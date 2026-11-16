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
/** 初回比較の資源。速度と仕事の価値は動かさない。 */
export interface ModelRules {
  fastCost: number;
  preciseCost: number;
  defectPenalty: number;
  simpleReview: number;
  budgetRecovery: number;
}
export const baselineModelRules: ModelRules = {
  fastCost: MODEL_STATS.fast.cost,
  preciseCost: MODEL_STATS.precise.cost,
  defectPenalty: COMPLEX_FAST_PENALTY,
  simpleReview: PRECISE_SIMPLE_REVIEW,
  budgetRecovery: 0,
};

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

export function viewModel(state: ModelState, rules: ModelRules = baselineModelRules) {
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
      fast: {
        speed: MODEL_STATS.fast.speed,
        cost: rules.fastCost,
        complexPenalty: rules.defectPenalty,
      },
      precise: {
        speed: MODEL_STATS.precise.speed,
        cost: rules.preciseCost,
        simpleReview: rules.simpleReview,
      },
    },
  };
}

function isAssignable(model: string): model is AssignedModel {
  return model === 'none' || model === 'fast' || model === 'precise';
}

function openJob(state: ModelState): ModelJob | undefined {
  return state.jobs.find((job) => job.shipped === null);
}

function modelCost(model: ModelId, rules: ModelRules): number {
  return model === 'fast' ? rules.fastCost : rules.preciseCost;
}

export function canAffordModel(
  state: ModelState,
  model: string,
  rules: ModelRules = baselineModelRules,
): boolean {
  if (model === 'none') return true;
  if (model !== 'fast' && model !== 'precise') return false;
  return state.budget - state.spent >= modelCost(model, rules);
}

export function applyModelInput(
  state: ModelState,
  input: ModelInput,
  rules: ModelRules = baselineModelRules,
): ModelState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'assign') return assignModel(state, input.model, rules);
  return workTick(state, rules);
}

function assignModel(state: ModelState, model: string, rules: ModelRules): ModelState {
  if (!isAssignable(model) || !openJob(state) || !canAffordModel(state, model, rules)) return state;
  if (state.pendingModel === model) return state;
  const next = structuredClone(state);
  next.pendingModel = model;
  next.inputs.push({ type: 'assign', model });
  return next;
}

function workTick(state: ModelState, rules: ModelRules): ModelState {
  const next = structuredClone(state);
  next.tick += 1;
  if (rules.budgetRecovery !== 0) next.budget += rules.budgetRecovery;
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
    !canAffordModel(next, next.pendingModel, rules)
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
    const cost = modelCost(model, rules);
    if (next.budget - next.spent >= cost) {
      next.spent += cost;
      speed = MODEL_STATS[model].speed;
      note = model;
    } else {
      speed = HUMAN_SPEED;
      note = 'budget:fallback';
    }
  }
  job.progress += speed;
  const notes = [`t${next.tick}:${job.id}:${note}+${speed}`];
  if (job.progress >= job.work) {
    const defect = model === 'fast' && job.kind === 'complex' && rules.defectPenalty !== 0;
    job.defect = defect;
    job.shipped = job.value - (defect ? rules.defectPenalty : 0);
    next.shippedValue += job.shipped;
    notes.push(`ship:${job.shipped}`);
    if (defect) notes.push('defect');
    if (model === 'precise' && job.kind === 'simple' && rules.simpleReview !== 0) {
      next.reviewLoad += rules.simpleReview;
      notes.push(`review+${rules.simpleReview}`);
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

export function chooseModelAction(
  state: ModelState,
  strategy: ModelStrategy,
  rules: ModelRules = baselineModelRules,
): ModelInput {
  const job = openJob(state);
  if (!job) return { type: 'tick' };
  const desired: AssignedModel =
    strategy === 'match' ? (job.kind === 'complex' ? 'precise' : 'fast') : strategy;
  if (job.model !== null) return { type: 'tick' };
  if (!canAffordModel(state, desired, rules)) {
    if (state.pendingModel !== null && state.pendingModel !== 'none') {
      return { type: 'assign', model: 'none' };
    }
    return { type: 'tick' };
  }
  if (state.pendingModel !== desired) return { type: 'assign', model: desired };
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

const FACTOR_SEED = 'RI-189';
const FACTOR_SCENARIOS: ModelScenario[] = ['volume', 'hard', 'mixed', 'broke'];
export type ModelPreference = 'precise' | 'fast' | 'tie';
export interface ModelFactorRun {
  inputs: ModelInput[];
  result: ReturnType<typeof summarizeModel>;
}
export interface ModelScenarioComparison {
  scenario: ModelScenario;
  preference: ModelPreference;
  margin: number;
  fast: ModelFactorRun;
  precise: ModelFactorRun;
}
export interface ModelFactorPoint {
  axis: string;
  parameter: string;
  rules: ModelRules;
  scenarios: ModelScenarioComparison[];
}
export interface ModelFactorReversal {
  axis: string;
  scenario: ModelScenario;
  before: { parameter: string; preference: ModelPreference; fast: number; precise: number };
  after: { parameter: string; preference: ModelPreference; fast: number; precise: number };
}
function cloneRules(rules: ModelRules): ModelRules {
  return { ...rules };
}
function withRules(patch: Partial<ModelRules>): ModelRules {
  return { ...baselineModelRules, ...patch };
}
function preferenceOf(fastNet: number, preciseNet: number): ModelPreference {
  if (preciseNet > fastNet) return 'precise';
  if (fastNet > preciseNet) return 'fast';
  return 'tie';
}
function runModel(
  scenario: ModelScenario,
  strategy: 'fast' | 'precise',
  rules: ModelRules,
): ModelFactorRun {
  let state = createModelPrototype(FACTOR_SEED, scenario);
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 40) throw new Error(`${scenario}:${strategy}`);
    const next = applyModelInput(state, chooseModelAction(state, strategy, rules), rules);
    if (next === state) throw new Error(`${scenario}:${strategy} tick ${state.tick}`);
    state = next;
  }
  return { inputs: state.inputs, result: summarizeModel(state) };
}
function point(axis: string, parameter: string, rules: ModelRules): ModelFactorPoint {
  const scenarios = FACTOR_SCENARIOS.map((scenario) => {
    const fast = runModel(scenario, 'fast', rules);
    const precise = runModel(scenario, 'precise', rules);
    const fastNet = fast.result.netValue;
    const preciseNet = precise.result.netValue;
    return {
      scenario,
      preference: preferenceOf(fastNet, preciseNet),
      margin: preciseNet - fastNet,
      fast,
      precise,
    };
  });
  return { axis, parameter, rules: cloneRules(rules), scenarios };
}
function reversalsOf(rows: ModelFactorPoint[]): ModelFactorReversal[] {
  const found: ModelFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after) continue;
    for (const scenario of FACTOR_SCENARIOS) {
      const earlier = before.scenarios.find((item) => item.scenario === scenario);
      const later = after.scenarios.find((item) => item.scenario === scenario);
      if (!earlier || !later || earlier.preference === later.preference) continue;
      found.push({
        axis: before.axis,
        scenario,
        before: {
          parameter: before.parameter,
          preference: earlier.preference,
          fast: earlier.fast.result.netValue,
          precise: earlier.precise.result.netValue,
        },
        after: {
          parameter: after.parameter,
          preference: later.preference,
          fast: later.fast.result.netValue,
          precise: later.precise.result.netValue,
        },
      });
    }
  }
  return found;
}
/** 初回と同じ資源で、高いモデルの利用費・欠陥・レビュー負荷・予算回復を一つずつ動かす。固定戦略。 */
export function compareModelFactorReversals() {
  const sweeps = {
    preciseCost: [0, 1, 2, 3, 4, 5, 6].map((preciseCost) =>
      point('preciseCost', String(preciseCost), withRules({ preciseCost })),
    ),
    defectPenalty: [0, 6, 9, 10, 12, 16, 17, 18].map((defectPenalty) =>
      point('defectPenalty', String(defectPenalty), withRules({ defectPenalty })),
    ),
    simpleReview: [0, 1, 2, 3, 6].map((simpleReview) =>
      point('simpleReview', String(simpleReview), withRules({ simpleReview })),
    ),
    budgetRecovery: [0, 1, 2, 4].map((budgetRecovery) =>
      point('budgetRecovery', String(budgetRecovery), withRules({ budgetRecovery })),
    ),
  };
  return {
    conditions: {
      seed: FACTOR_SEED,
      scenarios: FACTOR_SCENARIOS.map((scenario) => ({
        scenario,
        ...SCENARIOS[scenario],
      })),
      decision: { cheap: 'fast', high: 'precise', score: 'netValue', margin: 'precise - fast' },
      baseline: cloneRules(baselineModelRules),
      speeds: {
        fast: MODEL_STATS.fast.speed,
        precise: MODEL_STATS.precise.speed,
        human: HUMAN_SPEED,
      },
      jobWork: JOB_WORK,
      jobValue: JOB_VALUE,
      held: {
        preciseCost: '高いモデルの1tick利用費だけを動かす。安いモデルの利用費は1',
        defectPenalty: '安いモデルが複雑な仕事を終えたときの欠陥だけを動かす',
        simpleReview: '高いモデルが単純な仕事を終えたときのレビュー負荷だけを動かす',
        budgetRecovery:
          '各tickの作業開始時に予算上限へ足す額だけを動かす。払った利用費は戻さない。期首の判断は初期予算を見る',
      },
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

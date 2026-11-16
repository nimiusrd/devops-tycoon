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
export type PlanRelation = 'plan' | 'rush' | 'tie';
export type PlanInput = ModelInput | { type: 'plan' };
/** 迷走量は追加作業と完了時ペナルティの二つの数。合成せず、一つずつ動かす。 */
export interface PlanFactors {
  planTicks: number;
  wanderWork: number;
  wanderPenalty: number;
}
export const BASELINE_PLAN_FACTORS: PlanFactors = {
  planTicks: PLAN_TICKS,
  wanderWork: WANDER_WORK,
  wanderPenalty: WANDER_PENALTY,
};
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
  /** 無いときは初回の固定係数。感度比較だけが上書きする。 */
  factors?: PlanFactors;
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
  if (next.planningTicks >= readFactors(next).planTicks) {
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

function readFactors(state: PlanState): PlanFactors {
  return {
    planTicks: state.factors?.planTicks ?? PLAN_TICKS,
    wanderWork: state.factors?.wanderWork ?? WANDER_WORK,
    wanderPenalty: state.factors?.wanderPenalty ?? WANDER_PENALTY,
  };
}

function codeTick(state: PlanState): PlanState {
  const job = openJob(state);
  const next = structuredClone(state);
  const factors = readFactors(next);
  if (
    job &&
    job.progress === 0 &&
    job.kind === 'complex' &&
    !next.planned.includes(job.id) &&
    !next.wandered.includes(job.id)
  ) {
    const target = next.board.jobs.find((item) => item.id === job.id)!;
    target.work += factors.wanderWork;
    next.wandered.push(job.id);
    next.board.resolutions.push(`wander:${job.id}+${factors.wanderWork}`);
  }
  const before = new Map(next.board.jobs.map((item) => [item.id, item.shipped]));
  next.board = applyModelInput(next.board, { type: 'tick' });
  for (const item of next.board.jobs) {
    if (before.get(item.id) === null && item.shipped !== null && next.wandered.includes(item.id)) {
      item.shipped -= factors.wanderPenalty;
      next.board.shippedValue -= factors.wanderPenalty;
      next.board.resolutions.push(`wander-penalty:${item.id}-${factors.wanderPenalty}`);
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

const PLAN_SCENARIOS: PlanScenario[] = ['simpleShort', 'complexTight', 'complexLong'];
const FACTOR_NAMES: (keyof PlanFactors)[] = ['planTicks', 'wanderWork', 'wanderPenalty'];
const PLAN_TICK_VALUES = [1, 2, 3, 4, 5, 6, 7, 8];
const WANDER_WORK_VALUES = [0, 1, 2, 3, 4, 5, 6, 7];
const WANDER_PENALTY_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8];

export interface PlanFactorPlay {
  strategy: PlanStrategy;
  inputs: PlanInput[];
  result: ReturnType<typeof summarizePlan>;
}

export interface PlanFactorRow {
  scenario: PlanScenario;
  factors: PlanFactors;
  differsFromAnchor: (keyof PlanFactors)[];
  sameAsFirstComparison: boolean;
  plays: PlanFactorPlay[];
  relation: PlanRelation;
  planNet: number;
  rushNet: number;
  gap: number;
}

export interface PlanFactorReversal {
  factor: keyof PlanFactors;
  scenario: PlanScenario;
  before: { factors: PlanFactors; relation: PlanRelation; gap: number };
  after: { factors: PlanFactors; relation: PlanRelation; gap: number };
}

/** 初回の係数なら factors を付けず、感度の上書きだけを状態へコピーする。 */
export function createPlanFactorState(
  seed: string,
  scenario: PlanScenario,
  factors: PlanFactors,
): PlanState {
  const state = createPlanPrototype(seed, scenario);
  if (FACTOR_NAMES.every((name) => factors[name] === BASELINE_PLAN_FACTORS[name])) return state;
  return { ...state, factors: { ...factors } };
}

function relationOf(planNet: number, rushNet: number): PlanRelation {
  if (planNet === rushNet) return 'tie';
  if (planNet > rushNet) return 'plan';
  return 'rush';
}

function runFactorStrategy(
  seed: string,
  scenario: PlanScenario,
  strategy: PlanStrategy,
  factors: PlanFactors,
): PlanFactorPlay {
  let state = createPlanFactorState(seed, scenario, factors);
  let guard = 0;
  while (state.board.tick < state.board.horizon) {
    if (++guard > 40) throw new Error(`${scenario}:${strategy}`);
    const action = choosePlanAction(state, strategy);
    const next = applyPlanInput(state, action);
    if (next === state) throw new Error(`${scenario}:${strategy} tick ${state.board.tick}`);
    state = next;
  }
  return { strategy, inputs: state.inputs, result: summarizePlan(state) };
}

function factorRow(seed: string, scenario: PlanScenario, factors: PlanFactors): PlanFactorRow {
  const plays = (['rush', 'plan'] as const).map((strategy) =>
    runFactorStrategy(seed, scenario, strategy, factors),
  );
  const rush = plays.find((play) => play.strategy === 'rush');
  const plan = plays.find((play) => play.strategy === 'plan');
  if (rush === undefined || plan === undefined) throw new Error(scenario);
  const differsFromAnchor = FACTOR_NAMES.filter(
    (name) => factors[name] !== BASELINE_PLAN_FACTORS[name],
  );
  return {
    scenario,
    factors: { ...factors },
    differsFromAnchor,
    sameAsFirstComparison: differsFromAnchor.length === 0,
    plays,
    relation: relationOf(plan.result.netValue, rush.result.netValue),
    planNet: plan.result.netValue,
    rushNet: rush.result.netValue,
    gap: plan.result.netValue - rush.result.netValue,
  };
}

function sweepFactor(
  seed: string,
  factor: keyof PlanFactors,
  values: readonly number[],
): PlanFactorRow[] {
  if (!values.includes(BASELINE_PLAN_FACTORS[factor])) {
    throw new Error(`${factor} の範囲に初回の値がない`);
  }
  return PLAN_SCENARIOS.flatMap((scenario) =>
    values.map((value) => factorRow(seed, scenario, { ...BASELINE_PLAN_FACTORS, [factor]: value })),
  );
}

function adjacentReversals(factor: keyof PlanFactors, rows: PlanFactorRow[]): PlanFactorReversal[] {
  const found: PlanFactorReversal[] = [];
  for (const scenario of PLAN_SCENARIOS) {
    const series = rows.filter((row) => row.scenario === scenario);
    for (let index = 1; index < series.length; index += 1) {
      const before = series[index - 1];
      const after = series[index];
      if (before === undefined || after === undefined || before.relation === after.relation) {
        continue;
      }
      found.push({
        factor,
        scenario,
        before: { factors: before.factors, relation: before.relation, gap: before.gap },
        after: { factors: after.factors, relation: after.relation, gap: after.gap },
      });
    }
  }
  return found;
}

/**
 * 初回と同じ資源で、計画tick・迷走の追加作業・迷走ペナルティを一つずつ動かす。
 * 固定戦略の計算であり、人間のプレイ評価でも本番採用の結論でもない。
 */
export function comparePlanFactorReversals(seed: string) {
  const sweeps = {
    planTicks: sweepFactor(seed, 'planTicks', PLAN_TICK_VALUES),
    wanderWork: sweepFactor(seed, 'wanderWork', WANDER_WORK_VALUES),
    wanderPenalty: sweepFactor(seed, 'wanderPenalty', WANDER_PENALTY_VALUES),
  };
  return {
    seed,
    conditions: {
      anchor: { ...BASELINE_PLAN_FACTORS },
      ranges: {
        planTicks: [...PLAN_TICK_VALUES],
        wanderWork: [...WANDER_WORK_VALUES],
        wanderPenalty: [...WANDER_PENALTY_VALUES],
      },
      resources:
        '初回と同じ。予算0、進捗1、作業量6、単純価値10、複雑価値18。盤面は単純期末6、複雑期末8、複雑期末12。',
      axes: {
        planTicks: '計画が完了するまでのtick。発見はこの回数に達したtickで一度記録する。',
        wanderWork:
          '未計画の複雑仕事の最初の実装tickで増やす作業量。0でも迷走済みになり、ペナルティは別軸。',
        wanderPenalty:
          '迷走済みの仕事が完了したとき出荷価値から一度だけ引く量。未完了には乗らない。',
      },
      strategies: ['rush', 'plan'] as const,
      score:
        '差引は出荷価値。利用費は0。同点は出荷価値が等しいこと。発見と迷走の記録は順位に使わない。',
      variedOneAtATime: true,
      fixedStrategies: true,
      humanPlaytest: false,
      productionAdoption: false,
      repeatedFirstComparison: false,
      statement:
        '固定戦略の計算である。人間のプレイ評価はしていない。本番採用の結論は出さない。初回の三行を再結論にしない。',
    },
    sweeps,
    reversals: [
      ...adjacentReversals('planTicks', sweeps.planTicks),
      ...adjacentReversals('wanderWork', sweeps.wanderWork),
      ...adjacentReversals('wanderPenalty', sweeps.wanderPenalty),
    ],
  };
}

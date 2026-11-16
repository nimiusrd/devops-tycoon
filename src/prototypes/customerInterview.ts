/** RI-231: 聞き取りは1期間の余力を使う。真の需要は閲覧へ出さない。RI-229 の顧客構成を使う。 */

import { rosterOf, type CustomerRoster } from './customerSegments';
import { applyFeatureWork, PRODUCT_CAPACITY } from './productGrowth';

export type InterviewFeature = 'api' | 'screen' | 'billing';
export type InterviewBoard = 'urgent' | 'uncertain' | 'mislead';
export type InterviewStrategy = 'rush' | 'ask' | 'askMiss';
export type InterviewInput =
  { type: 'ask' } | { type: 'build'; feature: InterviewFeature } | { type: 'view' };

export interface InterviewState {
  version: 1;
  seed: string;
  board: InterviewBoard;
  tick: number;
  horizon: number;
  capacity: number;
  deadline: number;
  /** 基準の1期間は省く。上書きした確認期間だけを保存する。 */
  askTicks?: number;
  needed: InterviewFeature;
  clueLikely: InterviewFeature;
  clueOther: InterviewFeature;
  rumor: InterviewFeature;
  speaker: CustomerRoster;
  asked: boolean;
  likely: InterviewFeature | null;
  unconfirmed: InterviewFeature | null;
  progress: Record<InterviewFeature, number>;
  delivered: boolean;
  value: number;
  late: number;
  listenCost: number;
  inputs: InterviewInput[];
}

const NEED = 4;
const VALUE = 12;
const LATE_PENALTY = 10;
const FEATURES: readonly InterviewFeature[] = ['api', 'screen', 'billing'];

const BOARDS: Record<
  InterviewBoard,
  {
    needed: InterviewFeature;
    clueLikely: InterviewFeature;
    clueOther: InterviewFeature;
    deadline: number;
    speaker: 'pioneer' | 'keeper';
  }
> = {
  urgent: {
    needed: 'api',
    clueLikely: 'api',
    clueOther: 'billing',
    deadline: 1,
    speaker: 'pioneer',
  },
  uncertain: {
    needed: 'screen',
    clueLikely: 'screen',
    clueOther: 'billing',
    deadline: 3,
    speaker: 'keeper',
  },
  mislead: {
    needed: 'billing',
    clueLikely: 'screen',
    clueOther: 'billing',
    deadline: 3,
    speaker: 'keeper',
  },
};

function isFeature(value: string): value is InterviewFeature {
  return FEATURES.includes(value as InterviewFeature);
}

export interface InterviewRules {
  deadline: number;
  askTicks: number;
  needed: InterviewFeature;
  clueLikely: InterviewFeature;
  clueOther: InterviewFeature;
}

/** rules を渡した欄だけ盤面プリセットを上書きする。未指定の欄は初回の値。確認期間1は状態に残さない。 */
export function createCustomerInterview(
  seed: string,
  board: InterviewBoard,
  rules?: Partial<InterviewRules>,
): InterviewState {
  const preset = BOARDS[board];
  const askTicks = rules?.askTicks ?? 1;
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 3,
    capacity: PRODUCT_CAPACITY,
    deadline: rules?.deadline ?? preset.deadline,
    ...(askTicks === 1 ? {} : { askTicks }),
    needed: rules?.needed ?? preset.needed,
    clueLikely: rules?.clueLikely ?? preset.clueLikely,
    clueOther: rules?.clueOther ?? preset.clueOther,
    rumor: 'api',
    speaker: rosterOf(preset.speaker),
    asked: false,
    likely: null,
    unconfirmed: null,
    progress: { api: 0, screen: 0, billing: 0 },
    delivered: false,
    value: 0,
    late: 0,
    listenCost: 0,
    inputs: [],
  };
}

function askPeriods(state: InterviewState): number {
  return state.askTicks ?? 1;
}

/** 聞き取りは一度だけ候補を狭める。消費期間は askTicks で、無いときは1。真の需要そのものは返さない。 */
export function applyCustomerInterview(
  state: InterviewState,
  input: InterviewInput,
): InterviewState {
  if (input.type === 'view' || state.tick >= state.horizon) return state;
  if (input.type === 'ask') {
    if (state.asked) return state;
    const next = structuredClone(state);
    const periods = askPeriods(next);
    next.asked = true;
    next.likely = next.clueLikely;
    next.unconfirmed = next.clueOther;
    next.listenCost += next.capacity * periods;
    next.tick += periods;
    next.inputs.push({ type: 'ask' });
    return next;
  }
  if (input.type !== 'build' || !isFeature(input.feature)) return state;
  const next = structuredClone(state);
  const applied = applyFeatureWork(next.progress[input.feature], NEED, next.capacity);
  next.progress[input.feature] = applied.done;
  if (applied.completed && input.feature === next.needed && !next.delivered) {
    next.delivered = true;
    next.value += VALUE;
    if (next.tick >= next.deadline) next.late += LATE_PENALTY;
  }
  next.tick += 1;
  next.inputs.push({ type: 'build', feature: input.feature });
  return next;
}

export function viewCustomerInterview(state: InterviewState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    capacity: state.capacity,
    deadline: state.deadline,
    rumor: state.rumor,
    speaker: { ...state.speaker },
    asked: state.asked,
    likely: state.likely,
    unconfirmed: state.unconfirmed,
    unknowns: state.asked ? (['unconfirmed-feature'] as const) : (['needed-feature'] as const),
    valueIfRight: VALUE,
    latePenalty: LATE_PENALTY,
  };
}

export function summarizeCustomerInterview(state: InterviewState) {
  return {
    value: state.value,
    late: state.late,
    listenCost: state.listenCost,
    delivered: state.delivered,
    score: state.value - state.late,
    lost: false,
  };
}

export function chooseInterviewAction(
  state: InterviewState,
  strategy: InterviewStrategy,
): InterviewInput {
  if (strategy === 'rush') return { type: 'build', feature: state.rumor };
  if (!state.asked || state.likely === null || state.unconfirmed === null) return { type: 'ask' };
  return { type: 'build', feature: strategy === 'ask' ? state.likely : state.unconfirmed };
}

function playInterview(
  seed: string,
  board: InterviewBoard,
  strategy: InterviewStrategy,
  rules?: Partial<InterviewRules>,
) {
  const initial = createCustomerInterview(seed, board, rules);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 10) throw new Error(`${board}:${strategy}`);
    const input = chooseInterviewAction(state, strategy);
    const next = applyCustomerInterview(state, input);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { initial, inputs: state.inputs, result: summarizeCustomerInterview(state) };
}

export function compareCustomerInterviews(seed = 'RI-231') {
  return (['urgent', 'uncertain', 'mislead'] as const).flatMap((board) =>
    (['rush', 'ask', 'askMiss'] as const).map((strategy) => {
      const played = playInterview(seed, board, strategy);
      return {
        board,
        strategy,
        initial: played.initial,
        inputs: played.inputs,
        result: played.result,
      };
    }),
  );
}

export type InterviewFactorAxis = 'deadline' | 'askTicks' | 'candidates';
export type InterviewPreference = 'rush' | 'ask' | 'tie';
export type InterviewFactorHeld =
  | {
      askTicks: number;
      needed: InterviewFeature;
      clueLikely: InterviewFeature;
      clueOther: InterviewFeature;
    }
  | {
      deadline: number;
      needed: InterviewFeature;
      clueLikely: InterviewFeature;
      clueOther: InterviewFeature;
    }
  | { deadline: number; askTicks: number; clueOther: InterviewFeature };

export interface InterviewFactorRun {
  inputs: InterviewInput[];
  result: ReturnType<typeof summarizeCustomerInterview>;
}

export interface InterviewFactorRow {
  axis: InterviewFactorAxis;
  parameter: string;
  board: InterviewBoard;
  rules: InterviewRules;
  preference: InterviewPreference;
  margin: number;
  leaders: InterviewStrategy[];
  scores: Record<InterviewStrategy, number>;
  runs: Record<InterviewStrategy, InterviewFactorRun>;
  initial: InterviewState;
}

export interface InterviewFactorReversal {
  axis: InterviewFactorAxis;
  held: InterviewFactorHeld;
  before: {
    parameter: string;
    preference: InterviewPreference;
    rush: number;
    ask: number;
    askMiss: number;
  };
  after: {
    parameter: string;
    preference: InterviewPreference;
    rush: number;
    ask: number;
    askMiss: number;
  };
}

export interface InterviewFactorSeries {
  axis: InterviewFactorAxis;
  anchor: InterviewBoard;
  held: InterviewFactorHeld;
  rows: InterviewFactorRow[];
  reversals: InterviewFactorReversal[];
}

const FACTOR_SEED = 'RI-231';
const FACTOR_AXES = ['deadline', 'askTicks', 'candidates'] as const;
const CANDIDATE_STEPS = [
  { parameter: 'both-correct', needed: 'api', clueLikely: 'api' },
  { parameter: 'likely-wrong', needed: 'api', clueLikely: 'screen' },
  { parameter: 'likely-correct', needed: 'screen', clueLikely: 'screen' },
  { parameter: 'other-correct', needed: 'billing', clueLikely: 'screen' },
] as const satisfies readonly {
  parameter: string;
  needed: InterviewFeature;
  clueLikely: InterviewFeature;
}[];

function baselineRules(board: InterviewBoard): InterviewRules {
  const preset = BOARDS[board];
  return {
    deadline: preset.deadline,
    askTicks: 1,
    needed: preset.needed,
    clueLikely: preset.clueLikely,
    clueOther: preset.clueOther,
  };
}

function heldFor(anchor: InterviewBoard, axis: InterviewFactorAxis): InterviewFactorHeld {
  const rules = baselineRules(anchor);
  if (axis === 'deadline') {
    return {
      askTicks: rules.askTicks,
      needed: rules.needed,
      clueLikely: rules.clueLikely,
      clueOther: rules.clueOther,
    };
  }
  if (axis === 'askTicks') {
    return {
      deadline: rules.deadline,
      needed: rules.needed,
      clueLikely: rules.clueLikely,
      clueOther: rules.clueOther,
    };
  }
  return { deadline: rules.deadline, askTicks: rules.askTicks, clueOther: rules.clueOther };
}

function boardFor(anchor: InterviewBoard, rules: InterviewRules): InterviewBoard {
  const preset = (['urgent', 'uncertain', 'mislead'] as const).find((board) => {
    const base = BOARDS[board];
    return (
      base.deadline === rules.deadline &&
      base.needed === rules.needed &&
      base.clueLikely === rules.clueLikely &&
      base.clueOther === rules.clueOther
    );
  });
  return preset ?? anchor;
}

function preferenceOf(rush: number, ask: number): InterviewPreference {
  if (ask > rush) return 'ask';
  if (rush > ask) return 'rush';
  return 'tie';
}

function leadersOf(scores: Record<InterviewStrategy, number>): InterviewStrategy[] {
  const top = Math.max(scores.rush, scores.ask, scores.askMiss);
  return (['rush', 'ask', 'askMiss'] as const).filter((strategy) => scores[strategy] === top);
}

function sameState(left: InterviewState, right: InterviewState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function factorRow(
  axis: InterviewFactorAxis,
  anchor: InterviewBoard,
  parameter: string,
  rules: InterviewRules,
): InterviewFactorRow {
  const board = boardFor(anchor, rules);
  const rush = playInterview(FACTOR_SEED, board, 'rush', rules);
  const ask = playInterview(FACTOR_SEED, board, 'ask', rules);
  const askMiss = playInterview(FACTOR_SEED, board, 'askMiss', rules);
  if (!sameState(rush.initial, ask.initial) || !sameState(rush.initial, askMiss.initial)) {
    throw new Error(`${axis}:${parameter}`);
  }
  const scores = {
    rush: rush.result.score,
    ask: ask.result.score,
    askMiss: askMiss.result.score,
  };
  return {
    axis,
    parameter,
    board,
    rules,
    preference: preferenceOf(scores.rush, scores.ask),
    margin: scores.ask - scores.rush,
    leaders: leadersOf(scores),
    scores,
    runs: {
      rush: { inputs: rush.inputs, result: rush.result },
      ask: { inputs: ask.inputs, result: ask.result },
      askMiss: { inputs: askMiss.inputs, result: askMiss.result },
    },
    initial: rush.initial,
  };
}

function reversalsOf(
  rows: InterviewFactorRow[],
  held: InterviewFactorHeld,
): InterviewFactorReversal[] {
  const found: InterviewFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after || before.preference === after.preference) continue;
    found.push({
      axis: before.axis,
      held,
      before: {
        parameter: before.parameter,
        preference: before.preference,
        rush: before.scores.rush,
        ask: before.scores.ask,
        askMiss: before.scores.askMiss,
      },
      after: {
        parameter: after.parameter,
        preference: after.preference,
        rush: after.scores.rush,
        ask: after.scores.ask,
        askMiss: after.scores.askMiss,
      },
    });
  }
  return found;
}

function buildSeries(
  axis: InterviewFactorAxis,
  anchor: InterviewBoard,
  steps: readonly { parameter: string; rules: InterviewRules }[],
): InterviewFactorSeries {
  const held = heldFor(anchor, axis);
  const rows = steps.map((step) => factorRow(axis, anchor, step.parameter, step.rules));
  return { axis, anchor, held, rows, reversals: reversalsOf(rows, held) };
}

function deadlineSteps(anchor: InterviewBoard) {
  return [0, 1, 2, 3].map((deadline) => ({
    parameter: String(deadline),
    rules: { ...baselineRules(anchor), deadline },
  }));
}

function askSteps(anchor: InterviewBoard) {
  return [0, 1, 2, 3].map((askTicks) => ({
    parameter: String(askTicks),
    rules: { ...baselineRules(anchor), askTicks },
  }));
}

function candidateSteps(anchor: InterviewBoard) {
  const base = baselineRules(anchor);
  return CANDIDATE_STEPS.map((step) => ({
    parameter: step.parameter,
    rules: { ...base, needed: step.needed, clueLikely: step.clueLikely },
  }));
}

/** 初回と同じ資源で、期限・確認期間・候補の組み合わせを一つずつ動かす。固定戦略。 */
export function compareCustomerInterviewFactors() {
  const sample = createCustomerInterview(FACTOR_SEED, 'urgent');
  const shown = viewCustomerInterview(sample);
  const sweeps = {
    deadline: (['urgent', 'uncertain', 'mislead'] as const).map((anchor) =>
      buildSeries('deadline', anchor, deadlineSteps(anchor)),
    ),
    askTicks: (['urgent', 'uncertain', 'mislead'] as const).map((anchor) =>
      buildSeries('askTicks', anchor, askSteps(anchor)),
    ),
    candidates: (['urgent', 'uncertain'] as const).map((anchor) =>
      buildSeries('candidates', anchor, candidateSteps(anchor)),
    ),
  };
  return {
    conditions: {
      seed: FACTOR_SEED,
      horizon: sample.horizon,
      capacity: sample.capacity,
      need: NEED,
      value: VALUE,
      latePenalty: LATE_PENALTY,
      rumor: shown.rumor,
      features: [...FEATURES],
      score: 'value - late',
      listenCost: 'capacity * ask periods, excluded from score',
      strategies: {
        rush: '毎期間、噂を作る',
        ask: '一度聞き取り、その後は有力候補を作る',
        askMiss: '一度聞き取り、その後は未確認候補を作る',
      },
      decision: {
        compared: ['ask', 'rush'] as const,
        preference: '聞き取りの差引が大きいとき聞き取り、即着手が大きいとき即着手、同じとき同点',
        margin: '聞き取りの差引 - 即着手の差引',
        leaders:
          '三つの差引が最大の戦略。同点は複数。別候補が最大でも、即着手と聞き取りが同じなら優劣は同点',
      },
      baselines: {
        urgent: baselineRules('urgent'),
        uncertain: baselineRules('uncertain'),
        mislead: baselineRules('mislead'),
      },
      held: {
        deadline:
          '期限だけを動かす。確認期間は1。短納期は需要api・有力api・未確認billing、不確実は需要screen・有力screen・未確認billing、有力候補が外れるは需要billing・有力screen・未確認billing',
        askTicks:
          '確認期間だけを動かす。0は期間を使わない端で、基準規則ではない。短納期の期限は1、不確実と有力候補が外れる期限は3。候補は各盤面の初回のまま',
        candidates:
          '需要と有力候補の組み合わせだけを動かす。噂はapi、未確認候補はbilling、確認期間は1。期限1の列は短納期、期限3の列は不確実と有力候補が外れるの資源。各段は需要か有力候補の一方だけが変わる',
      },
      relation:
        '即着手は噂が需要と一致するとき、完成tick 0が期限未満なら完成価値、以上なら完成価値から期限遅れを引く。一致しなければ0。聞き取りは有力候補が需要と一致し、確認期間が期間未満のとき、完成tickである確認期間で同じく計算する。それ以外は0。別候補は未確認候補で同じ式。差引は完成価値−期限遅れ。確認費用は余力×確認期間で差引に入れない',
      inputs:
        '即着手の入力は噂を期間の数だけ作る。聞き取りと別候補は確認を1回入れ、残った期間だけ有力候補か未確認候補を作る。確認期間と候補でその入力列は変わる',
      hiddenDemand: '確認期間0でも聞き取りは真の需要を返さず、有力候補と未確認候補だけを返す',
      askTicksOnState:
        '確認期間1は状態にaskTicksを足さない。上書きしたときだけ保存し、初回JSONの形は変えない',
      nextUncertainty:
        '有力候補が外れたあと残期間で未確認候補も作る適応にすると、未確認だけが正しい組み合わせで即着手と聞き取りの同点が残るかは未検証。',
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    },
    sweeps,
    reversals: FACTOR_AXES.flatMap((axis) => sweeps[axis].flatMap((series) => series.reversals)),
  };
}

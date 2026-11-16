/** RI-222: 集中帯と相談帯をゲーム内期間へ割り当てる。実時間の待ちは持たない。感度比較だけ到着tick、解消費用、期限を変える。 */

export type FocusBoard = 'quiet' | 'burst' | 'steady';
export type FocusStrategy = 'always' | 'short' | 'long';
export type ConsultReserve = 0 | 2 | 6;
export type FocusInput = { type: 'allocate'; reserve: ConsultReserve } | { type: 'view' };
/** 感度で一つだけ動かす規則。未指定の着手は盤面の初回値を使う。 */
export interface FocusFactorRules {
  arrivals: readonly number[];
  resolveCost: number;
  slack: number;
}

export interface ConsultQuestion {
  id: number;
  wait: number;
}

export interface FocusState {
  version: 1;
  seed: string;
  board: FocusBoard;
  tick: number;
  horizon: number;
  slack: number;
  penaltyEach: number;
  capacity: number;
  resolveCost: number;
  nextId: number;
  queue: ConsultQuestion[];
  shipped: number;
  missed: number;
  penalty: number;
  wastedReserve: number;
  waitPeriods: number;
  inputs: FocusInput[];
}

const CAPACITY = 6;
const RESOLVE_COST = 2;
const HORIZON = 4;

const BOARDS: Record<
  FocusBoard,
  { arrivals: readonly number[]; slack: number; penaltyEach: number }
> = {
  quiet: { arrivals: [0, 0, 0, 0], slack: 0, penaltyEach: 0 },
  burst: { arrivals: [0, 4, 0, 0], slack: 1, penaltyEach: 5 },
  steady: { arrivals: [2, 2, 2, 2], slack: 0, penaltyEach: 7 },
};

const PLANS: Record<FocusStrategy, readonly ConsultReserve[]> = {
  always: [2, 2, 2, 2],
  short: [0, 6, 0, 6],
  long: [0, 0, 0, 6],
};

export function createFocusConsult(seed: string, board: FocusBoard): FocusState {
  const preset = BOARDS[board];
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: HORIZON,
    slack: preset.slack,
    penaltyEach: preset.penaltyEach,
    capacity: CAPACITY,
    resolveCost: RESOLVE_COST,
    nextId: 1,
    queue: [],
    shipped: 0,
    missed: 0,
    penalty: 0,
    wastedReserve: 0,
    waitPeriods: 0,
    inputs: [],
  };
}

function isReserve(value: number): value is ConsultReserve {
  return value === 0 || value === 2 || value === 6;
}

/** 相談枠は使わなくても出荷へ戻さない。未解消は期間末に待ちを1進め、期限超過で一度だけ罰する。 */
export function allocateConsult(
  state: FocusState,
  reserve: number,
  rules?: FocusFactorRules,
): FocusState {
  if (state.tick >= state.horizon || !isReserve(reserve)) return state;
  const next = structuredClone(state);
  const arrivals = rules
    ? (rules.arrivals[next.tick] ?? 0)
    : (BOARDS[next.board].arrivals[next.tick] ?? 0);
  const resolveCost = rules ? rules.resolveCost : next.resolveCost;
  const slack = rules ? rules.slack : next.slack;
  for (let index = 0; index < arrivals; index += 1) {
    next.queue.push({ id: next.nextId, wait: 0 });
    next.nextId += 1;
  }
  const resolved = Math.min(next.queue.length, Math.floor(reserve / resolveCost));
  next.queue.splice(0, resolved);
  next.wastedReserve += reserve - resolved * resolveCost;
  next.shipped += next.capacity - reserve;
  const kept: ConsultQuestion[] = [];
  for (const question of next.queue) {
    question.wait += 1;
    next.waitPeriods += 1;
    if (question.wait > slack) {
      next.missed += 1;
      next.penalty += next.penaltyEach;
    } else {
      kept.push(question);
    }
  }
  next.queue = kept;
  next.tick += 1;
  next.inputs.push({ type: 'allocate', reserve });
  return next;
}

export function applyFocusConsult(
  state: FocusState,
  input: FocusInput,
  rules?: FocusFactorRules,
): FocusState {
  if (input.type === 'view') return state;
  if (input.type !== 'allocate') return state;
  return allocateConsult(state, input.reserve, rules);
}

export function viewFocusConsult(state: FocusState) {
  const arrivals =
    state.tick >= state.horizon ? 0 : (BOARDS[state.board].arrivals[state.tick] ?? 0);
  return {
    tick: state.tick,
    horizon: state.horizon,
    slack: state.slack,
    arrivals,
    queue: state.queue.length,
    options: ([0, 2, 6] as const).map((reserve) => {
      const projected = allocateConsult(state, reserve);
      return {
        reserve,
        ship: projected.shipped - state.shipped,
        missed: projected.missed - state.missed,
        wasted: projected.wastedReserve - state.wastedReserve,
      };
    }),
  };
}

export function summarizeFocusConsult(state: FocusState) {
  return {
    shipped: state.shipped,
    missed: state.missed,
    penalty: state.penalty,
    wastedReserve: state.wastedReserve,
    waitPeriods: state.waitPeriods,
    score: state.shipped - state.penalty,
    queue: state.queue.length,
    lost: false,
  };
}

export function chooseFocusAction(state: FocusState, strategy: FocusStrategy): FocusInput {
  return { type: 'allocate', reserve: PLANS[strategy][state.tick] ?? 0 };
}

export function compareFocusConsults(seed = 'RI-222') {
  return (['quiet', 'burst', 'steady'] as const).flatMap((board) =>
    (['always', 'short', 'long'] as const).map((strategy) => {
      const initial = createFocusConsult(seed, board);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 10) throw new Error(`${board}:${strategy}`);
        const input = chooseFocusAction(state, strategy);
        const next = applyFocusConsult(state, input);
        if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
        state = next;
      }
      return {
        board,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeFocusConsult(state),
      };
    }),
  );
}

const FACTOR_SEED = 'RI-222';
const BURST_COUNT = BOARDS.burst.arrivals.reduce((sum, count) => sum + count, 0);
const ARRIVAL_TICKS = [0, 1, 2, 3] as const;
const RESOLVE_COSTS = [1, 2, 3, 4, 5, 6, 7] as const;
const SLACKS = [0, 1, 2, 3, 4] as const;
const FACTOR_BOARDS = ['quiet', 'burst', 'steady'] as const;
type FocusFactorAxis = 'arrivalTick' | 'resolveCost' | 'slack';
type FocusPreference = 'focus' | 'consult' | 'tie';
type FocusBandStrategy = 'long' | 'short';
interface FocusFactorRun {
  strategy: FocusBandStrategy;
  inputs: FocusInput[];
  result: ReturnType<typeof summarizeFocusConsult>;
}
interface FocusFactorBoard {
  board: FocusBoard;
  rules: FocusFactorRules;
  sameAsFirstComparison: boolean;
  preference: FocusPreference;
  margin: number;
  focus: FocusFactorRun;
  consult: FocusFactorRun;
}
interface FocusFactorPoint {
  axis: FocusFactorAxis;
  parameter: string;
  boards: FocusFactorBoard[];
}
interface FocusFactorReversal {
  axis: FocusFactorAxis;
  board: FocusBoard;
  before: { parameter: string; preference: FocusPreference; focus: number; consult: number };
  after: { parameter: string; preference: FocusPreference; focus: number; consult: number };
}

function baselineFocusRules(board: FocusBoard): FocusFactorRules {
  const preset = BOARDS[board];
  return { arrivals: [...preset.arrivals], resolveCost: RESOLVE_COST, slack: preset.slack };
}

function burstArrivals(tick: number): number[] {
  return Array.from({ length: HORIZON }, (_, index) => (index === tick ? BURST_COUNT : 0));
}

function rulesMatch(left: FocusFactorRules, right: FocusFactorRules) {
  return (
    left.resolveCost === right.resolveCost &&
    left.slack === right.slack &&
    left.arrivals.length === right.arrivals.length &&
    left.arrivals.every((count, index) => count === right.arrivals[index])
  );
}

function preferenceOf(focusScore: number, consultScore: number): FocusPreference {
  if (focusScore > consultScore) return 'focus';
  if (consultScore > focusScore) return 'consult';
  return 'tie';
}

function runFocusFactor(
  board: FocusBoard,
  strategy: FocusBandStrategy,
  rules: FocusFactorRules,
): FocusFactorRun {
  let state = createFocusConsult(FACTOR_SEED, board);
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 10) throw new Error(`${board}:${strategy}`);
    const input = chooseFocusAction(state, strategy);
    const next = applyFocusConsult(state, input, rules);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { strategy, inputs: state.inputs, result: summarizeFocusConsult(state) };
}

function factorBoard(board: FocusBoard, rules: FocusFactorRules): FocusFactorBoard {
  const focus = runFocusFactor(board, 'long', rules);
  const consult = runFocusFactor(board, 'short', rules);
  return {
    board,
    rules: { arrivals: [...rules.arrivals], resolveCost: rules.resolveCost, slack: rules.slack },
    sameAsFirstComparison: rulesMatch(rules, baselineFocusRules(board)),
    preference: preferenceOf(focus.result.score, consult.result.score),
    margin: focus.result.score - consult.result.score,
    focus,
    consult,
  };
}

function factorPoint(
  axis: FocusFactorAxis,
  parameter: string,
  boards: readonly FocusBoard[],
  rulesFor: (board: FocusBoard) => FocusFactorRules,
): FocusFactorPoint {
  return { axis, parameter, boards: boards.map((board) => factorBoard(board, rulesFor(board))) };
}

function reversalsOf(
  rows: FocusFactorPoint[],
  boards: readonly FocusBoard[],
): FocusFactorReversal[] {
  const found: FocusFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after) continue;
    for (const board of boards) {
      const earlier = before.boards.find((item) => item.board === board);
      const later = after.boards.find((item) => item.board === board);
      if (!earlier || !later || earlier.preference === later.preference) continue;
      found.push({
        axis: before.axis,
        board,
        before: {
          parameter: before.parameter,
          preference: earlier.preference,
          focus: earlier.focus.result.score,
          consult: earlier.consult.result.score,
        },
        after: {
          parameter: after.parameter,
          preference: later.preference,
          focus: later.focus.result.score,
          consult: later.consult.result.score,
        },
      });
    }
  }
  return found;
}

/** 初回と同じ資源で、到着tick・解消費用・期限を一つずつ動かす。固定戦略。 */
export function compareFocusFactorReversals() {
  const sweeps = {
    arrivalTick: ARRIVAL_TICKS.map((tick) =>
      factorPoint('arrivalTick', String(tick), ['burst'], () => ({
        arrivals: burstArrivals(tick),
        resolveCost: RESOLVE_COST,
        slack: BOARDS.burst.slack,
      })),
    ),
    resolveCost: RESOLVE_COSTS.map((resolveCost) =>
      factorPoint('resolveCost', String(resolveCost), FACTOR_BOARDS, (board) => ({
        ...baselineFocusRules(board),
        resolveCost,
      })),
    ),
    slack: SLACKS.map((slack) =>
      factorPoint('slack', String(slack), FACTOR_BOARDS, (board) => ({
        ...baselineFocusRules(board),
        slack,
      })),
    ),
  };
  return {
    conditions: {
      seed: FACTOR_SEED,
      capacity: CAPACITY,
      horizon: HORIZON,
      plans: { focus: [...PLANS.long], consult: [...PLANS.short] },
      boards: {
        quiet: { ...baselineFocusRules('quiet'), penaltyEach: BOARDS.quiet.penaltyEach },
        burst: { ...baselineFocusRules('burst'), penaltyEach: BOARDS.burst.penaltyEach },
        steady: { ...baselineFocusRules('steady'), penaltyEach: BOARDS.steady.penaltyEach },
      },
      decision: {
        focus: '長い集中。枠は0、0、0、6。集中帯を守る',
        consult: '短い集中。枠は0、6、0、6。相談帯を開く',
        score: 'shipped - penalty',
      },
      held: {
        arrivalTick: '集中割り込みの4件を置く期間だけを動かす。解消費用2、期限1、罰5',
        resolveCost: '解消費用だけを動かす。到着、期限、罰は盤面の初回のまま',
        slack: '期限だけを動かす。到着、解消費用、罰は盤面の初回のまま',
      },
      arrivalTickDefinition:
        '0始まりの期間。集中割り込みの4件をその期間に置き、ほかは0。初回は1で、2期目と同じ',
      resolveCostDefinition:
        '相談1件の解消に使う余力。枠をこの数で割った整数件だけその期間に解消する。出荷は枠を引いた余力のまま',
      slackDefinition:
        '期間末の待ちがこの値を超えた件だけ罰を一度引き、取り除く。超えない件は期末でも罰しない',
      steps: {
        arrivalTick: [...ARRIVAL_TICKS],
        resolveCost: [...RESOLVE_COSTS],
        slack: [...SLACKS],
      },
      omitted:
        '常時相談は初回JSONのまま再出力しない。静穏と毎期到着は単一の到着tickを持たないので、到着tickの軸には置かない',
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    },
    sweeps,
    reversals: [
      ...reversalsOf(sweeps.arrivalTick, ['burst']),
      ...reversalsOf(sweeps.resolveCost, FACTOR_BOARDS),
      ...reversalsOf(sweeps.slack, FACTOR_BOARDS),
    ],
  };
}

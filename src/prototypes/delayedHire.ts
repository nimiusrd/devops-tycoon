/** RI-250: 採用決定と入社を分ける。通常の即時採用には接続しない。 */

export type HireBoard = 'boss' | 'next' | 'blocked';
export type HireStrategy = 'hire' | 'tactic';
export type HireInput = { type: 'view' } | { type: 'hire' } | { type: 'tactic' } | { type: 'work' };

export interface HirePeriod {
  tick: number;
  action: HireStrategy | 'work';
  joined: boolean;
  power: number;
  score: number;
}

export interface HireState {
  version: 1;
  seed: string;
  board: HireBoard;
  tick: number;
  horizon: number;
  slots: number;
  strategy: HireStrategy | null;
  worked: number;
  quarterAt: number;
  quarterCrossed: boolean;
  fee: number;
  waiting: number;
  roster: number;
  joined: boolean;
  power: number;
  tacticLeft: number;
  /** 即時施策の持続。未設定の保存は初回の3期間として再生する。 */
  tacticTicks?: number;
  periods: HirePeriod[];
  inputs: HireInput[];
}

const JOIN_AFTER = 2;
const QUARTER_AT = 3;
const HIRE_COST = 6;
const HIRE_POWER = 4;
const TACTIC_COST = 6;
const TACTIC_POWER = 5;
const TACTIC_TICKS = 3;
const EXTENDED_TACTIC_TICKS = 4;
const DURATION_STEPS = [1, 2, 3, 4, 5, 6, 7] as const;

type DurationPreference = 'hire' | 'tactic' | 'tie';

const BOARDS: Record<HireBoard, { workTicks: number; slots: number }> = {
  boss: { workTicks: 3, slots: 1 },
  next: { workTicks: 6, slots: 1 },
  blocked: { workTicks: 6, slots: 0 },
};

function scoreOf(state: HireState): number {
  return state.power - state.fee;
}

function pushPeriod(state: HireState, action: HirePeriod['action']) {
  state.periods.push({
    tick: state.tick,
    action,
    joined: state.joined,
    power: state.power,
    score: scoreOf(state),
  });
  state.tick += 1;
}

export function createDelayedHire(seed: string, board: HireBoard, tacticTicks?: number): HireState {
  const spec = BOARDS[board];
  const state: HireState = {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: spec.workTicks + 1,
    slots: spec.slots,
    strategy: null,
    worked: 0,
    quarterAt: QUARTER_AT,
    quarterCrossed: false,
    fee: 0,
    waiting: 0,
    roster: 0,
    joined: false,
    power: 0,
    tacticLeft: 0,
    ...(tacticTicks !== undefined ? { tacticTicks } : {}),
    periods: [],
    inputs: [],
  };
  return state;
}

export function applyDelayedHire(state: HireState, input: HireInput): HireState {
  if (input.type === 'view') return state;
  if (input.type === 'hire' || input.type === 'tactic') {
    if (state.strategy !== null || state.tick !== 0) return state;
    const next = structuredClone(state);
    next.strategy = input.type;
    next.fee = input.type === 'hire' ? HIRE_COST : TACTIC_COST;
    if (input.type === 'hire') next.waiting = 1;
    else next.tacticLeft = next.tacticTicks ?? TACTIC_TICKS;
    pushPeriod(next, input.type);
    next.inputs.push({ type: input.type });
    return next;
  }
  if (state.strategy === null || state.tick >= state.horizon) return state;
  const next = structuredClone(state);
  if (
    next.strategy === 'hire' &&
    next.waiting === 1 &&
    !next.joined &&
    next.worked >= JOIN_AFTER &&
    next.slots > 0
  ) {
    next.joined = true;
    next.waiting = 0;
    next.roster += 1;
    next.slots -= 1;
  }
  if (next.joined) next.power += HIRE_POWER;
  if (next.strategy === 'tactic' && next.tacticLeft > 0) {
    next.power += TACTIC_POWER;
    next.tacticLeft -= 1;
  }
  next.worked += 1;
  if (next.worked >= next.quarterAt) next.quarterCrossed = true;
  pushPeriod(next, 'work');
  next.inputs.push({ type: 'work' });
  return next;
}

export function summarizeDelayedHire(state: HireState) {
  return {
    score: scoreOf(state),
    fee: state.fee,
    power: state.power,
    waiting: state.waiting,
    roster: state.roster,
    joined: state.joined,
    slots: state.slots,
    quarterCrossed: state.quarterCrossed,
    path: state.periods.map((period) => period.score),
    lost: false,
  };
}

export function chooseDelayedHireAction(state: HireState, strategy: HireStrategy): HireInput {
  if (state.tick >= state.horizon) return { type: 'view' };
  if (state.strategy === null) return { type: strategy };
  return { type: 'work' };
}

function runHire(seed: string, board: HireBoard, strategy: HireStrategy, tacticTicks?: number) {
  const initial =
    tacticTicks === undefined
      ? createDelayedHire(seed, board)
      : createDelayedHire(seed, board, tacticTicks);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 10) throw new Error(`${board}:${strategy}`);
    const input = chooseDelayedHireAction(state, strategy);
    const next = applyDelayedHire(state, input);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { initial, inputs: state.inputs, result: summarizeDelayedHire(state) };
}

export function compareDelayedHires(seed = 'RI-250') {
  return (['boss', 'next', 'blocked'] as const).flatMap((board) =>
    (['hire', 'tactic'] as const).map((strategy) => ({
      board,
      strategy,
      ...runHire(seed, board, strategy),
    })),
  );
}

function preferenceOf(hireScore: number, tacticScore: number): DurationPreference {
  if (hireScore > tacticScore) return 'hire';
  if (tacticScore > hireScore) return 'tactic';
  return 'tie';
}

/**
 * 初回の次期と同じ費用・戦力・入社待ち・空き枠・作業期間の上で、即時施策の持続だけを1期間ずつ動かす。
 * 固定戦略の計算。短期と空き枠0、初回の3盤面表は再実行しない。
 */
export function compareDelayedHireDurations(seed = 'RI-250') {
  const points = DURATION_STEPS.map((tacticTicks) => {
    const runs = (['hire', 'tactic'] as const).map((strategy) => {
      const played = runHire(seed, 'next', strategy, tacticTicks);
      return { strategy, ...played };
    });
    const hire = runs[0];
    const tactic = runs[1];
    if (!hire || !tactic) throw new Error(`tactic ticks ${tacticTicks}`);
    const hireScore = hire.result.score;
    const tacticScore = tactic.result.score;
    const preference = preferenceOf(hireScore, tacticScore);
    return {
      tacticTicks,
      hireScore,
      tacticScore,
      preference,
      hireStillWins: preference === 'hire',
      runs,
    };
  });
  const reversals = [];
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1];
    const after = points[index];
    if (!before || !after || before.preference === after.preference) continue;
    reversals.push({
      before: {
        tacticTicks: before.tacticTicks,
        preference: before.preference,
        hireScore: before.hireScore,
        tacticScore: before.tacticScore,
      },
      after: {
        tacticTicks: after.tacticTicks,
        preference: after.preference,
        hireScore: after.hireScore,
        tacticScore: after.tacticScore,
      },
      strict: before.preference !== 'tie' && after.preference !== 'tie',
    });
  }
  const extended = points.find((point) => point.tacticTicks === EXTENDED_TACTIC_TICKS);
  if (!extended) throw new Error('tactic ticks 4');
  return {
    conditions: {
      seed,
      board: 'next' as const,
      excludedBoards: ['boss', 'blocked'] as const,
      workTicks: BOARDS.next.workTicks,
      slots: BOARDS.next.slots,
      horizon: BOARDS.next.workTicks + 1,
      fee: HIRE_COST,
      hirePower: HIRE_POWER,
      tacticPower: TACTIC_POWER,
      joinAfterTicks: JOIN_AFTER,
      quarterAt: QUARTER_AT,
      baselineTacticTicks: TACTIC_TICKS,
      extendedTacticTicks: EXTENDED_TACTIC_TICKS,
      durations: [...DURATION_STEPS],
      held: '費用、両戦力、入社までの作業、四半期、空き枠、作業期間は初回の次期と同じ。動かすのは即時施策の持続だけ。',
      score: 'power - fee',
      repeatedFirstComparison: false,
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      productionIntegration: false,
    },
    extended: {
      tacticTicks: EXTENDED_TACTIC_TICKS,
      hireScore: extended.hireScore,
      tacticScore: extended.tacticScore,
      preference: extended.preference,
      hireStillWins: extended.hireStillWins,
    },
    points,
    reversals,
  };
}

function preview(state: HireState, strategy: HireStrategy) {
  let cursor = structuredClone(state);
  let guard = 0;
  while (cursor.tick < cursor.horizon) {
    if (++guard > 10) break;
    const next = applyDelayedHire(cursor, chooseDelayedHireAction(cursor, strategy));
    if (next === cursor) break;
    cursor = next;
  }
  const summary = summarizeDelayedHire(cursor);
  return {
    strategy,
    score: summary.score,
    power: summary.power,
    waiting: summary.waiting,
    roster: summary.roster,
  };
}

export function viewDelayedHire(state: HireState) {
  return {
    tick: state.tick,
    board: state.board,
    reason: 'delayed-hire',
    fee: HIRE_COST,
    tacticFee: TACTIC_COST,
    feePaidAt: 'decision' as const,
    joinAfterTicks: JOIN_AFTER,
    hirePower: HIRE_POWER,
    tacticPower: TACTIC_POWER,
    tacticTicks: state.tacticTicks ?? TACTIC_TICKS,
    slots: state.slots,
    waiting: state.waiting,
    quarterAt: state.quarterAt,
    slotRule: 'wait-without-power',
    hireHelpsWhen: 'joins-before-horizon',
    tacticHelpsWhen: 'short-or-no-slot',
    strategy: state.strategy,
    choices: state.strategy === null ? (['hire', 'tactic'] as const) : [],
    forecasts:
      state.strategy === null
        ? (['hire', 'tactic'] as const).map((strategy) => preview(state, strategy))
        : [],
  };
}

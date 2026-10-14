/** RI-251: 継続できる未達だけを次期の宿題にする。通常の勝敗には接続しない。 */

export type HomeworkBoard = 'lasting' | 'exposed';
export type HomeworkStrategy = 'homework' | 'goal';
export type HomeworkInput =
  { type: 'view' } | { type: 'homework' } | { type: 'goal' } | { type: 'work' };

export interface HomeworkPeriod {
  tick: number;
  action: HomeworkStrategy | 'work';
  homeworkLeft: number;
  delivered: number;
  score: number;
}

export interface HomeworkState {
  version: 1;
  seed: string;
  board: HomeworkBoard;
  tick: number;
  horizon: number;
  capacity: number;
  reason: 'evidence-short';
  continuable: true;
  strategy: HomeworkStrategy | null;
  worked: number;
  goalWindow: number;
  penaltyRate: number;
  homeworkTotal: number;
  homeworkLeft: number;
  goalTotal: number;
  goalLeft: number;
  goalValue: number;
  delivered: number;
  penalty: number;
  resolved: boolean;
  goalMissed: boolean;
  sourceFailures: number;
  periods: HomeworkPeriod[];
  inputs: HomeworkInput[];
}

const CAPACITY = 4;
const HOMEWORK_TOTAL = 4;
const GOAL_TOTAL = 4;
const GOAL_VALUE = 14;

const BOARDS: Record<
  HomeworkBoard,
  { workTicks: number; goalWindow: number; penaltyRate: number }
> = {
  lasting: { workTicks: 3, goalWindow: 3, penaltyRate: 5 },
  exposed: { workTicks: 1, goalWindow: 1, penaltyRate: 3 },
};

function scoreOf(state: HomeworkState): number {
  return state.delivered - state.penalty;
}

function pushPeriod(state: HomeworkState, action: HomeworkPeriod['action']) {
  state.periods.push({
    tick: state.tick,
    action,
    homeworkLeft: state.homeworkLeft,
    delivered: state.delivered,
    score: scoreOf(state),
  });
  state.tick += 1;
}

export function createBossHomework(seed: string, board: HomeworkBoard): HomeworkState {
  const spec = BOARDS[board];
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: spec.workTicks + 1,
    capacity: CAPACITY,
    reason: 'evidence-short',
    continuable: true,
    strategy: null,
    worked: 0,
    goalWindow: spec.goalWindow,
    penaltyRate: spec.penaltyRate,
    homeworkTotal: HOMEWORK_TOTAL,
    homeworkLeft: HOMEWORK_TOTAL,
    goalTotal: GOAL_TOTAL,
    goalLeft: GOAL_TOTAL,
    goalValue: GOAL_VALUE,
    delivered: 0,
    penalty: 0,
    resolved: false,
    goalMissed: false,
    sourceFailures: 1,
    periods: [],
    inputs: [],
  };
}

function spendHomework(state: HomeworkState, room: number): number {
  const used = Math.min(room, state.homeworkLeft);
  state.homeworkLeft -= used;
  if (used > 0 && state.homeworkLeft === 0) state.resolved = true;
  return room - used;
}

function spendGoal(state: HomeworkState, room: number): number {
  if (state.worked >= state.goalWindow || state.goalLeft === 0) return room;
  const used = Math.min(room, state.goalLeft);
  state.goalLeft -= used;
  if (state.goalLeft === 0) state.delivered += state.goalValue;
  return room - used;
}

export function applyBossHomework(state: HomeworkState, input: HomeworkInput): HomeworkState {
  if (input.type === 'view') return state;
  if (input.type === 'homework' || input.type === 'goal') {
    if (state.strategy !== null || state.tick !== 0) return state;
    const next = structuredClone(state);
    next.strategy = input.type;
    pushPeriod(next, input.type);
    next.inputs.push({ type: input.type });
    return next;
  }
  if (state.strategy === null || state.tick >= state.horizon) return state;
  const next = structuredClone(state);
  let room = next.capacity;
  if (next.strategy === 'homework') {
    room = spendHomework(next, room);
    spendGoal(next, room);
  } else {
    room = spendGoal(next, room);
    spendHomework(next, room);
  }
  if (next.homeworkLeft > 0) next.penalty += next.penaltyRate;
  next.worked += 1;
  if (next.goalLeft > 0 && next.worked >= next.goalWindow) next.goalMissed = true;
  pushPeriod(next, 'work');
  next.inputs.push({ type: 'work' });
  return next;
}

export function summarizeBossHomework(state: HomeworkState) {
  return {
    score: scoreOf(state),
    delivered: state.delivered,
    penalty: state.penalty,
    residual: state.homeworkLeft * state.penaltyRate,
    homeworkLeft: state.homeworkLeft,
    resolved: state.resolved,
    goalMissed: state.goalMissed,
    sourceFailures: state.sourceFailures,
    path: state.periods.map((period) => period.score),
    lost: false,
  };
}

export function chooseBossHomeworkAction(
  state: HomeworkState,
  strategy: HomeworkStrategy,
): HomeworkInput {
  if (state.tick >= state.horizon) return { type: 'view' };
  if (state.strategy === null) return { type: strategy };
  return { type: 'work' };
}

function runHomework(seed: string, board: HomeworkBoard, strategy: HomeworkStrategy) {
  const initial = createBossHomework(seed, board);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 8) throw new Error(`${board}:${strategy}`);
    const input = chooseBossHomeworkAction(state, strategy);
    const next = applyBossHomework(state, input);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { initial, inputs: state.inputs, result: summarizeBossHomework(state) };
}

export function compareBossHomework(seed = 'RI-251') {
  return (['lasting', 'exposed'] as const).flatMap((board) =>
    (['homework', 'goal'] as const).map((strategy) => ({
      board,
      strategy,
      ...runHomework(seed, board, strategy),
    })),
  );
}

function preview(state: HomeworkState, strategy: HomeworkStrategy) {
  let cursor = structuredClone(state);
  let guard = 0;
  while (cursor.tick < cursor.horizon) {
    if (++guard > 8) break;
    const next = applyBossHomework(cursor, chooseBossHomeworkAction(cursor, strategy));
    if (next === cursor) break;
    cursor = next;
  }
  const summary = summarizeBossHomework(cursor);
  return {
    strategy,
    score: summary.score,
    delivered: summary.delivered,
    penalty: summary.penalty,
    residual: summary.residual,
    resolved: summary.resolved,
  };
}

export function viewBossHomework(state: HomeworkState) {
  return {
    tick: state.tick,
    board: state.board,
    reason: state.reason,
    continuable: state.continuable,
    endedRunsContinued: false,
    homeworkLeft: state.homeworkLeft,
    homeworkTotal: state.homeworkTotal,
    goalWindow: state.goalWindow,
    goalValue: state.goalValue,
    penaltyRate: state.penaltyRate,
    sourceFailures: state.sourceFailures,
    resolution: 'finish-evidence',
    homeworkHelpsWhen: 'goal-stays-open',
    goalHelpsWhen: 'goal-expires-now',
    strategy: state.strategy,
    choices: state.strategy === null ? (['homework', 'goal'] as const) : [],
    forecasts:
      state.strategy === null
        ? (['homework', 'goal'] as const).map((strategy) => preview(state, strategy))
        : [],
  };
}

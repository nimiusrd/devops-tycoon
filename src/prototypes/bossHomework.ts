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

const RESIDUAL_SCORE_VALUES = [8, 9, 10, 11, 12, 13, 14, 15, 16] as const;

function preferenceOf(homeworkScore: number, goalScore: number) {
  if (homeworkScore === goalScore) return 'tie' as const;
  return homeworkScore > goalScore ? ('homework' as const) : ('goal' as const);
}

function chargeResidual(homeworkLeft: number, residualAtFull: number, fullEvidence: number) {
  if (homeworkLeft === 0 || fullEvidence === 0) return 0;
  const charged = (homeworkLeft * residualAtFull) / fullEvidence;
  if (!Number.isInteger(charged)) throw new Error(`residual ${residualAtFull}`);
  return charged;
}

function scoredResidual(
  result: ReturnType<typeof summarizeBossHomework>,
  residualAtFull: number,
  fullEvidence: number,
) {
  const residual = chargeResidual(result.homeworkLeft, residualAtFull, fullEvidence);
  return {
    delivered: result.delivered,
    penalty: result.penalty,
    score: result.score,
    homeworkLeft: result.homeworkLeft,
    residual,
    included: result.score - residual,
    resolved: result.resolved,
    goalMissed: result.goalMissed,
    sourceFailures: result.sourceFailures,
    path: result.path,
    lost: result.lost,
  };
}

/**
 * 初回の今期限り盤面だけを使い、残リスクを期末の得点から一度引く。
 * 固定戦略の再計算であり、人間のプレイ評価ではない。初回の2盤面は再計算しない。
 */
export function compareBossHomeworkResidual(seed = 'RI-251') {
  const homework = runHomework(seed, 'exposed', 'homework');
  const goal = runHomework(seed, 'exposed', 'goal');
  const fullEvidence = goal.initial.homeworkTotal;
  const recordedResidual = goal.result.residual;
  const rows = RESIDUAL_SCORE_VALUES.map((residual) => {
    const homeworkScore = scoredResidual(homework.result, residual, fullEvidence);
    const goalScore = scoredResidual(goal.result, residual, fullEvidence);
    return {
      residual,
      homework: homeworkScore,
      goal: goalScore,
      preference: preferenceOf(homeworkScore.included, goalScore.included),
    };
  });
  const recorded = rows.find((row) => row.residual === recordedResidual);
  if (!recorded) throw new Error(`recorded residual ${recordedResidual} is outside the sweep`);
  const goalRows = rows.filter((row) => row.preference === 'goal');
  const homeworkRows = rows.filter((row) => row.preference === 'homework');
  return {
    conditions: {
      seed,
      board: 'exposed' as const,
      capacity: goal.initial.capacity,
      homeworkTotal: goal.initial.homeworkTotal,
      goalTotal: goal.initial.goalTotal,
      goalValue: goal.initial.goalValue,
      goalWindow: goal.initial.goalWindow,
      penaltyRate: goal.initial.penaltyRate,
      horizon: goal.initial.horizon,
      score: 'delivered - penalty - residual',
      residualRule:
        '未解消の残証拠に、残証拠×(指定残リスク÷初回の証拠4)を引く。解消済みは0。期間ペナルティは初回のまま',
      residualValues: [...RESIDUAL_SCORE_VALUES],
      recordedResidual,
      fixedStrategies: true,
      humanPlaytest: false,
      repeatedFirstComparison: false,
      productionIntegration: false,
      provesBossContinuation: false,
    },
    runs: {
      homework: { initial: homework.initial, inputs: homework.inputs, base: homework.result },
      goal: { initial: goal.initial, inputs: goal.inputs, base: goal.result },
    },
    rows,
    reversal: {
      goalExceedsThrough: goalRows.length ? Math.max(...goalRows.map((row) => row.residual)) : null,
      tieAt: rows.filter((row) => row.preference === 'tie').map((row) => row.residual),
      homeworkExceedsFrom: homeworkRows.length
        ? Math.min(...homeworkRows.map((row) => row.residual))
        : null,
      recordedResidual,
      recordedPreference: recorded.preference,
    },
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

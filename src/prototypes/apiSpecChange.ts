/** RI-247: 架空APIの仕様変更。通常ランのイベントや外部サービスには接続しない。 */

export type ApiBoard = 'narrow-long' | 'wide-long' | 'wide-short';
export type ApiStrategy = 'follow' | 'replace' | 'stop';
export type ApiInput =
  { type: 'view' } | { type: 'follow' } | { type: 'replace' } | { type: 'stop' } | { type: 'work' };

export interface ApiPeriod {
  tick: number;
  action: ApiStrategy | 'work';
  migrationCleared: number;
  unrelatedCleared: number;
  score: number;
}

export interface ApiState {
  version: 1;
  seed: string;
  board: ApiBoard;
  tick: number;
  horizon: number;
  capacity: number;
  domain: 'billing';
  unrelatedDomain: 'other';
  followWork: number;
  replaceWork: number;
  followResidual: number;
  featureValue: number;
  brokenResidual: number;
  strategy: ApiStrategy | null;
  migrationLeft: number;
  migrationDone: number;
  featurePaid: boolean;
  residual: number;
  unrelatedTotal: number;
  unrelatedLeft: number;
  unrelatedDone: number;
  unrelatedValue: number;
  periods: ApiPeriod[];
  inputs: ApiInput[];
}

const CAPACITY = 4;
const UNRELATED_TOTAL = 6;
const UNRELATED_VALUE = 4;
const FEATURE_VALUE = 16;
const BROKEN_RESIDUAL = 8;

const BOARDS: Record<
  ApiBoard,
  { workTicks: number; followWork: number; replaceWork: number; followResidual: number }
> = {
  'narrow-long': { workTicks: 3, followWork: 4, replaceWork: 8, followResidual: 2 },
  'wide-long': { workTicks: 4, followWork: 8, replaceWork: 12, followResidual: 14 },
  'wide-short': { workTicks: 2, followWork: 8, replaceWork: 12, followResidual: 14 },
};

function scoreOf(state: ApiState): number {
  const feature = state.featurePaid ? state.featureValue : 0;
  return state.unrelatedDone * state.unrelatedValue + feature - state.residual;
}

function pushPeriod(
  state: ApiState,
  action: ApiPeriod['action'],
  migrationCleared: number,
  unrelatedCleared: number,
) {
  state.periods.push({
    tick: state.tick,
    action,
    migrationCleared,
    unrelatedCleared,
    score: scoreOf(state),
  });
  state.tick += 1;
}

export function createApiSpecChange(seed: string, board: ApiBoard): ApiState {
  const spec = BOARDS[board];
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: spec.workTicks + 1,
    capacity: CAPACITY,
    domain: 'billing',
    unrelatedDomain: 'other',
    followWork: spec.followWork,
    replaceWork: spec.replaceWork,
    followResidual: spec.followResidual,
    featureValue: FEATURE_VALUE,
    brokenResidual: BROKEN_RESIDUAL,
    strategy: null,
    migrationLeft: 0,
    migrationDone: 0,
    featurePaid: false,
    residual: 0,
    unrelatedTotal: UNRELATED_TOTAL,
    unrelatedLeft: UNRELATED_TOTAL,
    unrelatedDone: 0,
    unrelatedValue: UNRELATED_VALUE,
    periods: [],
    inputs: [],
  };
}

export function applyApiSpecChange(state: ApiState, input: ApiInput): ApiState {
  if (input.type === 'view') return state;
  if (input.type === 'follow' || input.type === 'replace' || input.type === 'stop') {
    if (state.strategy !== null || state.tick !== 0) return state;
    const next = structuredClone(state);
    next.strategy = input.type;
    next.migrationLeft =
      input.type === 'follow' ? next.followWork : input.type === 'replace' ? next.replaceWork : 0;
    pushPeriod(next, input.type, 0, 0);
    next.inputs.push({ type: input.type });
    return next;
  }
  if (state.strategy === null || state.tick >= state.horizon) return state;
  const next = structuredClone(state);
  let room = next.capacity;
  let migrationCleared = 0;
  if (next.strategy !== 'stop' && next.migrationLeft > 0) {
    migrationCleared = Math.min(room, next.migrationLeft);
    next.migrationLeft -= migrationCleared;
    next.migrationDone += migrationCleared;
    room -= migrationCleared;
    if (next.migrationLeft === 0 && !next.featurePaid) {
      next.featurePaid = true;
      next.residual = next.strategy === 'follow' ? next.followResidual : 0;
    }
  }
  const unrelatedCleared = Math.min(room, next.unrelatedLeft);
  next.unrelatedLeft -= unrelatedCleared;
  next.unrelatedDone += unrelatedCleared;
  if (next.tick + 1 >= next.horizon && next.strategy !== 'stop' && next.migrationLeft > 0) {
    next.residual = next.brokenResidual;
  }
  pushPeriod(next, 'work', migrationCleared, unrelatedCleared);
  next.inputs.push({ type: 'work' });
  return next;
}

export function summarizeApiSpecChange(state: ApiState) {
  return {
    score: scoreOf(state),
    unrelatedDone: state.unrelatedDone,
    unrelatedLeft: state.unrelatedLeft,
    unrelatedValue: state.unrelatedValue,
    featurePaid: state.featurePaid,
    residual: state.residual,
    migrationLeft: state.migrationLeft,
    strategy: state.strategy,
    path: state.periods.map((period) => period.score),
    lost: false,
  };
}

export function chooseApiSpecAction(state: ApiState, strategy: ApiStrategy): ApiInput {
  if (state.tick >= state.horizon) return { type: 'view' };
  if (state.strategy === null) return { type: strategy };
  return { type: 'work' };
}

function runApi(seed: string, board: ApiBoard, strategy: ApiStrategy) {
  const initial = createApiSpecChange(seed, board);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 8) throw new Error(`${board}:${strategy}`);
    const input = chooseApiSpecAction(state, strategy);
    const next = applyApiSpecChange(state, input);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { initial, inputs: state.inputs, result: summarizeApiSpecChange(state) };
}

export function compareApiSpecChanges(seed = 'RI-247') {
  return (['narrow-long', 'wide-long', 'wide-short'] as const).flatMap((board) =>
    (['follow', 'replace', 'stop'] as const).map((strategy) => ({
      board,
      strategy,
      ...runApi(seed, board, strategy),
    })),
  );
}

function preview(state: ApiState, strategy: ApiStrategy) {
  let cursor = structuredClone(state);
  let guard = 0;
  while (cursor.tick < cursor.horizon) {
    if (++guard > 8) break;
    const next = applyApiSpecChange(cursor, chooseApiSpecAction(cursor, strategy));
    if (next === cursor) break;
    cursor = next;
  }
  const summary = summarizeApiSpecChange(cursor);
  return {
    strategy,
    score: summary.score,
    featurePaid: summary.featurePaid,
    residual: summary.residual,
    unrelatedDone: summary.unrelatedDone,
  };
}

export function viewApiSpecChange(state: ApiState) {
  return {
    tick: state.tick,
    board: state.board,
    domain: state.domain,
    unrelatedDomain: state.unrelatedDomain,
    deadlineTicks: state.horizon - 1,
    capacity: state.capacity,
    reason: 'api-spec-change',
    followHelpsWhen: 'narrow-and-time',
    replaceHelpsWhen: 'wide-and-time',
    stopHelpsWhen: 'wide-and-short',
    followWork: state.followWork,
    replaceWork: state.replaceWork,
    featureValue: state.featureValue,
    followResidual: state.followResidual,
    brokenResidual: state.brokenResidual,
    unrelated: {
      left: state.unrelatedLeft,
      total: state.unrelatedTotal,
      valuePer: state.unrelatedValue,
    },
    strategy: state.strategy,
    choices: state.strategy === null ? (['follow', 'replace', 'stop'] as const) : [],
    forecasts:
      state.strategy === null
        ? (['follow', 'replace', 'stop'] as const).map((strategy) => preview(state, strategy))
        : [],
  };
}

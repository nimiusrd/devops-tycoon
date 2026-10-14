/** RI-248: 認識違いは予告済みの仮定から起きる。通常のReworkには接続しない。 */

export type SpecBoard = 'open' | 'mid' | 'tight';
export type SpecStrategy = 'check' | 'rebuild' | 'explain' | 'narrow';
export type SpecInput =
  | { type: 'view' }
  | { type: 'check' }
  | { type: 'rebuild' }
  | { type: 'explain' }
  | { type: 'narrow' }
  | { type: 'work' };

export type SpecScope = 'full' | 'negotiated' | 'narrow';

interface SpecStep {
  kind: 'check' | 'assume' | 'build' | 'rebuild' | 'explain' | 'narrow';
  work: number;
  value: number;
  scope: SpecScope | null;
}

export interface SpecPeriod {
  tick: number;
  action: SpecStrategy | 'work';
  cleared: number;
  score: number;
}

export interface SpecState {
  version: 1;
  seed: string;
  board: SpecBoard;
  tick: number;
  horizon: number;
  capacity: number;
  target: 'checkout-flow';
  sign: 'unconfirmed-assumption';
  strategy: SpecStrategy | null;
  steps: SpecStep[];
  stepIndex: number;
  stepLeft: number;
  checked: boolean;
  mismatchFound: boolean;
  agreement: boolean;
  scope: SpecScope | null;
  sunk: number;
  delivered: number;
  periods: SpecPeriod[];
  inputs: SpecInput[];
}

const CAPACITY = 1;
const CHECK_WORK = 2;
const ASSUMED_WORK = 4;
const REBUILD_WORK = 6;
const EXPLAIN_WORK = 2;
const NARROW_WORK = 1;
const FULL_VALUE = 18;
const NEGOTIATED_VALUE = 12;
const NARROW_VALUE = 7;

const WORK_TICKS: Record<SpecBoard, number> = { open: 8, mid: 6, tight: 5 };

function plan(strategy: SpecStrategy): SpecStep[] {
  switch (strategy) {
    case 'check':
      return [
        { kind: 'check', work: CHECK_WORK, value: 0, scope: null },
        { kind: 'build', work: REBUILD_WORK, value: FULL_VALUE, scope: 'full' },
      ];
    case 'rebuild':
      return [
        { kind: 'assume', work: ASSUMED_WORK, value: 0, scope: null },
        { kind: 'rebuild', work: REBUILD_WORK, value: FULL_VALUE, scope: 'full' },
      ];
    case 'explain':
      return [
        { kind: 'assume', work: ASSUMED_WORK, value: 0, scope: null },
        { kind: 'explain', work: EXPLAIN_WORK, value: NEGOTIATED_VALUE, scope: 'negotiated' },
      ];
    case 'narrow':
      return [
        { kind: 'assume', work: ASSUMED_WORK, value: 0, scope: null },
        { kind: 'narrow', work: NARROW_WORK, value: NARROW_VALUE, scope: 'narrow' },
      ];
  }
}

function scoreOf(state: SpecState): number {
  return state.delivered;
}

function pushPeriod(state: SpecState, action: SpecPeriod['action'], cleared: number) {
  state.periods.push({ tick: state.tick, action, cleared, score: scoreOf(state) });
  state.tick += 1;
}

export function createSpecMismatch(seed: string, board: SpecBoard): SpecState {
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: WORK_TICKS[board] + 1,
    capacity: CAPACITY,
    target: 'checkout-flow',
    sign: 'unconfirmed-assumption',
    strategy: null,
    steps: [],
    stepIndex: 0,
    stepLeft: 0,
    checked: false,
    mismatchFound: false,
    agreement: false,
    scope: null,
    sunk: 0,
    delivered: 0,
    periods: [],
    inputs: [],
  };
}

function finishStep(state: SpecState, step: SpecStep) {
  if (step.kind === 'check') state.checked = true;
  if (step.kind === 'assume') state.mismatchFound = true;
  if (step.value > 0 && state.delivered === 0) {
    state.delivered = step.value;
    state.scope = step.scope;
    if (step.kind === 'explain') state.agreement = true;
  }
  state.stepIndex += 1;
  const next = state.steps[state.stepIndex];
  state.stepLeft = next ? next.work : 0;
}

export function applySpecMismatch(state: SpecState, input: SpecInput): SpecState {
  if (input.type === 'view') return state;
  if (
    input.type === 'check' ||
    input.type === 'rebuild' ||
    input.type === 'explain' ||
    input.type === 'narrow'
  ) {
    if (state.strategy !== null || state.tick !== 0) return state;
    const next = structuredClone(state);
    next.strategy = input.type;
    next.steps = plan(input.type);
    next.stepLeft = next.steps[0]?.work ?? 0;
    pushPeriod(next, input.type, 0);
    next.inputs.push({ type: input.type });
    return next;
  }
  if (state.strategy === null || state.tick >= state.horizon) return state;
  const next = structuredClone(state);
  let room = next.capacity;
  let cleared = 0;
  while (room > 0 && next.stepIndex < next.steps.length) {
    const step = next.steps[next.stepIndex]!;
    const used = Math.min(room, next.stepLeft);
    next.stepLeft -= used;
    room -= used;
    cleared += used;
    if (step.kind === 'assume') next.sunk += used;
    if (next.stepLeft === 0) finishStep(next, step);
  }
  pushPeriod(next, 'work', cleared);
  next.inputs.push({ type: 'work' });
  return next;
}

export function summarizeSpecMismatch(state: SpecState) {
  const current = state.steps[state.stepIndex];
  return {
    score: scoreOf(state),
    delivered: state.delivered,
    scope: state.scope,
    checked: state.checked,
    mismatchFound: state.mismatchFound,
    agreement: state.agreement,
    sunk: state.sunk,
    remaining: current ? state.stepLeft : 0,
    path: state.periods.map((period) => period.score),
    lost: false,
  };
}

export function chooseSpecMismatchAction(state: SpecState, strategy: SpecStrategy): SpecInput {
  if (state.tick >= state.horizon) return { type: 'view' };
  if (state.strategy === null) return { type: strategy };
  return { type: 'work' };
}

function runSpec(seed: string, board: SpecBoard, strategy: SpecStrategy) {
  const initial = createSpecMismatch(seed, board);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 12) throw new Error(`${board}:${strategy}`);
    const input = chooseSpecMismatchAction(state, strategy);
    const next = applySpecMismatch(state, input);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { initial, inputs: state.inputs, result: summarizeSpecMismatch(state) };
}

export function compareSpecMismatches(seed = 'RI-248') {
  return (['open', 'mid', 'tight'] as const).flatMap((board) =>
    (['check', 'rebuild', 'explain', 'narrow'] as const).map((strategy) => ({
      board,
      strategy,
      ...runSpec(seed, board, strategy),
    })),
  );
}

function preview(state: SpecState, strategy: SpecStrategy) {
  let cursor = structuredClone(state);
  let guard = 0;
  while (cursor.tick < cursor.horizon) {
    if (++guard > 12) break;
    const next = applySpecMismatch(cursor, chooseSpecMismatchAction(cursor, strategy));
    if (next === cursor) break;
    cursor = next;
  }
  const summary = summarizeSpecMismatch(cursor);
  return {
    strategy,
    score: summary.score,
    scope: summary.scope,
    checked: summary.checked,
    mismatchFound: summary.mismatchFound,
    agreement: summary.agreement,
  };
}

export function viewSpecMismatch(state: SpecState) {
  return {
    tick: state.tick,
    board: state.board,
    target: state.target,
    sign: state.sign,
    signKnownBefore: true,
    reason: 'spec-mismatch',
    capacity: state.capacity,
    deadlineTicks: state.horizon - 1,
    checkWork: CHECK_WORK,
    mismatchAfter: ASSUMED_WORK,
    checkHelpsWhen: 'deadline-8',
    explainHelpsWhen: 'deadline-6',
    narrowHelpsWhen: 'deadline-5',
    responses: {
      rebuild: { work: REBUILD_WORK, value: FULL_VALUE },
      explain: { work: EXPLAIN_WORK, value: NEGOTIATED_VALUE },
      narrow: { work: NARROW_WORK, value: NARROW_VALUE },
    },
    strategy: state.strategy,
    choices: state.strategy === null ? (['check', 'rebuild', 'explain', 'narrow'] as const) : [],
    forecasts:
      state.strategy === null
        ? (['check', 'rebuild', 'explain', 'narrow'] as const).map((strategy) =>
            preview(state, strategy),
          )
        : [],
  };
}

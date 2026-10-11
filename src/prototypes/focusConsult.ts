/** RI-222: 集中帯と相談帯をゲーム内期間へ割り当てる。実時間の待ちは持たない。 */

export type FocusBoard = 'quiet' | 'burst' | 'steady';
export type FocusStrategy = 'always' | 'short' | 'long';
export type ConsultReserve = 0 | 2 | 6;
export type FocusInput = { type: 'allocate'; reserve: ConsultReserve } | { type: 'view' };

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
export function allocateConsult(state: FocusState, reserve: number): FocusState {
  if (state.tick >= state.horizon || !isReserve(reserve)) return state;
  const next = structuredClone(state);
  const arrivals = BOARDS[next.board].arrivals[next.tick] ?? 0;
  for (let index = 0; index < arrivals; index += 1) {
    next.queue.push({ id: next.nextId, wait: 0 });
    next.nextId += 1;
  }
  const resolved = Math.min(next.queue.length, Math.floor(reserve / next.resolveCost));
  next.queue.splice(0, resolved);
  next.wastedReserve += reserve - resolved * next.resolveCost;
  next.shipped += next.capacity - reserve;
  const kept: ConsultQuestion[] = [];
  for (const question of next.queue) {
    question.wait += 1;
    next.waitPeriods += 1;
    if (question.wait > next.slack) {
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

export function applyFocusConsult(state: FocusState, input: FocusInput): FocusState {
  if (input.type === 'view') return state;
  if (input.type !== 'allocate') return state;
  return allocateConsult(state, input.reserve);
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

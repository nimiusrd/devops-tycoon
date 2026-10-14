/** RI-255: 経営レビューの相反する要求を追従か一回の交渉で比べる。通常ランには接続しない。 */

export type DemandBoard = 'compatible' | 'contradict';
export type DemandStrategy = 'follow' | 'negotiate';
export type DemandOutcome = 'both' | 'ai-only' | 'review-only' | 'neither';
export type DemandInput =
  { type: 'view' } | { type: 'follow' } | { type: 'negotiate' } | { type: 'work' };

export interface DemandPeriod {
  tick: number;
  action: DemandStrategy | 'work';
  ai: number;
  queue: number;
  trustSpent: number;
  score: number;
}

export interface DemandState {
  version: 1;
  seed: string;
  board: DemandBoard;
  tick: number;
  horizon: number;
  capacity: number;
  aiNeed: number;
  aiDeadline: number;
  aiValue: number;
  statedCap: number;
  reviewCap: number;
  relaxedCap: number;
  reviewDeadline: number;
  reviewValue: number;
  trustCost: number;
  reviewPerAi: number;
  strategy: DemandStrategy | null;
  negotiated: boolean;
  ai: number;
  queue: number;
  aiAward: number;
  reviewAward: number;
  trustSpent: number;
  nextPromise: number;
  existingReviewCharged: false;
  periods: DemandPeriod[];
  inputs: DemandInput[];
}

const CAPACITY = 3;
const AI_NEED = 6;
const AI_DEADLINE = 2;
const AI_VALUE = 12;
const STATED_CAP = 1;
const RELAXED_CAP = 6;
const REVIEW_DEADLINE = 3;
const REVIEW_VALUE = 12;
const TRUST_COST = 8;
const WORK_TICKS = 3;

const BOARDS: Record<DemandBoard, { reviewPerAi: number }> = {
  compatible: { reviewPerAi: 0 },
  contradict: { reviewPerAi: 1 },
};

function scoreOf(state: DemandState): number {
  return state.aiAward + state.reviewAward - state.trustSpent;
}

function outcomeOf(state: DemandState): DemandOutcome {
  const ai = state.aiAward > 0;
  const review = state.reviewAward > 0;
  if (ai && review) return 'both';
  if (ai) return 'ai-only';
  if (review) return 'review-only';
  return 'neither';
}

function pushPeriod(state: DemandState, action: DemandPeriod['action']) {
  state.periods.push({
    tick: state.tick,
    action,
    ai: state.ai,
    queue: state.queue,
    trustSpent: state.trustSpent,
    score: scoreOf(state),
  });
  state.tick += 1;
}

export function createExecDemands(seed: string, board: DemandBoard): DemandState {
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: WORK_TICKS + 1,
    capacity: CAPACITY,
    aiNeed: AI_NEED,
    aiDeadline: AI_DEADLINE,
    aiValue: AI_VALUE,
    statedCap: STATED_CAP,
    reviewCap: STATED_CAP,
    relaxedCap: RELAXED_CAP,
    reviewDeadline: REVIEW_DEADLINE,
    reviewValue: REVIEW_VALUE,
    trustCost: TRUST_COST,
    reviewPerAi: BOARDS[board].reviewPerAi,
    strategy: null,
    negotiated: false,
    ai: 0,
    queue: 0,
    aiAward: 0,
    reviewAward: 0,
    trustSpent: 0,
    nextPromise: 0,
    existingReviewCharged: false,
    periods: [],
    inputs: [],
  };
}

export function applyExecDemands(state: DemandState, input: DemandInput): DemandState {
  if (input.type === 'view') return state;
  if (input.type === 'follow' || input.type === 'negotiate') {
    if (state.strategy !== null || state.tick !== 0) return state;
    const next = structuredClone(state);
    next.strategy = input.type;
    if (input.type === 'negotiate') {
      next.negotiated = true;
      next.trustSpent = next.trustCost;
      next.reviewCap = next.relaxedCap;
    }
    pushPeriod(next, input.type);
    next.inputs.push({ type: input.type });
    return next;
  }
  if (state.strategy === null || state.tick >= state.horizon || input.type !== 'work') return state;
  const next = structuredClone(state);
  if (next.ai < next.aiNeed && next.tick <= next.aiDeadline) {
    next.ai += next.capacity;
    next.queue += next.capacity * next.reviewPerAi;
    if (next.ai >= next.aiNeed) next.aiAward = next.aiValue;
  } else {
    next.queue = Math.max(0, next.queue - next.capacity);
  }
  if (next.tick === next.reviewDeadline && next.queue <= next.reviewCap) {
    next.reviewAward = next.reviewValue;
  }
  if (next.negotiated && next.tick === next.reviewDeadline) next.nextPromise = next.queue;
  pushPeriod(next, 'work');
  next.inputs.push({ type: 'work' });
  return next;
}

export function summarizeExecDemands(state: DemandState) {
  return {
    score: scoreOf(state),
    aiAward: state.aiAward,
    reviewAward: state.reviewAward,
    trustSpent: state.trustSpent,
    nextPromise: state.nextPromise,
    ai: state.ai,
    queue: state.queue,
    outcome: outcomeOf(state),
    negotiated: state.negotiated,
    existingReviewCharged: state.existingReviewCharged,
    path: state.periods.map((period) => period.score),
    lost: false,
    continued: true,
  };
}

export function chooseExecDemandAction(state: DemandState, strategy: DemandStrategy): DemandInput {
  if (state.tick >= state.horizon) return { type: 'view' };
  if (state.strategy === null) return { type: strategy };
  return { type: 'work' };
}

function runDemands(seed: string, board: DemandBoard, strategy: DemandStrategy) {
  const initial = createExecDemands(seed, board);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 8) throw new Error(`${board}:${strategy}`);
    const input = chooseExecDemandAction(state, strategy);
    const next = applyExecDemands(state, input);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { initial, inputs: state.inputs, result: summarizeExecDemands(state) };
}

export function compareExecDemands(seed = 'RI-255') {
  return (['compatible', 'contradict'] as const).flatMap((board) =>
    (['follow', 'negotiate'] as const).map((strategy) => ({
      board,
      strategy,
      ...runDemands(seed, board, strategy),
    })),
  );
}

function preview(state: DemandState, strategy: DemandStrategy) {
  let cursor = structuredClone(state);
  let guard = 0;
  while (cursor.tick < cursor.horizon) {
    if (++guard > 8) break;
    const next = applyExecDemands(cursor, chooseExecDemandAction(cursor, strategy));
    if (next === cursor) break;
    cursor = next;
  }
  const summary = summarizeExecDemands(cursor);
  return {
    strategy,
    score: summary.score,
    outcome: summary.outcome,
    trustSpent: summary.trustSpent,
    nextPromise: summary.nextPromise,
  };
}

export function viewExecDemands(state: DemandState) {
  return {
    tick: state.tick,
    board: state.board,
    demands: [
      {
        order: 1,
        id: 'ai-usage',
        deadline: state.aiDeadline,
        need: state.aiNeed,
        value: state.aiValue,
        negotiable: false,
      },
      {
        order: 2,
        id: 'review-queue',
        deadline: state.reviewDeadline,
        cap: state.statedCap,
        value: state.reviewValue,
        negotiable: true,
        relaxedCap: state.relaxedCap,
      },
    ],
    trustCost: state.trustCost,
    chargesExistingReview: false,
    negotiated: state.negotiated,
    activeCap: state.reviewCap,
    strategy: state.strategy,
    choices: state.strategy === null ? (['follow', 'negotiate'] as const) : [],
    forecasts:
      state.strategy === null
        ? (['follow', 'negotiate'] as const).map((strategy) => preview(state, strategy))
        : [],
  };
}

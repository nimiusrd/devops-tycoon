import {
  applySplitInput,
  createSplitPrototype,
  summarizeSplit,
  type SplitState,
  type SplitInput,
  type SplitTask,
} from './prSplit';

/** 分割後の確認が新しい境界に効くtick幅。確認の所要tickとは別の固定仮定。 */
export const REVIEW_WINDOW = 2;
const REVIEW_FOCUS = 2;

type AtomicInput = SplitInput | { type: 'pairReview'; id: string };
export type SequenceInput = AtomicInput | { type: 'assign'; actions: AtomicInput[] };

/** 比較で一つずつ動かす規則。状態に無いときは baselineSequenceRules。 */
export interface SequenceRules {
  /** 確認が占有するtick。既定1。窓は REVIEW_WINDOW のまま。 */
  reviewTicks: number;
  /** boundaryは分割でできた境界。no-splitは親に元からある原因。 */
  cause: 'boundary' | 'no-split';
  /** 1tickに動かせる担当。同一タスクは1人まで。 */
  assignees: number;
  /** chosenはid指定。leadingは先頭だけ。unavailableは確認を選べない。 */
  reviewSelection: 'chosen' | 'leading' | 'unavailable';
  /** leadingのとき、親系統だけを見るか盤面の並び順か。 */
  leading: 'family' | 'board';
  /**
   * review-on-sign が確認へ移るtick。戦略の入力順だけに使い、成否は窓と原因で決まる。
   * nullは予兆待ちをしない。
   */
  precursorTick: number | null;
}

export const baselineSequenceRules: SequenceRules = {
  reviewTicks: 1,
  cause: 'boundary',
  assignees: 1,
  reviewSelection: 'chosen',
  leading: 'family',
  precursorTick: null,
};

export interface SequenceState {
  version: 1;
  board: SplitState;
  splitAt: number | null;
  reviewed: { rootId: string; revision: number }[];
  inputs: SequenceInput[];
  /** 無いときは初回と同じ規則。初回の比較JSONはこのフィールドを持たない。 */
  rules?: SequenceRules;
}

export type SequenceStrategy =
  | 'split-only'
  | 'split-review'
  | 'review-split'
  | 'other-review'
  | 'whole'
  | 'review-whole'
  | 'review-on-sign';

export interface SequenceFactorRow {
  factor: 'reviewTicks' | 'cause' | 'assignees' | 'leading' | 'failureSign';
  step: string;
  horizon: number;
  strategy: SequenceStrategy;
  integrationFails: boolean;
  rules: SequenceRules;
  inputs: SequenceInput[];
  result: ReturnType<typeof summarizeSequence>;
}

export interface FailureRateRow {
  horizon: number;
  failed: number;
  total: 4;
  netSum: Record<
    'split-only' | 'split-review' | 'review-split' | 'other-review' | 'sign-following',
    number
  >;
}

const BLIND_STRATEGIES = ['split-only', 'split-review', 'review-split', 'other-review'] as const;
const HORIZONS = [3, 9] as const;

function rulesOf(state: SequenceState): SequenceRules {
  return state.rules ?? baselineSequenceRules;
}

function openTask(task: SplitTask) {
  return !task.retired && task.doneTick === null;
}

export function createSequencePrototype(
  seed: string,
  horizon = 10,
  rules?: SequenceRules,
): SequenceState {
  const board = createSplitPrototype(seed, horizon, true);
  // 比較対象でない別タスク。通常方針はparent系統だけに資源を配る。
  board.tasks.push({ ...board.tasks[0], id: 'other', value: 0 });
  return {
    version: 1,
    board,
    splitAt: null,
    reviewed: [],
    inputs: [],
    ...(rules ? { rules: { ...rules } } : {}),
  };
}

function leadingReviewId(state: SequenceState): string | null {
  const rules = rulesOf(state);
  const task = state.board.tasks.find(
    (candidate) => openTask(candidate) && (rules.leading === 'board' || candidate.id !== 'other'),
  );
  return task?.id ?? null;
}

function resolveReviewId(state: SequenceState, requested: string): string | null {
  const rules = rulesOf(state);
  if (rules.reviewSelection === 'unavailable') return null;
  if (rules.reviewSelection === 'leading') return leadingReviewId(state);
  return requested;
}

function applyAtomic(
  state: SequenceState,
  input: AtomicInput,
  record: boolean,
): { state: SequenceState; applied: AtomicInput | null } {
  const rules = rulesOf(state);
  if (input.type === 'split' && input.id !== 'parent') return { state, applied: null };
  if (input.type !== 'pairReview') {
    const board = applySplitInput(state.board, input);
    if (board === state.board) return { state, applied: null };
    // 分割不要な原因の失敗は統合ではなく親の完成時に出る。開始前のフラグのまま。
    if (input.type === 'work' && rules.cause === 'no-split') {
      const after = board.tasks.find((task) => task.id === input.id);
      if (
        after?.id === 'parent' &&
        after.doneTick !== null &&
        board.integrationFails &&
        state.board.failures === 0
      ) {
        after.doneTick = null;
        after.workLeft = 2;
        board.failures += 1;
      }
    }
    const applied = structuredClone(input);
    return {
      applied,
      state: {
        ...state,
        board,
        splitAt: input.type === 'split' && input.id === 'parent' ? board.tick : state.splitAt,
        inputs: record ? [...state.inputs, applied] : state.inputs,
      },
    };
  }
  const resolved = resolveReviewId(state, input.id);
  const task = resolved
    ? state.board.tasks.find((candidate) => candidate.id === resolved)
    : undefined;
  if (
    !task ||
    task.retired ||
    task.doneTick !== null ||
    task.kind === 'integration' ||
    state.board.focus < REVIEW_FOCUS ||
    state.board.tick >= state.board.horizon ||
    state.board.tick + rules.reviewTicks > state.board.horizon
  ) {
    return { state, applied: null };
  }
  const rootId = task.parentId ?? task.id;
  const revision = task.parentId ? 1 : 0;
  if (state.reviewed.some((entry) => entry.rootId === rootId && entry.revision === revision)) {
    return { state, applied: null };
  }
  let board = state.board;
  for (let index = 0; index < rules.reviewTicks; index += 1) {
    const next = applySplitInput(board, { type: 'wait' });
    if (next === board) return { state, applied: null };
    board = next;
  }
  if (rules.reviewTicks === 0) board = structuredClone(board);
  const effective =
    state.board.failures === 0 &&
    (rules.cause === 'no-split'
      ? rootId === 'parent' && revision === 0
      : rootId === 'parent' &&
        revision === 1 &&
        state.splitAt !== null &&
        board.tick - state.splitAt <= REVIEW_WINDOW);
  board.focus -= REVIEW_FOCUS;
  board.focusSpent += REVIEW_FOCUS;
  if (effective) board.integrationFails = false;
  const applied: AtomicInput = { type: 'pairReview', id: task.id };
  return {
    applied,
    state: {
      ...state,
      board,
      reviewed: [...state.reviewed, { rootId, revision }],
      inputs: record ? [...state.inputs, applied] : state.inputs,
    },
  };
}

function applyAssign(state: SequenceState, actions: AtomicInput[]): SequenceState {
  const startTick = state.board.tick;
  const realHorizon = state.board.horizon;
  if (startTick >= realHorizon) return state;
  // 途中のtickが進んでも、同じtickの後続担当を期末で落とさない。
  let cursor: SequenceState = {
    ...state,
    board: structuredClone(state.board),
  };
  cursor.board.horizon = realHorizon + actions.length;
  const worked = new Set<string>();
  const applied: AtomicInput[] = [];
  for (const action of actions) {
    if (action.type === 'work' && worked.has(action.id)) continue;
    if (action.type === 'pairReview' && startTick + rulesOf(cursor).reviewTicks > realHorizon)
      continue;
    const next = applyAtomic(cursor, action, false);
    if (!next.applied) continue;
    if (action.type === 'work') worked.add(action.id);
    cursor = next.state;
    applied.push(next.applied);
  }
  if (applied.length === 0) return state;
  const reviewCost = applied.some((action) => action.type === 'pairReview')
    ? Math.max(rulesOf(state).reviewTicks, 1)
    : 1;
  const advanced = cursor.board.tick - startTick;
  if (advanced > reviewCost) {
    const delta = advanced - reviewCost;
    cursor.board.tick -= delta;
    for (const task of cursor.board.tasks) {
      if (task.doneTick !== null && task.doneTick > startTick)
        task.doneTick = startTick + reviewCost;
    }
  }
  cursor.board.horizon = realHorizon;
  return {
    ...cursor,
    inputs: [
      ...state.inputs,
      { type: 'assign', actions: applied.map((action) => structuredClone(action)) },
    ],
  };
}

export function applySequenceInput(state: SequenceState, input: SequenceInput): SequenceState {
  if (input.type === 'assign') return applyAssign(state, input.actions);
  return applyAtomic(state, input, true).state;
}

export function summarizeSequence(state: SequenceState) {
  return {
    ...summarizeSplit(state.board),
    integrationFails: state.board.integrationFails,
    reviewed: structuredClone(state.reviewed),
  };
}

function workableTasks(state: SequenceState): SplitTask[] {
  return state.board.tasks.filter((task) => {
    if (task.id === 'other' || !openTask(task)) return false;
    if (task.kind === 'integration') {
      return task.children.every((id) =>
        state.board.tasks.some((candidate) => candidate.id === id && candidate.doneTick !== null),
      );
    }
    return true;
  });
}

function applyTick(state: SequenceState, actions: AtomicInput[]): SequenceState {
  if (actions.length === 1) return applySequenceInput(state, actions[0]);
  return applySequenceInput(state, { type: 'assign', actions });
}

function runSequence(
  seed: string,
  horizon: number,
  strategy: SequenceStrategy,
  rules: SequenceRules,
  integrationFails: boolean,
) {
  let state = createSequencePrototype(seed, horizon, rules);
  if (!integrationFails) state.board.integrationFails = false;
  if (
    strategy === 'split-only' ||
    strategy === 'split-review' ||
    strategy === 'other-review' ||
    strategy === 'review-on-sign'
  ) {
    state = applySequenceInput(state, { type: 'split', id: 'parent' });
  } else if (strategy === 'review-split' || strategy === 'review-whole') {
    state = applySequenceInput(state, { type: 'pairReview', id: 'parent' });
    if (strategy === 'review-split')
      state = applySequenceInput(state, { type: 'split', id: 'parent' });
  }
  let reviewDone = strategy === 'review-split' || strategy === 'review-whole';
  while (state.board.tick < state.board.horizon) {
    const reviewNow =
      !reviewDone &&
      (strategy === 'split-review' ||
        strategy === 'other-review' ||
        (strategy === 'review-on-sign' && state.board.tick === rules.precursorTick));
    const reviewId = strategy === 'other-review' ? 'other' : 'split-1';
    const actions: AtomicInput[] = [];
    if (reviewNow) {
      reviewDone = true;
      const review: AtomicInput = { type: 'pairReview', id: reviewId };
      if (applySequenceInput(state, review) !== state) actions.push(review);
    }
    const workSlots = Math.max(0, rules.assignees - actions.length);
    for (const task of workableTasks(state)) {
      if (actions.filter((action) => action.type === 'work').length >= workSlots) break;
      actions.push({ type: 'work', id: task.id });
    }
    if (actions.length === 0) break;
    const next = applyTick(state, actions);
    if (next === state) break;
    state = next;
  }
  return state;
}

export function compareSequenceStrategies(seed: string) {
  return [3, 9].flatMap((horizon) =>
    (['split-only', 'split-review', 'review-split', 'other-review'] as const).map((strategy) => {
      const initial = createSequencePrototype(seed, horizon);
      let state = initial;
      if (strategy === 'review-split')
        state = applySequenceInput(state, { type: 'pairReview', id: 'parent' });
      state = applySequenceInput(state, { type: 'split', id: 'parent' });
      if (strategy === 'split-review')
        state = applySequenceInput(state, { type: 'pairReview', id: 'split-1' });
      if (strategy === 'other-review')
        state = applySequenceInput(state, { type: 'pairReview', id: 'other' });
      while (state.board.tick < state.board.horizon) {
        const task = state.board.tasks.find(
          (candidate) =>
            candidate.id !== 'other' && !candidate.retired && candidate.doneTick === null,
        );
        if (!task) break;
        state = applySequenceInput(state, { type: 'work', id: task.id });
      }
      return { horizon, strategy, initial, inputs: state.inputs, result: summarizeSequence(state) };
    }),
  );
}

interface FactorScenario {
  factor: SequenceFactorRow['factor'];
  step: string;
  rules: SequenceRules;
  integrationFails: boolean;
  strategies: readonly SequenceStrategy[];
}

const factorScenarios: FactorScenario[] = [
  {
    factor: 'reviewTicks',
    step: '2',
    rules: { ...baselineSequenceRules, reviewTicks: 2 },
    integrationFails: true,
    strategies: BLIND_STRATEGIES,
  },
  {
    factor: 'reviewTicks',
    step: '3',
    rules: { ...baselineSequenceRules, reviewTicks: 3 },
    integrationFails: true,
    strategies: BLIND_STRATEGIES,
  },
  {
    factor: 'cause',
    step: 'no-split',
    rules: { ...baselineSequenceRules, cause: 'no-split' },
    integrationFails: true,
    strategies: [...BLIND_STRATEGIES, 'whole', 'review-whole'],
  },
  {
    factor: 'assignees',
    step: '2',
    rules: { ...baselineSequenceRules, assignees: 2 },
    integrationFails: true,
    strategies: BLIND_STRATEGIES,
  },
  {
    factor: 'assignees',
    step: '3',
    rules: { ...baselineSequenceRules, assignees: 3 },
    integrationFails: true,
    strategies: BLIND_STRATEGIES,
  },
  {
    factor: 'leading',
    step: 'family',
    rules: { ...baselineSequenceRules, reviewSelection: 'leading', leading: 'family' },
    integrationFails: true,
    strategies: ['split-only', 'split-review', 'review-split'],
  },
  {
    factor: 'leading',
    step: 'board',
    rules: { ...baselineSequenceRules, reviewSelection: 'leading', leading: 'board' },
    integrationFails: true,
    strategies: ['split-only', 'split-review', 'review-split'],
  },
  {
    factor: 'leading',
    step: 'unavailable',
    rules: { ...baselineSequenceRules, reviewSelection: 'unavailable' },
    integrationFails: true,
    strategies: ['split-only', 'split-review', 'review-split'],
  },
  {
    factor: 'failureSign',
    step: 'rate0',
    rules: baselineSequenceRules,
    integrationFails: false,
    strategies: BLIND_STRATEGIES,
  },
  {
    factor: 'failureSign',
    step: 'signTick1',
    rules: { ...baselineSequenceRules, precursorTick: 1 },
    integrationFails: true,
    strategies: ['review-on-sign'],
  },
  {
    factor: 'failureSign',
    step: 'signTick2',
    rules: { ...baselineSequenceRules, precursorTick: 2 },
    integrationFails: true,
    strategies: ['review-on-sign'],
  },
];

/** 初回と同じ資源で要因を一つずつ動かす。失敗の有無は各行の初期状態に固定する。 */
export function compareSequenceFactorMoves(seed: string) {
  const moves: SequenceFactorRow[] = factorScenarios.flatMap((scenario) =>
    HORIZONS.flatMap((horizon) =>
      scenario.strategies.map((strategy) => {
        const final = runSequence(
          seed,
          horizon,
          strategy,
          scenario.rules,
          scenario.integrationFails,
        );
        return {
          factor: scenario.factor,
          step: scenario.step,
          horizon,
          strategy,
          integrationFails: scenario.integrationFails,
          rules: { ...scenario.rules },
          inputs: final.inputs,
          result: summarizeSequence(final),
        };
      }),
    ),
  );
  const failureRates: FailureRateRow[] = HORIZONS.flatMap((horizon) =>
    [0, 1, 2, 3, 4].map((failed) => {
      const netOf = (strategy: SequenceStrategy, fails: boolean) =>
        summarizeSequence(runSequence(seed, horizon, strategy, baselineSequenceRules, fails))
          .netValue;
      const total = 4 as const;
      const netSum = {
        'split-only':
          failed * netOf('split-only', true) + (total - failed) * netOf('split-only', false),
        'split-review':
          failed * netOf('split-review', true) + (total - failed) * netOf('split-review', false),
        'review-split':
          failed * netOf('review-split', true) + (total - failed) * netOf('review-split', false),
        'other-review':
          failed * netOf('other-review', true) + (total - failed) * netOf('other-review', false),
        // 予兆が開始前に公開されているときだけ、失敗予定の盤面で分割後確認を選ぶ固定規則。
        'sign-following':
          failed * netOf('split-review', true) + (total - failed) * netOf('split-only', false),
      };
      return { horizon, failed, total, netSum };
    }),
  );
  return {
    seed,
    resources: {
      focus: 6,
      parentWorkLeft: 4,
      parentValue: 12,
      horizons: [...HORIZONS],
      reviewWindow: REVIEW_WINDOW,
      reviewFocus: REVIEW_FOCUS,
      assignees: baselineSequenceRules.assignees,
      reviewTicks: baselineSequenceRules.reviewTicks,
      publishedFailure: true,
    },
    moves,
    failureRates,
  };
}

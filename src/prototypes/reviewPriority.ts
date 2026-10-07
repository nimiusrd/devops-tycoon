import { createCiPrototype, tickCiPrototype, type CiState } from './ciCapacity';
export type PriorityInput = { type: 'promote'; id: string } | { type: 'rush' } | { type: 'tick' };
export interface PriorityState {
  version: 1;
  board: CiState;
  focus: number;
  focusSpent: number;
  reviewWait: Record<string, number>;
  deadlines: Record<string, number>;
  values: Record<string, number>;
  inputs: PriorityInput[];
}
export function createPriorityPrototype(seed: string | number, urgent: 'a' | 'b'): PriorityState {
  const board = createCiPrototype(seed, 'review', 1);
  board.jobs = board.jobs.map((job) => ({ ...job, reviewLeft: 2, failFirst: false }));
  return {
    version: 1,
    board,
    focus: 6,
    focusSpent: 0,
    reviewWait: { a: 0, b: 0, c: 0 },
    deadlines: { a: urgent === 'a' ? 3 : 6, b: urgent === 'b' ? 3 : 6, c: 6 },
    values: { a: urgent === 'a' ? 12 : 8, b: urgent === 'b' ? 12 : 8, c: 8 },
    inputs: [],
  };
}
/** 順序変更は集中力2。進行中のレビューは中断せず、先頭連打は無消費。 */
export function applyPriorityInput(state: PriorityState, input: PriorityInput): PriorityState {
  if (state.board.tick >= state.board.horizon) return state;
  const reviews = state.board.jobs.filter((job) => job.stage === 'review');
  if (
    input.type === 'promote' &&
    (state.focus < 2 ||
      reviews[0]?.reviewLeft !== 2 ||
      !reviews.some((job) => job.id === input.id) ||
      reviews[0].id === input.id)
  )
    return state;
  if (input.type === 'rush' && (state.focus < 6 || reviews.length === 0)) return state;
  if (input.type === 'tick' && state.board.budget < state.board.capacity) return state;
  const next = structuredClone(state);
  if (input.type === 'promote') {
    const selected = reviews.find((job) => job.id === input.id)!;
    const order = [selected, ...reviews.filter((job) => job.id !== input.id)];
    let index = 0;
    // Reviewだけを入れ替え、CIや完了済みの仕事の順序・進捗を保つ。
    next.board.jobs = next.board.jobs.map((job) =>
      job.stage === 'review' ? structuredClone(order[index++]) : job,
    );
    next.focus -= 2;
    next.focusSpent += 2;
  } else if (input.type === 'rush') {
    // 現行一括即処理の比較モデル。先頭2件のレビューだけ完了し、CIは省略しない。
    for (const job of next.board.jobs.filter((job) => job.stage === 'review').slice(0, 2)) {
      job.reviewLeft = 0;
    }
    next.focus -= 6;
    next.focusSpent += 6;
  } else {
    const waiting = next.board.jobs.filter((job) => job.stage === 'review' && job.reviewLeft > 0);
    for (const job of waiting.slice(1)) next.reviewWait[job.id]++;
    next.board = tickCiPrototype(next.board, 'all');
  }
  next.inputs.push(input);
  return next;
}
export function summarizePriority(state: PriorityState) {
  const done = state.board.jobs.filter((job) => job.stage === 'done');
  const value = done.reduce(
    (sum, job) => sum + (job.completedTick! <= state.deadlines[job.id] ? state.values[job.id] : 2),
    0,
  );
  return {
    value,
    netValue: value - state.focusSpent,
    focus: state.focus,
    focusSpent: state.focusSpent,
    reviewWait: state.reviewWait,
    jobs: state.board.jobs.map((job) => ({
      id: job.id,
      stage: job.stage,
      completedTick: job.completedTick,
      reviewLeft: job.reviewLeft,
      ciLeft: job.ciLeft,
    })),
    ciCost: 20 - state.board.budget,
    ciWait: state.board.queueWait,
  };
}
export function comparePriorityStrategies(seed: string | number) {
  return (['a', 'b'] as const).flatMap((urgent) =>
    (['fifo', 'promote-b', 'rush'] as const).map((strategy) => {
      const initial = createPriorityPrototype(seed, urgent);
      let state = initial;
      if (strategy === 'promote-b') state = applyPriorityInput(state, { type: 'promote', id: 'b' });
      if (strategy === 'rush') state = applyPriorityInput(state, { type: 'rush' });
      while (state.board.tick < state.board.horizon)
        state = applyPriorityInput(state, { type: 'tick' });
      return { urgent, strategy, initial, inputs: state.inputs, result: summarizePriority(state) };
    }),
  );
}

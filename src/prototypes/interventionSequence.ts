import {
  applySplitInput,
  createSplitPrototype,
  summarizeSplit,
  type SplitState,
  type SplitInput,
} from './prSplit';
export type SequenceInput = SplitInput | { type: 'pairReview'; id: string };
export interface SequenceState {
  version: 1;
  board: SplitState;
  splitAt: number | null;
  reviewed: { rootId: string; revision: number }[];
  inputs: SequenceInput[];
}
export function createSequencePrototype(seed: string, horizon = 10): SequenceState {
  const board = createSplitPrototype(seed, horizon, true);
  // 比較対象でない別タスク。通常方針はparent系統だけに資源を配る。
  board.tasks.push({ ...board.tasks[0], id: 'other', value: 0 });
  return { version: 1, board, splitAt: null, reviewed: [], inputs: [] };
}
export function applySequenceInput(state: SequenceState, input: SequenceInput): SequenceState {
  // 固定試作の分割対象はparentのみ。otherは別対象への確認の対照。
  if (input.type === 'split' && input.id !== 'parent') return state;
  if (input.type !== 'pairReview') {
    const board = applySplitInput(state.board, input);
    if (board === state.board) return state;
    return {
      ...state,
      board,
      splitAt: input.type === 'split' && input.id === 'parent' ? board.tick : state.splitAt,
      inputs: [...state.inputs, structuredClone(input)],
    };
  }
  const task = state.board.tasks.find((t) => t.id === input.id);
  if (
    !task ||
    task.retired ||
    task.doneTick !== null ||
    task.kind === 'integration' ||
    state.board.focus < 2 ||
    state.board.tick >= state.board.horizon
  )
    return state;
  const rootId = task.parentId ?? task.id;
  const revision = task.parentId ? 1 : 0;
  if (state.reviewed.some((r) => r.rootId === rootId && r.revision === revision)) return state;
  const board = applySplitInput(state.board, { type: 'wait' });
  if (board === state.board) return state;
  // 確認完了時点で分割後2tick以内の同系統だけ有効。
  const effective =
    rootId === 'parent' &&
    revision === 1 &&
    state.splitAt !== null &&
    board.tick - state.splitAt <= 2 &&
    state.board.failures === 0;
  board.focus -= 2;
  board.focusSpent += 2;
  if (effective) board.integrationFails = false;
  return {
    ...state,
    board,
    reviewed: [...state.reviewed, { rootId, revision }],
    inputs: [...state.inputs, structuredClone(input)],
  };
}
export function summarizeSequence(state: SequenceState) {
  return {
    ...summarizeSplit(state.board),
    integrationFails: state.board.integrationFails,
    reviewed: structuredClone(state.reviewed),
  };
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
          (t) => t.id !== 'other' && !t.retired && t.doneTick === null,
        );
        if (!task) break;
        state = applySequenceInput(state, { type: 'work', id: task.id });
      }
      return { horizon, strategy, initial, inputs: state.inputs, result: summarizeSequence(state) };
    }),
  );
}

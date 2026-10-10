import {
  createParallelPrototype,
  summarizeParallel,
  tickParallelPrototype,
  type ParallelState,
  type ParallelTask,
} from './parallelConflicts';

export interface CancellationState {
  version: 1;
  board: ParallelState;
  activeId: string | null;
  focus: number;
  trust: number;
  burningIds: string[];
  contractIds: string[];
  cancelled: {
    status: 'cancelled';
    task: ParallelTask;
    tick: number;
    reason: string;
    spentWork: number;
    trustCost: number;
  }[];
  inputs: CancellationInput[];
}
export type CancellationInput =
  { kind: 'work'; ids: string[] } | { kind: 'cancel'; id: string; reason: string };

export function createCancellationPrototype(
  seed: string | number,
  investment: 'shallow' | 'near-complete',
  contract = false,
): CancellationState {
  let board = createParallelPrototype(seed);
  board.slots = 1;
  board.horizon = 5;
  board.tasks = [
    {
      id: 'obsolete',
      domain: 'product',
      codingLeft: 4,
      integrationLeft: 0,
      completedTick: null,
      value: 2,
    },
    {
      id: 'needed',
      domain: 'platform',
      codingLeft: 3,
      integrationLeft: 0,
      completedTick: null,
      value: 8,
    },
  ];
  for (let i = 0; i < (investment === 'shallow' ? 1 : 3); i++)
    board = tickParallelPrototype(board, ['obsolete']);
  return {
    version: 1,
    board,
    activeId: 'obsolete',
    focus: 1,
    trust: 5,
    burningIds: [],
    contractIds: contract ? ['obsolete'] : [],
    cancelled: [],
    inputs: [],
  };
}

/** 通常タスクのCoding中のみ中止可能。統合・Done・炎上・期末は拒否する。 */
export function applyCancellationPrototype(
  state: CancellationState,
  input: CancellationInput,
): CancellationState {
  if (state.board.tick >= state.board.horizon) return state;
  if (input.kind === 'work') {
    // Coding枠は完了か中止まで占有する。無償で別仕事へ切り替えない。
    if (state.activeId !== null && input.ids.some((id) => id !== state.activeId)) return state;
    const board = tickParallelPrototype(state.board, input.ids);
    return board === state.board
      ? state
      : {
          ...state,
          board,
          activeId:
            input.ids.length === 0
              ? state.activeId
              : board.tasks.find((task) => task.id === input.ids[0])!.completedTick === null
                ? input.ids[0]
                : null,
          inputs: [...state.inputs, { ...input, ids: [...input.ids] }],
        };
  }
  const task = state.board.tasks.find((task) => task.id === input.id);
  if (
    !task ||
    task.completedTick !== null ||
    task.codingLeft <= 0 ||
    state.burningIds.includes(input.id) ||
    state.focus < 1 ||
    input.reason.trim().length === 0
  )
    return state;
  const trustCost = state.contractIds.includes(input.id) ? 2 : 0;
  return {
    ...state,
    board: {
      ...state.board,
      tasks: state.board.tasks.filter((candidate) => candidate.id !== input.id),
    },
    activeId: state.activeId === input.id ? null : state.activeId,
    focus: state.focus - 1,
    trust: state.trust - trustCost,
    cancelled: [
      ...state.cancelled,
      {
        status: 'cancelled',
        task: { ...task },
        tick: state.board.tick,
        reason: input.reason.trim(),
        spentWork: state.board.history.filter((entry) => entry.ids.includes(input.id)).length,
        trustCost,
      },
    ],
    inputs: [...state.inputs, { ...input }],
  };
}

export function summarizeCancellation(state: CancellationState) {
  return {
    ...summarizeParallel(state.board),
    focus: state.focus,
    trust: state.trust,
    doneCount: state.board.tasks.filter((task) => task.completedTick !== null).length,
    cancelled: state.cancelled,
  };
}

export function compareCancellationStrategies(seed: string | number) {
  return (['shallow', 'near-complete'] as const).flatMap((investment) =>
    (['continue', 'cancel'] as const).map((strategy) => {
      let state = createCancellationPrototype(seed, investment);
      const initial = structuredClone(state);
      if (strategy === 'cancel')
        state = applyCancellationPrototype(state, {
          kind: 'cancel',
          id: 'obsolete',
          reason: '需要低下。残り枠を必要な仕事に振り向ける',
        });
      while (state.board.tick < state.board.horizon) {
        const task = state.board.tasks.find((task) => task.completedTick === null);
        state = applyCancellationPrototype(state, { kind: 'work', ids: task ? [task.id] : [] });
      }
      return {
        investment,
        strategy,
        initial,
        ...summarizeCancellation(state),
        inputs: state.inputs,
      };
    }),
  );
}

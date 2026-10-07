import {
  createParallelPrototype,
  tickParallelPrototype,
  type ParallelState,
} from './parallelConflicts';

export interface MinimumReleaseState {
  version: 1;
  board: ParallelState;
  extraDeferred: boolean;
  trust: number;
  released: { part: 'core' | 'extra' | 'urgent'; tick: number; value: number }[];
  decisions: { kind: 'defer'; tick: number; workLeft: number }[];
}
export type MinimumReleaseInput =
  | { kind: 'work'; id: string }
  | { kind: 'wait' }
  | { kind: 'defer' };

export function createMinimumReleasePrototype(
  seed: string | number,
  pressure: 'tight' | 'roomy',
): MinimumReleaseState {
  const board = createParallelPrototype(seed);
  board.slots = 1;
  board.horizon = pressure === 'tight' ? 5 : 8;
  board.tasks = [
    {
      id: 'core',
      domain: 'product',
      codingLeft: 3,
      integrationLeft: 0,
      completedTick: null,
      value: 6,
    },
    {
      id: 'extra',
      domain: 'product',
      codingLeft: 4,
      integrationLeft: 0,
      completedTick: null,
      value: 10,
    },
    {
      id: 'urgent',
      domain: 'platform',
      codingLeft: 2,
      integrationLeft: 0,
      completedTick: null,
      value: 8,
    },
  ];
  return { version: 1, board, extraDeferred: false, trust: 5, released: [], decisions: [] };
}

/** 必須だけで成立する出荷を確定し、完全版は追加分だけ加算する。 */
export function tickMinimumReleasePrototype(
  state: MinimumReleaseState,
  input: MinimumReleaseInput,
): MinimumReleaseState {
  if (state.board.tick >= state.board.horizon) return state;
  const core = state.board.tasks.find((task) => task.id === 'core')!;
  const extra = state.board.tasks.find((task) => task.id === 'extra')!;
  if (input.kind === 'defer') {
    if (core.completedTick === null || extra.completedTick !== null || state.extraDeferred)
      return state;
    return {
      ...state,
      extraDeferred: true,
      trust: state.trust - 1,
      decisions: [
        ...state.decisions,
        {
          kind: 'defer',
          tick: state.board.tick,
          workLeft: extra.codingLeft + extra.integrationLeft,
        },
      ],
    };
  }
  if (
    input.kind === 'work' &&
    input.id === 'extra' &&
    (core.completedTick === null || state.extraDeferred)
  )
    return state;
  const board = tickParallelPrototype(state.board, input.kind === 'wait' ? [] : [input.id]);
  if (board === state.board) return state;
  const released = [...state.released];
  for (const task of board.tasks) {
    if (task.completedTick === board.tick) {
      released.push({
        part: task.id as 'core' | 'extra' | 'urgent',
        tick: board.tick,
        value: task.value,
      });
    }
  }
  return { ...state, board, released };
}

export function summarizeMinimumRelease(state: MinimumReleaseState) {
  const extra = state.board.tasks.find((task) => task.id === 'extra')!;
  return {
    tick: state.board.tick,
    edition: state.released.some((part) => part.part === 'extra')
      ? 'full'
      : state.released.some((part) => part.part === 'core')
        ? 'minimum'
        : 'none',
    value: state.released.reduce((sum, part) => sum + part.value, 0),
    released: state.released,
    trust: state.trust,
    promise:
      extra.completedTick !== null
        ? null
        : {
            part: 'extra',
            deferred: state.extraDeferred,
            workLeft: extra.codingLeft + extra.integrationLeft,
            additionalValue: extra.value,
          },
    workSpent: state.board.history.reduce((sum, input) => sum + input.ids.length, 0),
  };
}

export function compareMinimumReleaseStrategies(seed: string | number) {
  return (['tight', 'roomy'] as const).flatMap((pressure) =>
    (['full', 'minimum'] as const).map((strategy) => {
      let state = createMinimumReleasePrototype(seed, pressure);
      const inputs: MinimumReleaseInput[] = [];
      while (state.board.tick < state.board.horizon) {
        let input: MinimumReleaseInput;
        if (
          strategy === 'minimum' &&
          !state.extraDeferred &&
          state.board.tasks[0].completedTick !== null
        )
          input = { kind: 'defer' };
        else {
          const task = state.board.tasks.find(
            (task) => task.completedTick === null && !(state.extraDeferred && task.id === 'extra'),
          );
          input = task ? { kind: 'work', id: task.id } : { kind: 'wait' };
        }
        inputs.push(input);
        state = tickMinimumReleasePrototype(state, input);
      }
      return {
        pressure,
        strategy,
        ...summarizeMinimumRelease(state),
        inputs,
        decisions: state.decisions,
      };
    }),
  );
}

import {
  createDependencyPrototype,
  tickDependencyPrototype,
  type DependencyState,
} from './taskDependencies';

export interface DeadlineState {
  version: 1;
  board: DependencyState;
  deadlineTick: number;
  onTimeValue: number;
  lateValue: number;
  focus: number;
  stamina: number;
  boosts: number[];
}

export function createDeadlinePrototype(
  seed: string | number,
  pressure: 'recoverable' | 'missed',
): DeadlineState {
  const board = createDependencyPrototype(seed);
  board.tasks = [
    {
      id: 'campaign',
      requires: [],
      workLeft: pressure === 'recoverable' ? 4 : 6,
      value: 12,
      done: false,
    },
  ];
  board.horizon = 8;
  return {
    version: 1,
    board,
    deadlineTick: 3,
    onTimeValue: 12,
    lateValue: 5,
    focus: 2,
    stamina: 10,
    boosts: [],
  };
}

export function deadlineValue(state: DeadlineState, completionTick: number): number {
  return completionTick <= state.deadlineTick ? state.onTimeValue : state.lateValue;
}

/** tick終端に出荷してから価値を確定する。期限tickの出荷は期限内。 */
export function tickDeadlinePrototype(
  state: DeadlineState,
  action: 'work' | 'boost' | 'wait',
): DeadlineState {
  if (state.board.tick >= state.board.horizon || state.board.tasks[0].done) return state;
  if (action === 'boost' && (state.focus < 1 || state.stamina < 3)) return state;
  let board = state.board;
  const usefulBoost = action === 'boost' && board.tasks[0].workLeft > 1;
  // 追加工数を先に確保し、共通エンジンで通常工数とDoneを一度だけ確定する。
  if (usefulBoost)
    board = {
      ...board,
      tasks: board.tasks.map((task) => ({ ...task, workLeft: task.workLeft - 1 })),
    };
  board = tickDependencyPrototype(
    board,
    action === 'wait' ? { kind: 'wait' } : { kind: 'assign', id: 'campaign' },
  );
  board = {
    ...board,
    shipped: board.shipped.map((shipment) => ({
      ...shipment,
      value: deadlineValue(state, shipment.tick),
    })),
  };
  return {
    ...state,
    board,
    focus: state.focus - (action === 'boost' ? 1 : 0),
    stamina: state.stamina - (action === 'boost' ? 3 : 0),
    boosts: action === 'boost' ? [...state.boosts, board.tick] : [...state.boosts],
  };
}

export function compareDeadlineStrategies(seed: string | number) {
  return (['recoverable', 'missed'] as const).flatMap((pressure) =>
    (['conserve', 'rush'] as const).map((strategy) => {
      let state = createDeadlinePrototype(seed, pressure);
      while (!state.board.tasks[0].done && state.board.tick < state.board.horizon) {
        state = tickDeadlinePrototype(
          state,
          strategy === 'rush' && state.board.tick === 0 ? 'boost' : 'work',
        );
      }
      return {
        pressure,
        strategy,
        shipped: state.board.shipped,
        workLeft: state.board.tasks[0].workLeft,
        focus: state.focus,
        stamina: state.stamina,
        boosts: state.boosts,
      };
    }),
  );
}

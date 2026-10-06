import { createRng } from '../sim/rng';
import { createDeadlinePrototype, tickDeadlinePrototype, type DeadlineState } from './taskDeadline';

export interface InvestigationState {
  version: 1;
  deadline: DeadlineState;
  hiddenRisk: 'low' | 'high';
  revealed: boolean;
  started: boolean;
  researchLeft: number;
  researchTicks: number;
  otherTask: { id: string; ambiguous: boolean; risk: null };
  history: ('work' | 'boost' | 'wait' | 'investigate')[];
}

export function createInvestigationPrototype(seed: string | number): InvestigationState {
  const deadline = createDeadlinePrototype(seed, 'recoverable');
  deadline.deadlineTick = 4;
  deadline.board.horizon = 6;
  return {
    version: 1,
    deadline,
    hiddenRisk: createRng(seed)() < 0.5 ? 'low' : 'high',
    revealed: false,
    started: false,
    researchLeft: 0,
    researchTicks: 0,
    otherTask: { id: 'other', ambiguous: true, risk: null },
    history: [],
  };
}

/** プレイヤーへ渡す投影。内部保存の予定リスクを表示前に漏らさない。 */
export function investigationView(state: InvestigationState) {
  return {
    tick: state.deadline.board.tick,
    task: {
      id: 'campaign',
      workLeft: state.deadline.board.tasks[0].workLeft,
      ambiguous: !state.revealed,
      risk: state.revealed ? state.hiddenRisk : null,
      avoidedRework: state.revealed ? (state.hiddenRisk === 'high' ? 3 : 0) : null,
    },
    otherTask: { ...state.otherTask },
    researchLeft: state.researchLeft,
    researchCost: 2,
    deadlineTick: state.deadline.deadlineTick,
    onTimeValue: state.deadline.onTimeValue,
    lateValue: state.deadline.lateValue,
    focus: state.deadline.focus,
    stamina: state.deadline.stamina,
  };
}

/** 調査は2tickの処理容量を独占。着手後や完了後の調査は拒否する。 */
export function tickInvestigationPrototype(
  state: InvestigationState,
  action: InvestigationState['history'][number],
): InvestigationState {
  if (
    state.deadline.board.tick >= state.deadline.board.horizon ||
    state.deadline.board.tasks[0].done
  )
    return state;
  if (action === 'investigate' && (state.started || state.revealed)) return state;
  if (state.researchLeft > 0 || action === 'investigate') {
    const researchLeft = (state.researchLeft || 2) - 1;
    return {
      ...state,
      deadline: tickDeadlinePrototype(state.deadline, 'wait'),
      researchLeft,
      researchTicks: state.researchTicks + 1,
      revealed: researchLeft === 0,
      history: [...state.history, action],
    };
  }
  let deadline = state.deadline;
  // 調査せず着手した場合だけ、初期seedで確定済みの後工程手戻りを工数に載せる。
  const starting = !state.started && action !== 'wait';
  if (starting && !state.revealed && state.hiddenRisk === 'high') {
    deadline = {
      ...deadline,
      board: {
        ...deadline.board,
        tasks: deadline.board.tasks.map((task) => ({ ...task, workLeft: task.workLeft + 3 })),
      },
    };
  }
  const next = tickDeadlinePrototype(deadline, action);
  // 資源不足による拒否では隠し工数の公開や着手を確定しない。
  if (next === deadline) return state;
  return {
    ...state,
    deadline: next,
    started: state.started || starting,
    history: [...state.history, action],
  };
}

export function replayInvestigation(
  seed: string | number,
  inputs: InvestigationState['history'],
): InvestigationState {
  return inputs.reduce(tickInvestigationPrototype, createInvestigationPrototype(seed));
}

export function compareInvestigationStrategies(seeds: (string | number)[]) {
  return seeds.flatMap((seed) =>
    (['rush', 'investigate'] as const).map((strategy) => {
      let state = createInvestigationPrototype(seed);
      while (
        !state.deadline.board.tasks[0].done &&
        state.deadline.board.tick < state.deadline.board.horizon
      ) {
        state = tickInvestigationPrototype(
          state,
          strategy === 'investigate' && state.deadline.board.tick === 0 ? 'investigate' : 'work',
        );
      }
      return {
        seed,
        risk: state.hiddenRisk,
        strategy,
        shipped: state.deadline.board.shipped,
        workLeft: state.deadline.board.tasks[0].workLeft,
        researchTicks: state.researchTicks,
        focus: state.deadline.focus,
        stamina: state.deadline.stamina,
        history: state.history,
      };
    }),
  );
}

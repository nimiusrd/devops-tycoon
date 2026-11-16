import { createRng } from '../sim/rng';

export interface DependencyTask {
  id: string;
  requires: string[];
  workLeft: number;
  value: number;
  done: boolean;
}

export interface DependencyState {
  version: 1;
  seed: string | number;
  tick: number;
  horizon: number;
  tasks: DependencyTask[];
  shipped: { id: string; tick: number; value: number }[];
  history: { tick: number; id: string | null; blocked: string[] }[];
}

/** 初期盤面の不正値・欠落・循環を、実行前に検出する。 */
export function validateDependencyTasks(tasks: DependencyTask[]): void {
  const ids = new Set(tasks.map((task) => task.id));
  if (ids.size !== tasks.length) throw new Error('重複ID');
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error('循環依存');
    if (visited.has(id)) return;
    const task = tasks.find((candidate) => candidate.id === id);
    if (!task) throw new Error('解除不能: 前提タスク欠落');
    if (
      !Number.isInteger(task.workLeft) ||
      task.workLeft < 0 ||
      (!task.done && task.workLeft === 0) ||
      (task.done && task.workLeft !== 0) ||
      !Number.isFinite(task.value) ||
      task.value < 0
    )
      throw new Error('不正なタスク');
    visiting.add(id);
    task.requires.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  tasks.forEach((task) => visit(task.id));
  if (
    tasks.some(
      (task) => task.done && task.requires.some((id) => !tasks.find((t) => t.id === id)!.done),
    )
  ) {
    throw new Error('前提未完了の出荷');
  }
}

export function createDependencyPrototype(seed: string | number): DependencyState {
  const rng = createRng(seed);
  const foundationWork = rng() < 0.5 ? 2 : 3;
  const tasks: DependencyTask[] = [
    { id: 'foundation', requires: [], workLeft: foundationWork, value: 1, done: false },
    { id: 'a', requires: ['foundation'], workLeft: 2, value: 6, done: false },
    { id: 'b', requires: ['foundation'], workLeft: 2, value: 6, done: false },
    { id: 'direct', requires: [], workLeft: 3, value: 7, done: false },
  ];
  validateDependencyTasks(tasks);
  return { version: 1, seed, tick: 0, horizon: 6, tasks, shipped: [], history: [] };
}

export function dependencyEligibility(state: DependencyState, id: string) {
  const task = state.tasks.find((candidate) => candidate.id === id);
  if (!task) throw new Error('未知のタスク');
  const blocked = task.requires.filter(
    (required) => !state.tasks.some((t) => t.id === required && t.done),
  );
  return { eligible: !task.done && blocked.length === 0, blocked };
}

/** 自動流入と手動差配は同じ判定を通す。拒否入力は時間・資源を使わない。 */
export function tickDependencyPrototype(
  state: DependencyState,
  input: { kind: 'wait' } | { kind: 'assign'; id: string } | { kind: 'auto'; order: string[] },
): DependencyState {
  if (state.tick >= state.horizon) return state;
  const id =
    input.kind === 'wait'
      ? undefined
      : input.kind === 'assign'
        ? input.id
        : input.order.find((candidate) => dependencyEligibility(state, candidate).eligible);
  if (id !== undefined && !dependencyEligibility(state, id).eligible) return state;
  const next: DependencyState = {
    ...state,
    tick: state.tick + 1,
    tasks: state.tasks.map((task) => ({ ...task, requires: [...task.requires] })),
    shipped: [...state.shipped],
    history: [...state.history],
  };
  // このtick開始時点の依存待ちを記録する。前提完了と同tickに後続を進めない。
  const blocked = state.tasks
    .filter((task) => !task.done && !dependencyEligibility(state, task.id).eligible)
    .map((task) => task.id);
  next.history.push({ tick: next.tick, id: id ?? null, blocked });
  if (id !== undefined) {
    const task = next.tasks.find((candidate) => candidate.id === id)!;
    task.workLeft -= 1;
    if (task.workLeft === 0) {
      task.done = true;
      next.shipped.push({ id, tick: next.tick, value: task.value });
    }
  }
  return next;
}

export function summarizeDependencies(state: DependencyState) {
  return {
    tick: state.tick,
    value: state.shipped.reduce((sum, task) => sum + task.value, 0),
    shipped: state.shipped,
    remaining: state.tasks
      .filter((task) => !task.done)
      .map((task) => ({ id: task.id, workLeft: task.workLeft })),
    waitingTaskTicks: state.history.reduce((sum, entry) => sum + entry.blocked.length, 0),
  };
}

export const DEPENDENCY_STRATEGY_ORDERS = {
  'foundation-first': ['foundation', 'a', 'b', 'direct'],
  'direct-first': ['direct', 'foundation', 'a', 'b'],
} as const;

export type DependencyStrategyName = keyof typeof DEPENDENCY_STRATEGY_ORDERS;

export function compareDependencyStrategies(seed: string | number) {
  return (Object.keys(DEPENDENCY_STRATEGY_ORDERS) as DependencyStrategyName[]).map((strategy) => {
    let state = createDependencyPrototype(seed);
    while (state.tick < state.horizon) {
      state = tickDependencyPrototype(state, {
        kind: 'auto',
        order: [...DEPENDENCY_STRATEGY_ORDERS[strategy]],
      });
    }
    return { strategy, ...summarizeDependencies(state), history: state.history };
  });
}

export type DependencyFactorName = 'horizon' | 'successor-value' | 'successor-deadline';

export interface DependencyFactorInput {
  factor: DependencyFactorName;
  role: 'requested' | 'boundary';
  horizon: number;
  successorValue: number;
  successorDeadlineTick: number | null;
}

/** 初回seedの工数・基盤価値・直接価値を保ち、指定した期末と後続価値だけを載せる。 */
export function createDependencyFactorState(input: DependencyFactorInput): DependencyState {
  const state = createDependencyPrototype('RI-154');
  return {
    ...state,
    horizon: input.horizon,
    tasks: state.tasks.map((task) => ({
      ...task,
      requires: [...task.requires],
      value: task.id === 'a' || task.id === 'b' ? input.successorValue : task.value,
    })),
  };
}

function successorValueCounts(id: string, tick: number, deadline: number | null): boolean {
  if (deadline === null || (id !== 'a' && id !== 'b')) return true;
  return tick <= deadline;
}

function judgeDependencyOutcomes(
  foundation: { countedValue: number; waitingTaskTicks: number },
  direct: { countedValue: number; waitingTaskTicks: number },
): { valueLeader: DependencyStrategyName | 'tie'; verdict: DependencyStrategyName | 'tie' } {
  const valueLeader =
    foundation.countedValue === direct.countedValue
      ? 'tie'
      : foundation.countedValue > direct.countedValue
        ? 'foundation-first'
        : 'direct-first';
  if (valueLeader !== 'tie') return { valueLeader, verdict: valueLeader };
  if (foundation.waitingTaskTicks === direct.waitingTaskTicks) {
    return { valueLeader, verdict: 'tie' };
  }
  return {
    valueLeader,
    verdict:
      foundation.waitingTaskTicks < direct.waitingTaskTicks ? 'foundation-first' : 'direct-first',
  };
}

// 指定は期末7・9、後続価値3（初回6の半分）、納期2（基盤完了tick 3より前）。
// 期末8と後続価値7・8は、そのあいだで順位が動く境界。
const REVERSAL_BOARDS: DependencyFactorInput[] = [
  {
    factor: 'horizon',
    role: 'requested',
    horizon: 7,
    successorValue: 6,
    successorDeadlineTick: null,
  },
  {
    factor: 'horizon',
    role: 'boundary',
    horizon: 8,
    successorValue: 6,
    successorDeadlineTick: null,
  },
  {
    factor: 'horizon',
    role: 'requested',
    horizon: 9,
    successorValue: 6,
    successorDeadlineTick: null,
  },
  {
    factor: 'successor-value',
    role: 'requested',
    horizon: 6,
    successorValue: 3,
    successorDeadlineTick: null,
  },
  {
    factor: 'successor-value',
    role: 'boundary',
    horizon: 6,
    successorValue: 7,
    successorDeadlineTick: null,
  },
  {
    factor: 'successor-value',
    role: 'boundary',
    horizon: 6,
    successorValue: 8,
    successorDeadlineTick: null,
  },
  {
    factor: 'successor-deadline',
    role: 'requested',
    horizon: 6,
    successorValue: 6,
    successorDeadlineTick: 2,
  },
];

/**
 * 初回と同じ資源・固定順で、期末・後続価値・後続納期を一つずつ動かす。
 * 納期は後続の出荷tickだけに掛け、エンジンの進行は変えない。
 */
export function compareDependencyFactorReversals() {
  const boards = REVERSAL_BOARDS.map((input) => {
    const initial = createDependencyFactorState(input);
    const results = (Object.keys(DEPENDENCY_STRATEGY_ORDERS) as DependencyStrategyName[]).map(
      (strategy) => {
        const order = [...DEPENDENCY_STRATEGY_ORDERS[strategy]];
        let state = structuredClone(initial);
        while (state.tick < state.horizon) {
          state = tickDependencyPrototype(state, { kind: 'auto', order });
        }
        const shipped = state.shipped.map((shipment) => ({
          ...shipment,
          counted: successorValueCounts(shipment.id, shipment.tick, input.successorDeadlineTick),
        }));
        const summary = summarizeDependencies(state);
        return {
          strategy,
          order,
          inputs: state.history.map((entry) => entry.id),
          tick: summary.tick,
          countedValue: shipped.reduce((sum, item) => sum + (item.counted ? item.value : 0), 0),
          waitingTaskTicks: summary.waitingTaskTicks,
          shipped,
          remaining: summary.remaining,
          history: state.history,
        };
      },
    );
    const foundation = results[0];
    const direct = results[1];
    if (foundation === undefined || direct === undefined) throw new Error('戦略が不足');
    return {
      ...input,
      tasks: initial.tasks,
      results,
      ...judgeDependencyOutcomes(foundation, direct),
    };
  });
  return {
    seed: 'RI-154' as const,
    baseline: {
      horizon: 6,
      successorValue: 6,
      successorDeadlineTick: null,
      valueLeader: 'direct-first' as const,
    },
    boards,
  };
}

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

export function compareDependencyStrategies(seed: string | number) {
  return [
    { strategy: 'foundation-first', order: ['foundation', 'a', 'b', 'direct'] },
    { strategy: 'direct-first', order: ['direct', 'foundation', 'a', 'b'] },
  ].map(({ strategy, order }) => {
    let state = createDependencyPrototype(seed);
    while (state.tick < state.horizon)
      state = tickDependencyPrototype(state, { kind: 'auto', order });
    return { strategy, ...summarizeDependencies(state), history: state.history };
  });
}

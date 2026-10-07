import { createRng } from '../sim/rng';

export interface ParallelTask {
  id: string;
  domain: 'product' | 'platform';
  codingLeft: number;
  integrationLeft: number;
  value: number;
  completedTick: number | null;
}
export interface ParallelState {
  version: 1;
  seed: string | number;
  tick: number;
  horizon: number;
  slots: number;
  tasks: ParallelTask[];
  conflicts: { pair: string[]; owner: string; tick: number; effort: number }[];
  history: { ids: string[]; tick: number }[];
}

export function createParallelPrototype(seed: string | number): ParallelState {
  const rng = createRng(seed);
  const extraWork = rng() < 0.5 ? 4 : 5;
  return {
    version: 1,
    seed,
    tick: 0,
    horizon: 12,
    slots: 2,
    tasks: [
      {
        id: 'a',
        domain: 'product',
        codingLeft: 3,
        integrationLeft: 0,
        value: 6,
        completedTick: null,
      },
      {
        id: 'b',
        domain: 'product',
        codingLeft: 3,
        integrationLeft: 0,
        value: 6,
        completedTick: null,
      },
      {
        id: 'c',
        domain: 'platform',
        codingLeft: extraWork,
        integrationLeft: 0,
        value: 6,
        completedTick: null,
      },
    ],
    conflicts: [],
    history: [],
  };
}

/** 入力はこのtickに実際に作業するID。拒否時はtick・工数とも消費しない。 */
export function tickParallelPrototype(state: ParallelState, ids: string[]): ParallelState {
  if (state.tick >= state.horizon) return state;
  if (
    ids.length > state.slots ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !state.tasks.some((task) => task.id === id && task.completedTick === null))
  )
    return state;
  const next: ParallelState = {
    ...state,
    tick: state.tick + 1,
    tasks: state.tasks.map((task) => ({ ...task })),
    conflicts: [...state.conflicts],
    history: [...state.history, { ids: [...ids], tick: state.tick + 1 }],
  };
  const coding = next.tasks.filter((task) => ids.includes(task.id) && task.codingLeft > 0);
  // ID順で統合担当を固定し、入力順で費用・担当が変わることを防ぐ。
  coding.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let i = 0; i < coding.length; i++) {
    for (let j = i + 1; j < coding.length; j++) {
      const first = coding[i];
      const second = coding[j];
      const pair = [first.id, second.id];
      if (
        first.domain !== second.domain ||
        next.conflicts.some((c) => c.pair[0] === pair[0] && c.pair[1] === pair[1])
      )
        continue;
      second.integrationLeft += 2;
      next.conflicts.push({ pair, owner: second.id, tick: next.tick, effort: 2 });
    }
  }
  for (const task of next.tasks.filter((task) => ids.includes(task.id))) {
    if (task.codingLeft > 0) task.codingLeft -= 1;
    else if (task.integrationLeft > 0) task.integrationLeft -= 1;
    if (task.codingLeft === 0 && task.integrationLeft === 0) task.completedTick = next.tick;
  }
  return next;
}

export function summarizeParallel(state: ParallelState) {
  return {
    tick: state.tick,
    shipped: state.tasks
      .filter((task) => task.completedTick !== null)
      .map((task) => ({ id: task.id, tick: task.completedTick, value: task.value })),
    value: state.tasks
      .filter((task) => task.completedTick !== null)
      .reduce((sum, task) => sum + task.value, 0),
    integrationEffort: state.conflicts.reduce((sum, conflict) => sum + conflict.effort, 0),
    remaining: state.tasks.filter((task) => task.completedTick === null),
    workSpent: state.history.reduce((sum, input) => sum + input.ids.length, 0),
  };
}

export function compareParallelStrategies(seed: string | number) {
  return (['same-domain', 'mixed-domains'] as const).flatMap((composition) =>
    (['serial', 'same-first', 'distribute'] as const).map((strategy) => {
      let state = createParallelPrototype(seed);
      if (composition === 'same-domain') state.tasks = state.tasks.slice(0, 2);
      const order = strategy === 'distribute' ? ['a', 'c', 'b'] : ['a', 'b', 'c'];
      while (
        state.tasks.some((task) => task.completedTick === null) &&
        state.tick < state.horizon
      ) {
        const ids = order
          .filter((id) => state.tasks.some((task) => task.id === id && task.completedTick === null))
          .slice(0, strategy === 'serial' ? 1 : state.slots);
        state = tickParallelPrototype(state, ids);
      }
      return {
        composition,
        strategy,
        ...summarizeParallel(state),
        history: state.history,
        conflicts: state.conflicts,
      };
    }),
  );
}

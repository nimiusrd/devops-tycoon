import { createRng } from '../sim/rng';

export interface FeatureTask {
  id: number;
  featureId: 'reports' | 'alerts';
  role: 'api' | 'screen' | 'migration';
  workLeft: number;
  value: number;
  done: boolean;
  reworkPending: boolean;
}

export interface FeatureSetState {
  version: 1;
  tick: number;
  deadline: number;
  tasks: FeatureTask[];
  individualValue: number;
  completions: { featureId: FeatureTask['featureId']; tick: number; integrationValue: number }[];
  history: { tick: number; taskId: number; result: 'progress' | 'rework' | 'done' }[];
}

/** 個別仕事と、三つの成果が組み合わさって使える価値を別々に定義する。 */
export const FEATURE_SETS = [
  { id: 'reports' as const, required: [0, 1, 2], integrationValue: 8 },
  { id: 'alerts' as const, required: [3, 4, 5], integrationValue: 5 },
];

export function createFeatureSetPrototype(seed: string | number): FeatureSetState {
  const rng = createRng(seed);
  const definitions: { work: number; value: number }[] = [
    { work: 2, value: 4 },
    { work: 2, value: 4 },
    { work: 5, value: 4 },
    { work: 1, value: 2 },
    { work: 1, value: 2 },
    { work: 4, value: 3 },
  ];
  return {
    version: 1,
    tick: 0,
    deadline: 8,
    tasks: definitions.map(({ work, value }, id) => ({
      id,
      featureId: id < 3 ? 'reports' : 'alerts',
      role: (['api', 'screen', 'migration'] as const)[id % 3],
      workLeft: work,
      value,
      done: false,
      reworkPending: id % 3 === 2 && rng() < 0.25,
    })),
    individualValue: 0,
    completions: [],
    history: [],
  };
}

/** 一工数/tick。手戻りはDoneの前に追加一工数、既出荷の取消や再計上はしない。 */
export function tickFeatureSetPrototype(state: FeatureSetState, taskId?: number): FeatureSetState {
  if (state.tick >= state.deadline) return state;
  const selected =
    taskId === undefined ? undefined : state.tasks.find((task) => task.id === taskId);
  if (taskId !== undefined && selected === undefined) throw new Error('未知のタスク');
  // 完了済みへの重複入力は時間・評価を変えない。
  if (selected?.done) return state;
  const next: FeatureSetState = {
    ...state,
    tick: state.tick + 1,
    tasks: state.tasks.map((task) => ({ ...task })),
    completions: state.completions.map((completion) => ({ ...completion })),
    history: [...state.history],
  };
  if (selected === undefined) return next;
  const task = next.tasks.find((candidate) => candidate.id === taskId)!;
  task.workLeft -= 1;
  let result: FeatureSetState['history'][number]['result'] = 'progress';
  if (task.workLeft === 0) {
    if (task.reworkPending) {
      task.reworkPending = false;
      task.workLeft = 1;
      result = 'rework';
    } else {
      task.done = true;
      next.individualValue += task.value;
      result = 'done';
      for (const feature of FEATURE_SETS) {
        if (next.completions.some((completion) => completion.featureId === feature.id)) continue;
        if (
          feature.required.every((id) =>
            next.tasks.some((candidate) => candidate.id === id && candidate.done),
          )
        ) {
          next.completions.push({
            featureId: feature.id,
            tick: next.tick,
            integrationValue: feature.integrationValue,
          });
        }
      }
    }
  }
  next.history.push({ tick: next.tick, taskId: task.id, result });
  return next;
}

export function summarizeFeatureSets(state: FeatureSetState) {
  return {
    individualValue: state.individualValue,
    integrationValue: state.completions.reduce((sum, feature) => sum + feature.integrationValue, 0),
    completedFeatures: state.completions,
    completedTasks: state.tasks.filter((task) => task.done).map((task) => task.id),
    pendingTasks: state.tasks
      .filter((task) => !task.done)
      .map((task) => ({
        id: task.id,
        workLeft: task.workLeft,
        reworkPending: task.reworkPending,
      })),
    rework: state.history.filter((entry) => entry.result === 'rework').length,
    tick: state.tick,
  };
}

export function compareFeatureSetStrategies(seed: string | number) {
  return [
    { strategy: 'immediate', order: [0, 1, 3, 4, 5, 2] },
    { strategy: 'complete-feature', order: [3, 4, 5, 0, 1, 2] },
  ].map(({ strategy, order }) => {
    let state = createFeatureSetPrototype(seed);
    while (state.tick < state.deadline) {
      state = tickFeatureSetPrototype(
        state,
        order.find((id) => !state.tasks.find((task) => task.id === id)!.done),
      );
    }
    return { strategy, ...summarizeFeatureSets(state), history: state.history };
  });
}

/**
 * Issue #549 の隔離決定論 sim。#733 の featureSets を複製しただけ。本番へは接続しない。
 */

import { CONDITIONS, FEATURE_SETS, PARAMS, POLICIES, TASK_DEFINITIONS } from './params.mjs';
import { createRng } from './rng.mjs';

function cloneTask(task) {
  return { ...task };
}

function cloneCompletion(completion) {
  return { ...completion };
}

export function createBoard(seed, condition) {
  const rng = createRng(seed);
  const tasks = TASK_DEFINITIONS.map(({ work, value }, id) => ({
    id,
    featureId: id < 3 ? 'reports' : 'alerts',
    role: ['api', 'screen', 'migration'][id % 3],
    workLeft: work,
    value,
    done: false,
    reworkPending: id % 3 === 2 && rng() < condition.reworkProbability,
  }));
  return {
    version: 1,
    seed,
    conditionId: condition.id,
    tick: 0,
    deadline: condition.deadline,
    tasks,
    individualValue: 0,
    completions: [],
    history: [],
    individualShipEvents: 0,
    setCompletionEvents: 0,
  };
}

export function setRewardOf(state) {
  return state.completions.reduce((sum, feature) => sum + feature.integrationValue, 0);
}

export function totalShippedValueOf(state) {
  return state.individualValue + setRewardOf(state);
}

/**
 * 個別出荷とセット完成の二重計上がないことを検査する。
 * 完成は featureId ごとに一度。個別値は Done タスク価値の合計だけ。
 */
export function assertAccounting(state) {
  const doneTasks = state.tasks.filter((task) => task.done);
  const doneValue = doneTasks.reduce((sum, task) => sum + task.value, 0);
  if (state.individualValue !== doneValue) {
    throw new Error(`individualValue ${state.individualValue} != done-task sum ${doneValue}`);
  }
  if (state.individualShipEvents !== doneTasks.length) {
    throw new Error(
      `individualShipEvents ${state.individualShipEvents} != done count ${doneTasks.length}`,
    );
  }

  const ids = state.completions.map((completion) => completion.featureId);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`set completion recorded more than once: ${ids.join(',')}`);
  }
  if (state.setCompletionEvents !== state.completions.length) {
    throw new Error(
      `setCompletionEvents ${state.setCompletionEvents} != completions ${state.completions.length}`,
    );
  }

  for (const completion of state.completions) {
    const feature = FEATURE_SETS.find((candidate) => candidate.id === completion.featureId);
    if (!feature) throw new Error(`unknown completed feature ${completion.featureId}`);
    if (completion.integrationValue !== feature.integrationValue) {
      throw new Error(`set reward mutated for ${feature.id}`);
    }
    const requiredDone = feature.required.every((id) =>
      state.tasks.some((task) => task.id === id && task.done),
    );
    if (!requiredDone) {
      throw new Error(`set ${feature.id} completed before required tasks`);
    }
  }

  const expectedSetReward = state.completions.reduce(
    (sum, feature) => sum + feature.integrationValue,
    0,
  );
  if (setRewardOf(state) !== expectedSetReward) {
    throw new Error('set reward double-counted');
  }
  return {
    individualShipEvents: state.individualShipEvents,
    setCompletionEvents: state.setCompletionEvents,
    individualValue: state.individualValue,
    setReward: expectedSetReward,
    totalShippedValue: state.individualValue + expectedSetReward,
  };
}

/** 一工数/tick。手戻りは Done 前の追加一工数。既出荷の取消や再計上はしない。 */
export function tickBoard(state, taskId) {
  if (state.tick >= state.deadline) return state;
  const selected =
    taskId === undefined ? undefined : state.tasks.find((task) => task.id === taskId);
  if (taskId !== undefined && selected === undefined) throw new Error('未知のタスク');
  if (selected?.done) return state;

  const next = {
    ...state,
    tick: state.tick + 1,
    tasks: state.tasks.map(cloneTask),
    completions: state.completions.map(cloneCompletion),
    history: [...state.history],
  };
  if (selected === undefined) return next;

  const task = next.tasks.find((candidate) => candidate.id === taskId);
  task.workLeft -= PARAMS.workPerTick;
  let result = 'progress';
  if (task.workLeft === 0) {
    if (task.reworkPending) {
      task.reworkPending = false;
      task.workLeft = PARAMS.reworkExtraWork;
      result = 'rework';
    } else {
      task.done = true;
      next.individualValue += task.value;
      next.individualShipEvents += 1;
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
          next.setCompletionEvents += 1;
        }
      }
    }
  }
  next.history.push({ tick: next.tick, taskId: task.id, result });
  return next;
}

export function runPolicy(seed, condition, policy) {
  let state = createBoard(seed, condition);
  while (state.tick < state.deadline) {
    const taskId = policy.order.find((id) => !state.tasks.find((task) => task.id === id).done);
    state = tickBoard(state, taskId);
  }
  const accounting = assertAccounting(state);
  return {
    seed,
    conditionId: condition.id,
    policyId: policy.id,
    reworkPendingAtStart: createBoard(seed, condition)
      .tasks.filter((task) => task.role === 'migration')
      .map((task) => ({ id: task.id, reworkPending: task.reworkPending })),
    individualValue: accounting.individualValue,
    setReward: accounting.setReward,
    totalShippedValue: accounting.totalShippedValue,
    completedFeatureIds: state.completions.map((feature) => feature.featureId),
    individualShipEvents: accounting.individualShipEvents,
    setCompletionEvents: accounting.setCompletionEvents,
    completions: state.completions,
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
    history: state.history,
  };
}

export function summarizePolicies(seed, conditionId) {
  const condition = CONDITIONS[conditionId];
  return Object.values(POLICIES).map((policy) => runPolicy(seed, condition, policy));
}

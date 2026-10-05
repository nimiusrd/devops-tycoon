import { applyAction } from '../actions';
import { createOrgState } from '../org';
import { createRng, createRngFromState, getRngState } from '../rng';
import { createSprint, resolveSprintConfig, stepSprint } from '../sprint';
import type { InterventionOutcome, OrgState, SprintState } from '../types';

export type RescueAction = 'interruptReview' | 'andon' | 'firefight';
export type RescueOutcome = InterventionOutcome | { ok: false; reason: 'intervention-limit' };
export interface RescueState {
  kind: 'rescue-prototype';
  version: 1;
  challengeId: 'review-crisis-1';
  tick: number;
  limit: number;
  rngState: number;
  org: OrgState;
  sprint: SprintState;
  inputs: { tick: number; action: RescueAction; outcome: RescueOutcome }[];
}

/** 通常セーブの再開ではなく、seed・開始盤面を固定した課題を新規作成する。 */
export function createRescuePrototype(): RescueState {
  const rng = createRng('RI-264-review-crisis-1');
  const org = {
    ...createOrgState('default', true),
    seniorHp: 60,
    morale: 40,
    aiLiteracy: 25,
    testCoverage: 30,
    quality: 40,
  };
  const limit = 120;
  const sprint = createSprint(
    resolveSprintConfig('default', { taskCount: 20, focusMax: 9, maxTicks: limit + 1 }),
    org,
    rng,
  );
  for (const task of sprint.tasks) {
    if (task.id < 6) {
      task.kind = 'complex';
      task.lane = 'review';
      task.aiAssisted = true;
    } else if (task.id < 8) {
      task.lane = 'rework';
      task.incident = true;
      task.reworkAttempts = 1;
      task.burnTicksLeft = task.id === 6 ? 50 : 70;
    }
  }
  sprint.metrics.incidentCount = 2;
  return {
    kind: 'rescue-prototype',
    version: 1,
    challengeId: 'review-crisis-1',
    tick: 0,
    limit,
    rngState: getRngState(rng),
    org,
    sprint,
    inputs: [],
  };
}

/** 入力をtick開始時に適用。成功介入は最大3回で、既存の集中力・CDも適用する。 */
export function tickRescuePrototype(state: RescueState, action?: RescueAction): RescueState {
  if (state.tick >= state.limit || state.sprint.complete) return state;
  if (action !== undefined && !['interruptReview', 'andon', 'firefight'].includes(action)) {
    throw new Error('この課題では使えない介入');
  }
  const next: RescueState = structuredClone(state);
  const rng = createRngFromState(state.rngState);
  if (action !== undefined) {
    const successes = state.inputs.filter((input) => input.outcome.ok).length;
    const outcome: RescueOutcome =
      successes >= 3
        ? { ok: false, reason: 'intervention-limit' }
        : applyAction(action, next.sprint, next.org, rng, state.tick);
    next.inputs.push({ tick: state.tick, action, outcome });
  }
  next.tick += 1;
  stepSprint(next.sprint, next.org, rng, next.tick);
  next.rngState = getRngState(rng);
  return next;
}

export function summarizeRescue(state: RescueState) {
  const metrics = state.sprint.metrics;
  const burning = state.sprint.tasks.filter((task) => task.incident).length;
  const ended = state.tick >= state.limit || state.sprint.complete;
  return {
    ended,
    rescued:
      ended &&
      metrics.delivered >= 180 &&
      metrics.spread <= 2 &&
      state.org.seniorHp >= 10 &&
      burning === 0,
    delivered: Math.round(metrics.delivered * 100) / 100,
    spread: metrics.spread,
    burning,
    pending: state.sprint.tasks.filter((task) => task.lane !== 'done').length,
    seniorHp: Math.round(state.org.seniorHp * 100) / 100,
    morale: Math.round(state.org.morale * 100) / 100,
    interventions: metrics.interventionsUsed,
    focusSpent: metrics.focusSpent,
    tick: state.tick,
  };
}

export function compareRescueStrategies() {
  const strategies: { strategy: string; inputs: { tick: number; action: RescueAction }[] }[] = [
    { strategy: 'unattended', inputs: [] },
    {
      strategy: 'review-first',
      inputs: [
        { tick: 0, action: 'interruptReview' },
        { tick: 20, action: 'andon' },
        { tick: 40, action: 'firefight' },
      ],
    },
    {
      strategy: 'intake-first',
      inputs: [
        { tick: 0, action: 'andon' },
        { tick: 20, action: 'interruptReview' },
        { tick: 40, action: 'firefight' },
      ],
    },
    {
      strategy: 'fire-first',
      inputs: [
        { tick: 0, action: 'firefight' },
        { tick: 20, action: 'interruptReview' },
        { tick: 40, action: 'andon' },
      ],
    },
    {
      strategy: 'contain-and-review',
      inputs: [
        { tick: 0, action: 'firefight' },
        { tick: 20, action: 'interruptReview' },
        { tick: 60, action: 'firefight' },
      ],
    },
  ];
  return strategies.map(({ strategy, inputs }) => {
    let state = createRescuePrototype();
    while (!summarizeRescue(state).ended) {
      state = tickRescuePrototype(state, inputs.find((input) => input.tick === state.tick)?.action);
    }
    return { strategy, ...summarizeRescue(state), inputs: state.inputs };
  });
}

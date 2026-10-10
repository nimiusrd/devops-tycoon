/** RI-217: 基盤投資を platform の仕事にする。RI-216 の期間境界を共用する。 */

import { unlockedForNextPeriod, type TeamId } from './teamDependencies';

export const INVEST_YIELD: Record<TeamId, number> = { platform: 2, product: 3, incident: 4 };
export const JOB_TOTAL = 4;
export const START_COST = 2;
export const INSTANT_TICKS = 2;

export type InvestBoard = 'sprint' | 'quarter';
export type InvestStrategy = 'ship' | 'invest' | 'late' | 'immediate';
export type InvestInput =
  { type: 'start' } | { type: 'immediate' } | { type: 'work'; platform: 'ship' | 'build' };

export interface InvestState {
  version: 1;
  seed: string;
  board: InvestBoard;
  tick: number;
  horizon: number;
  budgetPaid: number;
  started: boolean;
  assignee: 'platform';
  jobWorkLeft: number;
  jobTotal: number;
  jobDoneTick: number | null;
  effectApplied: boolean;
  bonusTicks: number;
  instantLeft: number;
  targets: TeamId[];
  value: number;
  inputs: InvestInput[];
}

const HORIZON: Record<InvestBoard, number> = { sprint: 4, quarter: 8 };

export function createPlatformInvestment(seed: string, board: InvestBoard): InvestState {
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: HORIZON[board],
    budgetPaid: 0,
    started: false,
    assignee: 'platform',
    jobWorkLeft: JOB_TOTAL,
    jobTotal: JOB_TOTAL,
    jobDoneTick: null,
    effectApplied: false,
    bonusTicks: 0,
    instantLeft: 0,
    targets: ['product', 'incident'],
    value: 0,
    inputs: [],
  };
}

export function pipelineActive(state: InvestState): boolean {
  return state.effectApplied && unlockedForNextPeriod(state.jobDoneTick, state.tick);
}

/** 対象チームごとに効果は1。platform と、対象の重複には足さない。 */
export function teamCapacity(state: InvestState): Record<TeamId, number> {
  const capacity: Record<TeamId, number> = { platform: 1, product: 1, incident: 1 };
  if (!pipelineActive(state)) {
    if (state.instantLeft > 0) capacity.product += 1;
    return capacity;
  }
  for (const team of new Set(state.targets)) {
    if (team === 'platform') continue;
    capacity[team] += 1;
  }
  if (state.instantLeft > 0) capacity.product += 1;
  return capacity;
}

export function produceValue(
  state: InvestState,
  order: readonly TeamId[],
  platform: 'ship' | 'build',
): number {
  const capacity = teamCapacity(state);
  const building = platform === 'build' && state.started && state.jobDoneTick === null;
  return order.reduce((sum, team) => {
    if (building && team === 'platform') return sum;
    return sum + capacity[team] * INVEST_YIELD[team];
  }, 0);
}

export function applyPlatformInvestment(state: InvestState, input: InvestInput): InvestState {
  if (input.type === 'start') {
    if (
      state.started ||
      state.instantLeft > 0 ||
      state.budgetPaid > 0 ||
      state.tick >= state.horizon
    ) {
      return state;
    }
    const next = structuredClone(state);
    next.started = true;
    next.budgetPaid = START_COST;
    next.inputs.push({ type: 'start' });
    return next;
  }
  if (input.type === 'immediate') {
    if (
      state.started ||
      state.instantLeft > 0 ||
      state.budgetPaid > 0 ||
      state.tick >= state.horizon
    ) {
      return state;
    }
    const next = structuredClone(state);
    next.budgetPaid = START_COST;
    next.instantLeft = INSTANT_TICKS;
    next.inputs.push({ type: 'immediate' });
    return next;
  }
  if (input.type !== 'work' || state.tick >= state.horizon) return state;
  if (input.platform === 'build' && !state.started) return state;
  const building = input.platform === 'build' && state.jobDoneTick === null;
  const next = structuredClone(state);
  if (pipelineActive(next)) next.bonusTicks += 1;
  next.value += produceValue(
    next,
    ['platform', 'product', 'incident'],
    building ? 'build' : 'ship',
  );
  if (building) {
    next.jobWorkLeft = Math.max(0, next.jobWorkLeft - teamCapacity(next).platform);
    if (next.jobWorkLeft === 0 && next.jobDoneTick === null) {
      next.jobDoneTick = next.tick;
      next.effectApplied = true;
    }
  }
  if (next.instantLeft > 0) next.instantLeft -= 1;
  next.tick += 1;
  next.inputs.push({ type: 'work', platform: building ? 'build' : 'ship' });
  return next;
}

export function viewPlatformInvestment(state: InvestState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    startCost: START_COST,
    assignee: state.assignee,
    workLeft: state.jobWorkLeft,
    jobTotal: state.jobTotal,
    targets: [...state.targets],
    effectApplied: state.effectApplied,
    effectLive: pipelineActive(state) && state.tick < state.horizon,
    capacity: teamCapacity(state),
    budgetPaid: state.budgetPaid,
    bonusTicks: state.bonusTicks,
  };
}

export function summarizePlatformInvestment(state: InvestState) {
  return {
    value: state.value,
    budgetPaid: state.budgetPaid,
    score: state.value - state.budgetPaid,
    jobWorkLeft: state.jobWorkLeft,
    jobDoneTick: state.jobDoneTick,
    effectApplied: state.effectApplied,
    bonusTicks: state.bonusTicks,
    lost: false,
  };
}

export function chooseInvestmentAction(state: InvestState, strategy: InvestStrategy): InvestInput {
  if (strategy === 'immediate') {
    if (state.budgetPaid === 0) return { type: 'immediate' };
    return { type: 'work', platform: 'ship' };
  }
  if (strategy === 'ship') return { type: 'work', platform: 'ship' };
  if (strategy === 'late' && state.tick < 2 && !state.started)
    return { type: 'work', platform: 'ship' };
  if (!state.started) return { type: 'start' };
  if (state.jobDoneTick === null) return { type: 'work', platform: 'build' };
  return { type: 'work', platform: 'ship' };
}

export function comparePlatformInvestments(seed = 'RI-217') {
  return (['sprint', 'quarter'] as const).flatMap((board) =>
    (['ship', 'invest', 'late', 'immediate'] as const).map((strategy) => {
      const initial = createPlatformInvestment(seed, board);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 30) throw new Error(`${board}:${strategy}`);
        const input = chooseInvestmentAction(state, strategy);
        const next = applyPlatformInvestment(state, input);
        if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
        state = next;
      }
      return {
        board,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizePlatformInvestment(state),
      };
    }),
  );
}

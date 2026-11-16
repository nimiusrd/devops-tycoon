/** RI-217: 基盤投資を platform の仕事にする。RI-216 の期間境界を共用する。 */

import { unlockedForNextPeriod, type TeamId } from './teamDependencies';

export const INVEST_YIELD: Record<TeamId, number> = { platform: 2, product: 3, incident: 4 };
export const JOB_TOTAL = 4;
export const START_COST = 2;
export const INSTANT_TICKS = 2;
/** 即時レバーの費用。初回の2。着工費用の感度では動かさない。 */
export const INSTANT_COST = 2;

/** 初回比較の規則。感度ではこの三つを一つずつ動かす。 */
export interface InvestRules {
  startCost: number;
  jobTotal: number;
  instantTicks: number;
}

export const baselineInvestRules: InvestRules = {
  startCost: START_COST,
  jobTotal: JOB_TOTAL,
  instantTicks: INSTANT_TICKS,
};

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

export function createPlatformInvestment(
  seed: string,
  board: InvestBoard,
  rules: InvestRules = baselineInvestRules,
): InvestState {
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: HORIZON[board],
    budgetPaid: 0,
    started: false,
    assignee: 'platform',
    jobWorkLeft: rules.jobTotal,
    jobTotal: rules.jobTotal,
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

export function applyPlatformInvestment(
  state: InvestState,
  input: InvestInput,
  rules: InvestRules = baselineInvestRules,
): InvestState {
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
    next.budgetPaid = rules.startCost;
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
    next.budgetPaid = INSTANT_COST;
    next.instantLeft = rules.instantTicks;
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

export function viewPlatformInvestment(
  state: InvestState,
  rules: InvestRules = baselineInvestRules,
) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    startCost: rules.startCost,
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

const FACTOR_SEED = 'RI-217';
const FACTOR_BOARDS = ['sprint', 'quarter'] as const;
type FrontStrategy = 'ship' | 'immediate';
type FactorStrategy = 'invest' | FrontStrategy;
export type InvestPreference = 'invest' | 'ship' | 'immediate' | 'tie';

export interface InvestFactorRun {
  inputs: InvestInput[];
  result: ReturnType<typeof summarizePlatformInvestment>;
}

export interface InvestOpponentComparison {
  opponent: FrontStrategy;
  preference: InvestPreference;
  margin: number;
  front: InvestFactorRun;
}

export interface InvestFactorBoard {
  board: InvestBoard;
  invest: InvestFactorRun;
  opponents: InvestOpponentComparison[];
}

export interface InvestFactorPoint {
  axis: string;
  parameter: string;
  rules: InvestRules;
  boards: InvestFactorBoard[];
}

export interface InvestFactorReversal {
  axis: string;
  board: InvestBoard;
  opponent: FrontStrategy;
  before: { parameter: string; preference: InvestPreference; invest: number; front: number };
  after: { parameter: string; preference: InvestPreference; invest: number; front: number };
}

function cloneRules(rules: InvestRules): InvestRules {
  return { ...rules };
}

function withRules(patch: Partial<InvestRules>): InvestRules {
  return { ...baselineInvestRules, ...patch };
}

function preferenceOf(invest: number, front: number, opponent: FrontStrategy): InvestPreference {
  if (invest > front) return 'invest';
  if (front > invest) return opponent;
  return 'tie';
}

function runInvest(
  board: InvestBoard,
  strategy: FactorStrategy,
  rules: InvestRules,
): InvestFactorRun {
  let state = createPlatformInvestment(FACTOR_SEED, board, rules);
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 30) throw new Error(`${board}:${strategy}`);
    const input = chooseInvestmentAction(state, strategy);
    const next = applyPlatformInvestment(state, input, rules);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { inputs: state.inputs, result: summarizePlatformInvestment(state) };
}

function factorPoint(axis: string, parameter: string, rules: InvestRules): InvestFactorPoint {
  const boards = FACTOR_BOARDS.map((board) => {
    const invest = runInvest(board, 'invest', rules);
    const opponents = (['ship', 'immediate'] as const).map((opponent) => {
      const front = runInvest(board, opponent, rules);
      const investScore = invest.result.score;
      const frontScore = front.result.score;
      return {
        opponent,
        preference: preferenceOf(investScore, frontScore, opponent),
        margin: investScore - frontScore,
        front,
      };
    });
    return { board, invest, opponents };
  });
  return { axis, parameter, rules: cloneRules(rules), boards };
}

function reversalsOf(rows: InvestFactorPoint[]): InvestFactorReversal[] {
  const found: InvestFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after) continue;
    for (const board of FACTOR_BOARDS) {
      const earlier = before.boards.find((item) => item.board === board);
      const later = after.boards.find((item) => item.board === board);
      if (!earlier || !later) continue;
      for (const opponent of ['ship', 'immediate'] as const) {
        const early = earlier.opponents.find((item) => item.opponent === opponent);
        const late = later.opponents.find((item) => item.opponent === opponent);
        if (!early || !late || early.preference === late.preference) continue;
        found.push({
          axis: before.axis,
          board,
          opponent,
          before: {
            parameter: before.parameter,
            preference: early.preference,
            invest: earlier.invest.result.score,
            front: early.front.result.score,
          },
          after: {
            parameter: after.parameter,
            preference: late.preference,
            invest: later.invest.result.score,
            front: late.front.result.score,
          },
        });
      }
    }
  }
  return found;
}

/** 初回と同じ資源で、着工費用・残作業・即時の持続期間を一つずつ動かす。固定戦略。 */
export function comparePlatformInvestmentFactorReversals() {
  const sweeps = {
    startCost: [0, 2, 8, 15, 16, 17, 19, 20, 21].map((startCost) =>
      factorPoint('startCost', String(startCost), withRules({ startCost })),
    ),
    jobTotal: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((jobTotal) =>
      factorPoint('jobTotal', String(jobTotal), withRules({ jobTotal })),
    ),
    instantTicks: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((instantTicks) =>
      factorPoint('instantTicks', String(instantTicks), withRules({ instantTicks })),
    ),
  };
  return {
    conditions: {
      seed: FACTOR_SEED,
      boards: [...FACTOR_BOARDS],
      horizons: { sprint: 4, quarter: 8 },
      yields: {
        platform: INVEST_YIELD.platform,
        product: INVEST_YIELD.product,
        incident: INVEST_YIELD.incident,
      },
      baseCapacity: 1,
      targets: ['product', 'incident'] as TeamId[],
      instantCost: INSTANT_COST,
      decision: {
        invest: 'invest',
        front: ['ship', 'immediate'] as FrontStrategy[],
        score: 'value - budgetPaid',
        preference: '投資の差引が大きいとき投資、目の前が大きいとき出荷または即時、同じとき同点',
      },
      baseline: cloneRules(baselineInvestRules),
      held: {
        startCost: '着工費用だけを動かす。残作業4、即時は2期間、即時の費用は2',
        jobTotal: '残作業だけを動かす。着工費用2、即時は2期間、即時の費用は2',
        instantTicks: '即時の持続期間だけを動かす。着工費用2、残作業4、即時の費用は2',
      },
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    },
    sweeps,
    reversals: Object.values(sweeps).flatMap((rows) => reversalsOf(rows)),
  };
}

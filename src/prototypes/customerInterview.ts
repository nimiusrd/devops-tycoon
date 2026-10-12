/** RI-231: 聞き取りは1期間の余力を使う。真の需要は閲覧へ出さない。RI-229 の顧客構成を使う。 */

import { rosterOf, type CustomerRoster } from './customerSegments';
import { applyFeatureWork, PRODUCT_CAPACITY } from './productGrowth';

export type InterviewFeature = 'api' | 'screen' | 'billing';
export type InterviewBoard = 'urgent' | 'uncertain' | 'mislead';
export type InterviewStrategy = 'rush' | 'ask' | 'askMiss';
export type InterviewInput =
  { type: 'ask' } | { type: 'build'; feature: InterviewFeature } | { type: 'view' };

export interface InterviewState {
  version: 1;
  seed: string;
  board: InterviewBoard;
  tick: number;
  horizon: number;
  capacity: number;
  deadline: number;
  needed: InterviewFeature;
  clueLikely: InterviewFeature;
  clueOther: InterviewFeature;
  rumor: InterviewFeature;
  speaker: CustomerRoster;
  asked: boolean;
  likely: InterviewFeature | null;
  unconfirmed: InterviewFeature | null;
  progress: Record<InterviewFeature, number>;
  delivered: boolean;
  value: number;
  late: number;
  listenCost: number;
  inputs: InterviewInput[];
}

const NEED = 4;
const VALUE = 12;
const LATE_PENALTY = 10;
const FEATURES: readonly InterviewFeature[] = ['api', 'screen', 'billing'];

const BOARDS: Record<
  InterviewBoard,
  {
    needed: InterviewFeature;
    clueLikely: InterviewFeature;
    clueOther: InterviewFeature;
    deadline: number;
    speaker: 'pioneer' | 'keeper';
  }
> = {
  urgent: {
    needed: 'api',
    clueLikely: 'api',
    clueOther: 'billing',
    deadline: 1,
    speaker: 'pioneer',
  },
  uncertain: {
    needed: 'screen',
    clueLikely: 'screen',
    clueOther: 'billing',
    deadline: 3,
    speaker: 'keeper',
  },
  mislead: {
    needed: 'billing',
    clueLikely: 'screen',
    clueOther: 'billing',
    deadline: 3,
    speaker: 'keeper',
  },
};

function isFeature(value: string): value is InterviewFeature {
  return FEATURES.includes(value as InterviewFeature);
}

export function createCustomerInterview(seed: string, board: InterviewBoard): InterviewState {
  const preset = BOARDS[board];
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 3,
    capacity: PRODUCT_CAPACITY,
    deadline: preset.deadline,
    needed: preset.needed,
    clueLikely: preset.clueLikely,
    clueOther: preset.clueOther,
    rumor: 'api',
    speaker: rosterOf(preset.speaker),
    asked: false,
    likely: null,
    unconfirmed: null,
    progress: { api: 0, screen: 0, billing: 0 },
    delivered: false,
    value: 0,
    late: 0,
    listenCost: 0,
    inputs: [],
  };
}

/** 聞き取りは一度だけ期間を使い、候補を狭める。真の需要そのものは返さない。 */
export function applyCustomerInterview(
  state: InterviewState,
  input: InterviewInput,
): InterviewState {
  if (input.type === 'view' || state.tick >= state.horizon) return state;
  if (input.type === 'ask') {
    if (state.asked) return state;
    const next = structuredClone(state);
    next.asked = true;
    next.likely = next.clueLikely;
    next.unconfirmed = next.clueOther;
    next.listenCost += next.capacity;
    next.tick += 1;
    next.inputs.push({ type: 'ask' });
    return next;
  }
  if (input.type !== 'build' || !isFeature(input.feature)) return state;
  const next = structuredClone(state);
  const applied = applyFeatureWork(next.progress[input.feature], NEED, next.capacity);
  next.progress[input.feature] = applied.done;
  if (applied.completed && input.feature === next.needed && !next.delivered) {
    next.delivered = true;
    next.value += VALUE;
    if (next.tick >= next.deadline) next.late += LATE_PENALTY;
  }
  next.tick += 1;
  next.inputs.push({ type: 'build', feature: input.feature });
  return next;
}

export function viewCustomerInterview(state: InterviewState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    capacity: state.capacity,
    deadline: state.deadline,
    rumor: state.rumor,
    speaker: { ...state.speaker },
    asked: state.asked,
    likely: state.likely,
    unconfirmed: state.unconfirmed,
    unknowns: state.asked ? (['unconfirmed-feature'] as const) : (['needed-feature'] as const),
    valueIfRight: VALUE,
    latePenalty: LATE_PENALTY,
  };
}

export function summarizeCustomerInterview(state: InterviewState) {
  return {
    value: state.value,
    late: state.late,
    listenCost: state.listenCost,
    delivered: state.delivered,
    score: state.value - state.late,
    lost: false,
  };
}

export function chooseInterviewAction(
  state: InterviewState,
  strategy: InterviewStrategy,
): InterviewInput {
  if (strategy === 'rush') return { type: 'build', feature: state.rumor };
  if (!state.asked || state.likely === null || state.unconfirmed === null) return { type: 'ask' };
  return { type: 'build', feature: strategy === 'ask' ? state.likely : state.unconfirmed };
}

export function compareCustomerInterviews(seed = 'RI-231') {
  return (['urgent', 'uncertain', 'mislead'] as const).flatMap((board) =>
    (['rush', 'ask', 'askMiss'] as const).map((strategy) => {
      const initial = createCustomerInterview(seed, board);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 10) throw new Error(`${board}:${strategy}`);
        const input = chooseInterviewAction(state, strategy);
        const next = applyCustomerInterview(state, input);
        if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
        state = next;
      }
      return {
        board,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeCustomerInterview(state),
      };
    }),
  );
}

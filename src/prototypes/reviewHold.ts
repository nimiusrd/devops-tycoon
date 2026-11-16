/** RI-173: 既定は保留1枠。別スプリントへの持越しは提供しない。 */

export interface HoldJob {
  id: string;
  stage: 'review' | 'held' | 'done';
  difficult: boolean;
  reviewLeft: number;
  value: number;
  deadline: number;
  qualityCost: number | null;
  completedTick: number | null;
}

export type HoldInput =
  { type: 'hold' | 'resume'; id: string } | { type: 'rush' } | { type: 'tick' };

/** 比較で一つずつ動かす規則。状態に無いときは baselineHoldRules。 */
export interface HoldRules {
  holdCapacity: number;
  returnPosition: 'origin' | 'tail';
  assignees: number;
  /** 着手済み（qualityCost 記録済み）の保留で、操作の集中力1に加えて払う集中力。未着手は払わない。 */
  interruptCost: number;
}

export const baselineHoldRules: HoldRules = {
  holdCapacity: 1,
  returnPosition: 'origin',
  assignees: 1,
  interruptCost: 0,
};

export interface HoldState {
  version: 1;
  seed: string;
  tick: number;
  horizon: number;
  recoveryPerTick: number;
  energy: number;
  energySpent: number;
  focus: number;
  focusSpent: number;
  jobs: HoldJob[];
  inputs: HoldInput[];
  /** 無いときは初回と同じ規則。初回の比較JSONはこのフィールドを持たない。 */
  rules?: HoldRules;
}

type HoldStrategy = 'fifo' | 'hold-recover' | 'hold-forever' | 'rush';

function rulesOf(state: HoldState): HoldRules {
  return state.rules ?? baselineHoldRules;
}

function interruptFocus(state: HoldState, input: HoldInput): number {
  if (input.type !== 'hold') return 0;
  const job = state.jobs.find((candidate) => candidate.id === input.id);
  return job?.qualityCost !== null ? rulesOf(state).interruptCost : 0;
}

export function createHoldPrototype(
  seed: string,
  deadline = 6,
  recoveryPerTick = 1,
  rules?: HoldRules,
): HoldState {
  return {
    version: 1,
    seed,
    tick: 0,
    horizon: 6,
    recoveryPerTick,
    energy: 2,
    energySpent: 0,
    focus: 6,
    focusSpent: 0,
    jobs: [
      { id: 'hard', difficult: true, value: 16, deadline, reviewLeft: 2 },
      { id: 'easy-a', difficult: false, value: 4, deadline: 6, reviewLeft: 1 },
      { id: 'easy-b', difficult: false, value: 4, deadline: 6, reviewLeft: 1 },
    ].map((job) => ({ ...job, stage: 'review', qualityCost: null, completedTick: null })),
    inputs: [],
    ...(rules ? { rules: { ...rules } } : {}),
  };
}

function review(state: HoldState, job: HoldJob, work: number) {
  // 着手時の品質を固定し、保留/復帰で途中レビューの危険を洗い流さない。
  if (job.qualityCost === null) job.qualityCost = job.difficult && state.energy < 4 ? 12 : 0;
  if (job.difficult) {
    state.energy = Math.max(0, state.energy - work * 2);
    state.energySpent += work * 2;
  }
  job.reviewLeft -= work;
  if (job.reviewLeft === 0) {
    job.stage = 'done';
    job.completedTick = state.tick;
  }
}

export function applyHoldInput(state: HoldState, input: HoldInput): HoldState {
  const rules = rulesOf(state);
  if (state.tick >= state.horizon) return state;
  if (input.type === 'hold' || input.type === 'resume') {
    const job = state.jobs.find((candidate) => candidate.id === input.id);
    const expected = input.type === 'hold' ? 'review' : 'held';
    if (!job || state.focus < 1 + interruptFocus(state, input) || job.stage !== expected)
      return state;
    if (
      input.type === 'hold' &&
      state.jobs.filter((candidate) => candidate.stage === 'held').length >= rules.holdCapacity
    ) {
      return state;
    }
  }
  if (
    input.type === 'rush' &&
    (state.focus < 3 || !state.jobs.some((job) => job.stage === 'review'))
  )
    return state;
  const next = structuredClone(state);
  if (input.type === 'hold' || input.type === 'resume') {
    const job = next.jobs.find((candidate) => candidate.id === input.id)!;
    const extra = interruptFocus(state, input);
    job.stage = input.type === 'hold' ? 'held' : 'review';
    if (input.type === 'resume' && rules.returnPosition === 'tail') {
      const index = next.jobs.findIndex((candidate) => candidate.id === input.id);
      if (index >= 0) {
        const [moved] = next.jobs.splice(index, 1);
        if (moved) next.jobs.push(moved);
      }
    }
    next.focus -= 1 + extra;
    next.focusSpent += 1 + extra;
  } else if (input.type === 'rush') {
    next.focus -= 3;
    next.focusSpent += 3;
    for (const job of next.jobs.filter((candidate) => candidate.stage === 'review').slice(0, 2))
      review(next, job, job.reviewLeft);
  } else {
    next.tick++;
    const active = next.jobs.filter((job) => job.stage === 'review').slice(0, rules.assignees);
    for (const job of active) review(next, job, 1);
    // 簡単な仕事は別担当。シニアは難しいレビューをしていないtickで回復する。
    if (!active.some((job) => job.difficult))
      next.energy = Math.min(4, next.energy + next.recoveryPerTick);
  }
  next.inputs.push(structuredClone(input));
  return next;
}

export function summarizeHold(state: HoldState) {
  const done = state.jobs.filter((job) => job.stage === 'done');
  const value = done.reduce(
    (sum, job) => sum + (job.completedTick! <= job.deadline ? job.value : 2),
    0,
  );
  const qualityCost = done.reduce((sum, job) => sum + job.qualityCost!, 0);
  return {
    value,
    qualityCost,
    energy: state.energy,
    energySpent: state.energySpent,
    focusSpent: state.focusSpent,
    heldCount: state.jobs.filter((job) => job.stage === 'held').length,
    doneCount: done.length,
    unfinishedValue: state.jobs
      .filter((job) => job.stage !== 'done')
      .reduce((sum, job) => sum + job.value, 0),
    jobs: state.jobs,
    netValue: value - qualityCost - state.focusSpent - state.energySpent,
  };
}

function runStrategy(initial: HoldState, strategy: HoldStrategy) {
  let state = strategy.startsWith('hold')
    ? applyHoldInput(initial, { type: 'hold', id: 'hard' })
    : strategy === 'rush'
      ? applyHoldInput(initial, { type: 'rush' })
      : initial;
  while (state.tick < state.horizon) {
    if (strategy === 'hold-recover' && state.tick === 2)
      state = applyHoldInput(state, { type: 'resume', id: 'hard' });
    state = applyHoldInput(state, { type: 'tick' });
  }
  return state;
}

export function compareHoldStrategies(seed: string) {
  return [
    { deadline: 6, recovery: 1 },
    { deadline: 2, recovery: 1 },
    { deadline: 6, recovery: 0 },
  ].flatMap(({ deadline, recovery }) =>
    (['fifo', 'hold-recover', 'hold-forever', 'rush'] as const).map((strategy) => {
      const initial = createHoldPrototype(seed, deadline, recovery);
      const state = runStrategy(initial, strategy);
      return {
        deadline,
        recovery,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeHold(state),
      };
    }),
  );
}

const factorMoves = [
  { factor: 'baseline', rules: baselineHoldRules },
  { factor: 'holdCapacity', rules: { ...baselineHoldRules, holdCapacity: 2 } },
  { factor: 'returnPosition', rules: { ...baselineHoldRules, returnPosition: 'tail' as const } },
  { factor: 'assignees', rules: { ...baselineHoldRules, assignees: 2 } },
  { factor: 'interruptCost', rules: { ...baselineHoldRules, interruptCost: 1 } },
] as const;

/** 期限6・回復1の盤面だけ。要因は隣の値へ一つずつ。永久保留は走らせない。 */
export function compareHoldFactorReversals(seed: string) {
  return factorMoves.flatMap(({ factor, rules }) =>
    (['fifo', 'hold-recover'] as const).map((strategy) => {
      const initial = createHoldPrototype(seed, 6, 1, rules);
      const state = runStrategy(initial, strategy);
      return { factor, strategy, initial, inputs: state.inputs, result: summarizeHold(state) };
    }),
  );
}

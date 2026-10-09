/** RI-173: 保留1枠。別スプリントへの持越しは提供しない。 */
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
  | { type: 'hold' | 'resume'; id: string }
  | { type: 'rush' }
  | { type: 'tick' };
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
}
export function createHoldPrototype(seed: string, deadline = 6, recoveryPerTick = 1): HoldState {
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
  if (state.tick >= state.horizon) return state;
  if (input.type === 'hold' || input.type === 'resume') {
    const job = state.jobs.find((j) => j.id === input.id);
    if (!job || state.focus < 1 || job.stage !== (input.type === 'hold' ? 'review' : 'held'))
      return state;
    if (input.type === 'hold' && state.jobs.some((j) => j.stage === 'held')) return state;
  }
  if (input.type === 'rush' && (state.focus < 3 || !state.jobs.some((j) => j.stage === 'review')))
    return state;
  const next = structuredClone(state);
  if (input.type === 'hold' || input.type === 'resume') {
    next.jobs.find((j) => j.id === input.id)!.stage = input.type === 'hold' ? 'held' : 'review';
    next.focus--;
    next.focusSpent++;
  } else if (input.type === 'rush') {
    next.focus -= 3;
    next.focusSpent += 3;
    for (const job of next.jobs.filter((j) => j.stage === 'review').slice(0, 2))
      review(next, job, job.reviewLeft);
  } else {
    next.tick++;
    const job = next.jobs.find((j) => j.stage === 'review');
    if (job) review(next, job, 1);
    // 簡単な仕事は別担当。シニアは難しいレビューをしていないtickで回復する。
    if (!job?.difficult) next.energy = Math.min(4, next.energy + next.recoveryPerTick);
  }
  next.inputs.push(structuredClone(input));
  return next;
}
export function summarizeHold(state: HoldState) {
  const done = state.jobs.filter((j) => j.stage === 'done');
  const value = done.reduce((sum, j) => sum + (j.completedTick! <= j.deadline ? j.value : 2), 0);
  const qualityCost = done.reduce((sum, j) => sum + j.qualityCost!, 0);
  return {
    value,
    qualityCost,
    energy: state.energy,
    energySpent: state.energySpent,
    focusSpent: state.focusSpent,
    heldCount: state.jobs.filter((j) => j.stage === 'held').length,
    doneCount: done.length,
    unfinishedValue: state.jobs
      .filter((j) => j.stage !== 'done')
      .reduce((sum, j) => sum + j.value, 0),
    jobs: state.jobs,
    netValue: value - qualityCost - state.focusSpent - state.energySpent,
  };
}
export function compareHoldStrategies(seed: string) {
  return [
    { deadline: 6, recovery: 1 },
    { deadline: 2, recovery: 1 },
    { deadline: 6, recovery: 0 },
  ].flatMap(({ deadline, recovery }) =>
    (['fifo', 'hold-recover', 'hold-forever', 'rush'] as const).map((strategy) => {
      const initial = createHoldPrototype(seed, deadline, recovery);
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

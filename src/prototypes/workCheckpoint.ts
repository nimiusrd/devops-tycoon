/** RI-175: Coding枠1。中断進捗はsavedに残し、intakeの0初期化では戻さない。 */
export interface CheckpointJob {
  id: string;
  kind: 'feature' | 'urgent';
  work: number;
  progress: number;
  value: number;
  deadline: number;
  lateValue: number;
  missPenalty: number;
  stage: 'coding' | 'saved' | 'backlog' | 'done';
  completedTick: number | null;
}
export type CheckpointInput =
  | { type: 'work' | 'checkpoint' | 'resume' | 'reset' | 'wait' }
  | { type: 'start' | 'restart'; id: string };
export type CheckpointStrategy = 'continue' | 'checkpoint' | 'reset' | 'restart';
export interface CheckpointState {
  version: 1;
  seed: string;
  tick: number;
  horizon: number;
  focus: number;
  focusSpent: number;
  jobs: CheckpointJob[];
  inputs: CheckpointInput[];
}
export function createCheckpointPrototype(seed: string, progress: number): CheckpointState {
  return {
    version: 1,
    seed,
    tick: 0,
    horizon: 8,
    focus: 4,
    focusSpent: 0,
    jobs: [
      {
        id: 'feature',
        kind: 'feature',
        work: 6,
        progress,
        value: 22,
        deadline: 7,
        lateValue: 4,
        missPenalty: 0,
        stage: 'coding',
        completedTick: null,
      },
      {
        id: 'urgent',
        kind: 'urgent',
        work: 2,
        progress: 0,
        value: 14,
        deadline: 3,
        lateValue: 0,
        missPenalty: 6,
        stage: 'backlog',
        completedTick: null,
      },
    ],
    inputs: [],
  };
}
function activeJob(state: CheckpointState) {
  return state.jobs.find((job) => job.stage === 'coding');
}
export function applyCheckpointInput(
  state: CheckpointState,
  input: CheckpointInput,
): CheckpointState {
  if (state.tick >= state.horizon) return state;
  const active = activeJob(state);
  const target = 'id' in input ? state.jobs.find((job) => job.id === input.id) : undefined;
  if (input.type === 'work' && !active) return state;
  if (
    input.type === 'checkpoint' &&
    (!active || active.progress <= 0 || active.progress >= active.work || state.focus < 1)
  )
    return state;
  if (input.type === 'resume') {
    const saved = state.jobs.find((job) => job.stage === 'saved');
    if (active || !saved || state.focus < 1) return state;
  }
  if (input.type === 'reset' && (!active || active.progress <= 0)) return state;
  if (input.type === 'start' && (active || !target || target.stage !== 'backlog')) return state;
  if (input.type === 'restart' && (active || !target || target.stage !== 'saved')) return state;
  const next = structuredClone(state);
  const spendTick = input.type !== 'start';
  if (input.type === 'work') {
    const job = next.jobs.find((item) => item.stage === 'coding')!;
    job.progress += 1;
    if (job.progress >= job.work) {
      job.stage = 'done';
      job.completedTick = next.tick + 1;
    }
  } else if (input.type === 'checkpoint') {
    next.jobs.find((item) => item.stage === 'coding')!.stage = 'saved';
    next.focus -= 1;
    next.focusSpent += 1;
  } else if (input.type === 'resume') {
    next.jobs.find((item) => item.stage === 'saved')!.stage = 'coding';
    next.focus -= 1;
    next.focusSpent += 1;
  } else if (input.type === 'reset') {
    const job = next.jobs.find((item) => item.stage === 'coding')!;
    job.progress = 0;
    job.stage = 'backlog';
  } else if (input.type === 'restart') {
    const job = next.jobs.find((item) => item.id === input.id)!;
    job.progress = 0;
    job.stage = 'coding';
  } else if (input.type === 'start') {
    const job = next.jobs.find((item) => item.id === input.id)!;
    job.progress = 0;
    job.stage = 'coding';
  }
  if (spendTick) next.tick += 1;
  next.inputs.push(structuredClone(input));
  return next;
}
export function summarizeCheckpoint(state: CheckpointState) {
  let value = 0;
  let penalty = 0;
  for (const job of state.jobs) {
    const onTime = job.completedTick !== null && job.completedTick <= job.deadline;
    if (job.stage === 'done') value += onTime ? job.value : job.lateValue;
    if (job.kind === 'urgent' && !onTime && (job.stage === 'done' || state.tick >= state.horizon))
      penalty += job.missPenalty;
  }
  const feature = state.jobs.find((job) => job.id === 'feature')!;
  const urgent = state.jobs.find((job) => job.id === 'urgent')!;
  return {
    value,
    penalty,
    focusSpent: state.focusSpent,
    slotFree: state.jobs.every((job) => job.stage !== 'coding'),
    featureProgress: feature.progress,
    featureStage: feature.stage,
    urgentCompletedTick: urgent.completedTick,
    unfinishedValue: state.jobs
      .filter((job) => job.stage !== 'done')
      .reduce((sum, job) => sum + job.value, 0),
    netValue: value - penalty - state.focusSpent,
  };
}
export function chooseCheckpointAction(
  state: CheckpointState,
  strategy: CheckpointStrategy,
): CheckpointInput {
  const feature = state.jobs.find((job) => job.id === 'feature')!;
  const urgent = state.jobs.find((job) => job.id === 'urgent')!;
  const active = activeJob(state);
  const urgentWaiting = urgent.stage === 'backlog';
  if (strategy === 'continue') {
    if (active) return { type: 'work' };
    if (urgentWaiting) return { type: 'start', id: 'urgent' };
    if (feature.stage === 'backlog') return { type: 'start', id: 'feature' };
    return { type: 'wait' };
  }
  if (strategy === 'checkpoint' || strategy === 'restart') {
    if (active?.id === 'feature' && urgentWaiting) return { type: 'checkpoint' };
    if (!active && urgentWaiting) return { type: 'start', id: 'urgent' };
    if (active?.id === 'urgent') return { type: 'work' };
    if (!active && feature.stage === 'saved')
      return strategy === 'checkpoint' ? { type: 'resume' } : { type: 'restart', id: 'feature' };
    if (active) return { type: 'work' };
    return { type: 'wait' };
  }
  if (active?.id === 'feature' && feature.progress > 0 && urgentWaiting) return { type: 'reset' };
  if (!active && urgentWaiting) return { type: 'start', id: 'urgent' };
  if (active?.id === 'urgent') return { type: 'work' };
  if (!active && feature.stage === 'backlog') return { type: 'start', id: 'feature' };
  if (active) return { type: 'work' };
  return { type: 'wait' };
}
export function compareCheckpointStrategies(seed: string) {
  return ([4, 1] as const).flatMap((progress) =>
    (['continue', 'checkpoint', 'reset', 'restart'] as const).map((strategy) => {
      const initial = createCheckpointPrototype(seed, progress);
      let state = initial;
      while (state.tick < state.horizon) {
        const next = applyCheckpointInput(state, chooseCheckpointAction(state, strategy));
        if (next === state) throw new Error(`${strategy}:${progress} tick ${state.tick}`);
        state = next;
      }
      return {
        progress,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeCheckpoint(state),
      };
    }),
  );
}

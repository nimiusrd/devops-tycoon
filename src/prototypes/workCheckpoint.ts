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
  stage: 'coding' | 'saved' | 'backlog' | 'done' | 'upcoming';
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
  /** 複数tickの再開で、残りtickがあるあいだだけ持つ。基準の1tick再開では付けない。 */
  resumeLeft?: number;
}
/** 初回比較の資源。容量6は未完了の進捗を削らない。再開は1tick。緊急はtick0からbacklog。 */
export interface CheckpointRules {
  saveCapacity: number;
  resumeTicks: number;
  urgentAppears: number;
}
export const baselineCheckpointRules: CheckpointRules = {
  saveCapacity: 6,
  resumeTicks: 1,
  urgentAppears: 0,
};
export function createCheckpointPrototype(
  seed: string,
  progress: number,
  rules: CheckpointRules = baselineCheckpointRules,
): CheckpointState {
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
        stage: rules.urgentAppears > 0 ? 'upcoming' : 'backlog',
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
  rules: CheckpointRules = baselineCheckpointRules,
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
    const continuing = (state.resumeLeft ?? 0) > 0;
    if (active || !saved || (!continuing && state.focus < 1)) return state;
  }
  if (input.type === 'reset' && (!active || active.progress <= 0)) return state;
  if (input.type === 'start' && (active || !target || target.stage !== 'backlog')) return state;
  if (input.type === 'restart' && (active || !target || target.stage !== 'saved')) return state;
  const next = structuredClone(state);
  const spendTick = input.type !== 'start' && !(input.type === 'resume' && rules.resumeTicks <= 0);
  if (input.type === 'work') {
    const job = next.jobs.find((item) => item.stage === 'coding')!;
    job.progress += 1;
    if (job.progress >= job.work) {
      job.stage = 'done';
      job.completedTick = next.tick + 1;
    }
  } else if (input.type === 'checkpoint') {
    const job = next.jobs.find((item) => item.stage === 'coding')!;
    job.stage = 'saved';
    job.progress = Math.min(job.progress, rules.saveCapacity);
    next.focus -= 1;
    next.focusSpent += 1;
  } else if (input.type === 'resume') {
    const job = next.jobs.find((item) => item.stage === 'saved')!;
    if ((state.resumeLeft ?? 0) === 0) {
      next.focus -= 1;
      next.focusSpent += 1;
    }
    const left = (state.resumeLeft ?? rules.resumeTicks) - 1;
    if (left <= 0) {
      delete next.resumeLeft;
      job.stage = 'coding';
    } else next.resumeLeft = left;
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
  const urgent = next.jobs.find((job) => job.id === 'urgent');
  if (urgent?.stage === 'upcoming' && next.tick >= rules.urgentAppears) urgent.stage = 'backlog';
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
const FACTOR_SEED = 'RI-175';
const FACTOR_PROGRESSES = [4, 1] as const;
const FACTOR_STRATEGIES = ['continue', 'checkpoint', 'reset'] as const;
type FactorStrategy = (typeof FACTOR_STRATEGIES)[number];
type FactorNets = Record<FactorStrategy, number>;
interface FactorRun {
  strategy: FactorStrategy;
  inputs: CheckpointInput[];
  result: ReturnType<typeof summarizeCheckpoint>;
}
function cloneRules(rules: CheckpointRules): CheckpointRules {
  return { ...rules };
}
function withRules(patch: Partial<CheckpointRules>): CheckpointRules {
  return { ...baselineCheckpointRules, ...patch };
}
function runFactor(progress: number, strategy: FactorStrategy, rules: CheckpointRules): FactorRun {
  let state = createCheckpointPrototype(FACTOR_SEED, progress, rules);
  let steps = 0;
  while (state.tick < state.horizon) {
    const next = applyCheckpointInput(state, chooseCheckpointAction(state, strategy), rules);
    if (next === state || steps > 32) throw new Error(`${strategy}:${progress} tick ${state.tick}`);
    state = next;
    steps += 1;
  }
  return { strategy, inputs: state.inputs, result: summarizeCheckpoint(state) };
}
function preferenceOf(nets: FactorNets): string {
  const best = Math.max(...FACTOR_STRATEGIES.map((strategy) => nets[strategy]));
  const leaders = FACTOR_STRATEGIES.filter((strategy) => nets[strategy] === best);
  const first = leaders[0];
  if (!first) throw new Error('leaders');
  return leaders.length === 1 ? first : `tie:${leaders.join(',')}`;
}
function point(axis: string, parameter: string, rules: CheckpointRules) {
  const boards = FACTOR_PROGRESSES.map((progress) => {
    const runs = FACTOR_STRATEGIES.map((strategy) => runFactor(progress, strategy, rules));
    const nets = {
      continue: runs[0]!.result.netValue,
      checkpoint: runs[1]!.result.netValue,
      reset: runs[2]!.result.netValue,
    } satisfies FactorNets;
    return { progress, preference: preferenceOf(nets), runs };
  });
  return { axis, parameter, rules: cloneRules(rules), boards };
}
function reversalsOf(rows: ReturnType<typeof point>[]) {
  const found = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after) continue;
    for (const progress of FACTOR_PROGRESSES) {
      const earlier = before.boards.find((board) => board.progress === progress);
      const later = after.boards.find((board) => board.progress === progress);
      if (!earlier || !later || earlier.preference === later.preference) continue;
      const netsOf = (board: typeof earlier) => ({
        continue: board.runs[0]!.result.netValue,
        checkpoint: board.runs[1]!.result.netValue,
        reset: board.runs[2]!.result.netValue,
      });
      found.push({
        axis: before.axis,
        progress,
        before: {
          parameter: before.parameter,
          preference: earlier.preference,
          nets: netsOf(earlier),
        },
        after: { parameter: after.parameter, preference: later.preference, nets: netsOf(later) },
      });
    }
  }
  return found;
}
/** 初回と同じ資源で、保存容量・再開tick・緊急の出現時刻を一つずつ動かす。固定戦略。 */
export function compareCheckpointFactorReversals() {
  const sweeps = {
    saveCapacity: [0, 1, 2, 3, 4, 5, 6].map((saveCapacity) =>
      point('saveCapacity', String(saveCapacity), withRules({ saveCapacity })),
    ),
    resumeTicks: [0, 1, 2, 3, 4, 5].map((resumeTicks) =>
      point('resumeTicks', String(resumeTicks), withRules({ resumeTicks })),
    ),
    urgentAppears: [0, 1, 2, 3, 4, 5, 6].map((urgentAppears) =>
      point('urgentAppears', String(urgentAppears), withRules({ urgentAppears })),
    ),
  };
  return {
    conditions: {
      seed: FACTOR_SEED,
      progresses: [...FACTOR_PROGRESSES],
      horizon: 8,
      focus: 4,
      decision: {
        continue: 'continue',
        checkpoint: 'checkpoint',
        reset: 'reset',
        score: 'netValue',
      },
      baseline: cloneRules(baselineCheckpointRules),
      saveCapacityDefinition: 'チェックポイント時に残す進捗の上限。超えた分は捨てる。集中力は1',
      resumeTicksDefinition:
        'Codingへ戻るまでのtick。進捗は増えない。集中力は開始時に1。追加tickは時間だけ。0は時間を進めない',
      urgentAppearsDefinition:
        'そのtickの操作後にbacklogへ出る。期限3は動かさない。出る前の固定戦略は機能を進める',
      held: {
        saveCapacity: '容量だけを動かす。再開tick1、出現0。期末8、集中力4、期限3',
        resumeTicks: '再開tickだけを動かす。容量6、出現0。集中力は再開開始時の1のまま',
        urgentAppears: '出現tickだけを動かす。容量6、再開tick1。緊急の期限は3',
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

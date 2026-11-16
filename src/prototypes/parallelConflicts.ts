import { createRng } from '../sim/rng';

export interface ParallelTask {
  id: string;
  domain: 'product' | 'platform';
  codingLeft: number;
  integrationLeft: number;
  value: number;
  completedTick: number | null;
}
export interface ParallelState {
  version: 1;
  seed: string | number;
  tick: number;
  horizon: number;
  slots: number;
  tasks: ParallelTask[];
  conflicts: { pair: string[]; owner: string; tick: number; effort: number }[];
  history: { ids: string[]; tick: number }[];
}

export function createParallelPrototype(seed: string | number): ParallelState {
  const rng = createRng(seed);
  const extraWork = rng() < 0.5 ? 4 : 5;
  return {
    version: 1,
    seed,
    tick: 0,
    horizon: 12,
    slots: 2,
    tasks: [
      {
        id: 'a',
        domain: 'product',
        codingLeft: 3,
        integrationLeft: 0,
        value: 6,
        completedTick: null,
      },
      {
        id: 'b',
        domain: 'product',
        codingLeft: 3,
        integrationLeft: 0,
        value: 6,
        completedTick: null,
      },
      {
        id: 'c',
        domain: 'platform',
        codingLeft: extraWork,
        integrationLeft: 0,
        value: 6,
        completedTick: null,
      },
    ],
    conflicts: [],
    history: [],
  };
}

/** 省略時は初回比較と同じ。競合工数2、統合tickの進捗1。 */
export interface ParallelFactorRules {
  conflictEffort: number;
  integrationRate: number;
}
export const baselineParallelFactorRules: ParallelFactorRules = {
  conflictEffort: 2,
  integrationRate: 1,
};
/** 初回と同じ資源の上で、一つだけ動かす設定。deadline は horizon として停止する。 */
export interface ParallelFactorSetting extends ParallelFactorRules {
  deadline: number;
  slots: number;
}
export const baselineParallelSetting: ParallelFactorSetting = {
  deadline: 12,
  slots: 2,
  ...baselineParallelFactorRules,
};

/** 入力はこのtickに実際に作業するID。拒否時はtick・工数とも消費しない。 */
export function tickParallelPrototype(
  state: ParallelState,
  ids: string[],
  rules: ParallelFactorRules = baselineParallelFactorRules,
): ParallelState {
  if (state.tick >= state.horizon) return state;
  if (
    ids.length > state.slots ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !state.tasks.some((task) => task.id === id && task.completedTick === null))
  )
    return state;
  const next: ParallelState = {
    ...state,
    tick: state.tick + 1,
    tasks: state.tasks.map((task) => ({ ...task })),
    conflicts: [...state.conflicts],
    history: [...state.history, { ids: [...ids], tick: state.tick + 1 }],
  };
  const coding = next.tasks.filter((task) => ids.includes(task.id) && task.codingLeft > 0);
  // ID順で統合担当を固定し、入力順で費用・担当が変わることを防ぐ。
  coding.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let i = 0; i < coding.length; i++) {
    for (let j = i + 1; j < coding.length; j++) {
      const first = coding[i];
      const second = coding[j];
      const pair = [first.id, second.id];
      if (
        first.domain !== second.domain ||
        next.conflicts.some((c) => c.pair[0] === pair[0] && c.pair[1] === pair[1])
      )
        continue;
      second.integrationLeft += rules.conflictEffort;
      next.conflicts.push({
        pair,
        owner: second.id,
        tick: next.tick,
        effort: rules.conflictEffort,
      });
    }
  }
  for (const task of next.tasks.filter((task) => ids.includes(task.id))) {
    if (task.codingLeft > 0) task.codingLeft -= 1;
    else if (task.integrationLeft > 0) {
      task.integrationLeft = Math.max(0, task.integrationLeft - rules.integrationRate);
    }
    if (task.codingLeft === 0 && task.integrationLeft === 0) task.completedTick = next.tick;
  }
  return next;
}

export function summarizeParallel(state: ParallelState) {
  return {
    tick: state.tick,
    shipped: state.tasks
      .filter((task) => task.completedTick !== null)
      .map((task) => ({ id: task.id, tick: task.completedTick, value: task.value })),
    value: state.tasks
      .filter((task) => task.completedTick !== null)
      .reduce((sum, task) => sum + task.value, 0),
    integrationEffort: state.conflicts.reduce((sum, conflict) => sum + conflict.effort, 0),
    remaining: state.tasks.filter((task) => task.completedTick === null),
    workSpent: state.history.reduce((sum, input) => sum + input.ids.length, 0),
  };
}

export function compareParallelStrategies(seed: string | number) {
  return (['same-domain', 'mixed-domains'] as const).flatMap((composition) =>
    (['serial', 'same-first', 'distribute'] as const).map((strategy) => {
      let state = createParallelPrototype(seed);
      if (composition === 'same-domain') state.tasks = state.tasks.slice(0, 2);
      const order = strategy === 'distribute' ? ['a', 'c', 'b'] : ['a', 'b', 'c'];
      while (
        state.tasks.some((task) => task.completedTick === null) &&
        state.tick < state.horizon
      ) {
        const ids = order
          .filter((id) => state.tasks.some((task) => task.id === id && task.completedTick === null))
          .slice(0, strategy === 'serial' ? 1 : state.slots);
        state = tickParallelPrototype(state, ids);
      }
      return {
        composition,
        strategy,
        ...summarizeParallel(state),
        history: state.history,
        conflicts: state.conflicts,
      };
    }),
  );
}

type FactorName = 'deadline' | 'slots' | 'conflictEffort' | 'integrationRate';
type FactorComposition = 'same-domain' | 'mixed-domains';
type FactorJudgment = 'parallel' | 'split';
type FactorMetric = 'value' | 'completion' | 'work';
type FactorWinner = FactorJudgment | 'tie' | 'neither';
type ReversalKind = 'switch' | 'appear' | 'vanish';
interface FactorRun {
  history: ParallelState['history'];
  tick: number;
  shippedValue: number;
  shipped: { id: string; tick: number | null; value: number }[];
  integrationEffort: number;
  workSpent: number;
  completedAll: boolean;
  remainingIds: string[];
  conflicts: ParallelState['conflicts'];
}
interface FactorOutcome {
  value: FactorWinner;
  completion: FactorWinner;
  work: FactorWinner;
}
const DEADLINES = [3, 4, 5, 6, 7, 12] as const;
const INTEGRATION_RATES = [1, 2, 3] as const;
const CONFLICT_EFFORTS = [1, 2, 3] as const;
const SLOT_COUNTS = [2, 3, 4] as const;
const FACTOR_KEYS: FactorName[] = ['deadline', 'slots', 'conflictEffort', 'integrationRate'];

function withSetting(patch: Partial<ParallelFactorSetting>): ParallelFactorSetting {
  return { ...baselineParallelSetting, ...patch };
}
function changedFactors(setting: ParallelFactorSetting): FactorName[] {
  return FACTOR_KEYS.filter((key) => setting[key] !== baselineParallelSetting[key]);
}
function createFactorState(
  seed: string | number,
  setting: ParallelFactorSetting,
  composition: FactorComposition,
): ParallelState {
  const state = createParallelPrototype(seed);
  return {
    ...state,
    horizon: setting.deadline,
    slots: setting.slots,
    tasks: composition === 'same-domain' ? state.tasks.slice(0, 2) : state.tasks,
  };
}
/** 分ける判断は、枠が余っても同領域の2件目を選ばない。 */
function chooseFactorIds(
  state: ParallelState,
  judgment: FactorJudgment,
  composition: FactorComposition,
): string[] {
  const open = (id: string) =>
    state.tasks.some((task) => task.id === id && task.completedTick === null);
  if (judgment === 'split' && composition === 'mixed-domains') {
    const chosen: string[] = [];
    const domains = new Set<ParallelTask['domain']>();
    for (const id of ['a', 'c', 'b']) {
      if (chosen.length >= state.slots) break;
      if (!open(id)) continue;
      const task = state.tasks.find((item) => item.id === id);
      if (!task || domains.has(task.domain)) continue;
      domains.add(task.domain);
      chosen.push(id);
    }
    return chosen;
  }
  const limit = judgment === 'split' ? 1 : state.slots;
  return ['a', 'b', 'c'].filter(open).slice(0, limit);
}
function runFactorJudgment(
  seed: string | number,
  setting: ParallelFactorSetting,
  composition: FactorComposition,
  judgment: FactorJudgment,
): FactorRun {
  let state = createFactorState(seed, setting, composition);
  const rules = {
    conflictEffort: setting.conflictEffort,
    integrationRate: setting.integrationRate,
  };
  let guard = 0;
  while (state.tasks.some((task) => task.completedTick === null) && state.tick < state.horizon) {
    if (++guard > 40) throw new Error(`RI-157 ${composition} ${judgment}`);
    const ids = chooseFactorIds(state, judgment, composition);
    if (ids.length === 0) throw new Error(`RI-157 empty ${composition} ${judgment}`);
    const next = tickParallelPrototype(state, ids, rules);
    if (next === state) throw new Error(`RI-157 rejected ${composition} ${judgment}`);
    state = next;
  }
  const summary = summarizeParallel(state);
  return {
    history: state.history,
    tick: summary.tick,
    shippedValue: summary.value,
    shipped: summary.shipped,
    integrationEffort: summary.integrationEffort,
    workSpent: summary.workSpent,
    completedAll: summary.remaining.length === 0,
    remainingIds: summary.remaining.map((task) => task.id),
    conflicts: state.conflicts,
  };
}
function higherWinner(parallel: number, split: number): FactorWinner {
  if (parallel > split) return 'parallel';
  if (split > parallel) return 'split';
  return 'tie';
}
function lowerWinner(parallel: number, split: number): FactorWinner {
  if (parallel < split) return 'parallel';
  if (split < parallel) return 'split';
  return 'tie';
}
function completionWinner(parallel: FactorRun, split: FactorRun): FactorWinner {
  if (!parallel.completedAll && !split.completedAll) return 'neither';
  if (parallel.completedAll && !split.completedAll) return 'parallel';
  if (!parallel.completedAll && split.completedAll) return 'split';
  return lowerWinner(parallel.tick, split.tick);
}
function outcomeOf(parallel: FactorRun, split: FactorRun): FactorOutcome {
  return {
    value: higherWinner(parallel.shippedValue, split.shippedValue),
    completion: completionWinner(parallel, split),
    work: lowerWinner(parallel.workSpent, split.workSpent),
  };
}
function metricValue(run: FactorRun, metric: FactorMetric): number | null {
  if (metric === 'value') return run.shippedValue;
  if (metric === 'work') return run.workSpent;
  return run.completedAll ? run.tick : null;
}
function reversalKind(before: FactorWinner, after: FactorWinner): ReversalKind | null {
  if (before === after) return null;
  const side = (winner: FactorWinner) => winner === 'parallel' || winner === 'split';
  if (side(before) && side(after)) return 'switch';
  if (!side(before) && side(after)) return 'appear';
  if (side(before) && !side(after)) return 'vanish';
  return null;
}
function factorPoint(factor: FactorName, value: number, seed: string | number) {
  const setting = withSetting({ [factor]: value });
  const changed = changedFactors(setting);
  if (changed.length > 1 || (changed[0] !== undefined && changed[0] !== factor)) {
    throw new Error(`RI-157 factor drift ${factor}`);
  }
  const sameParallel = runFactorJudgment(seed, setting, 'same-domain', 'parallel');
  const sameSplit = runFactorJudgment(seed, setting, 'same-domain', 'split');
  const mixedParallel = runFactorJudgment(seed, setting, 'mixed-domains', 'parallel');
  const mixedSplit = runFactorJudgment(seed, setting, 'mixed-domains', 'split');
  return {
    factor,
    parameter: String(value),
    setting,
    changed,
    sameDomain: {
      parallel: sameParallel,
      split: sameSplit,
      outcome: outcomeOf(sameParallel, sameSplit),
    },
    mixed: {
      parallel: mixedParallel,
      split: mixedSplit,
      outcome: outcomeOf(mixedParallel, mixedSplit),
    },
  };
}
type FactorPoint = ReturnType<typeof factorPoint>;
interface FactorReversal {
  factor: FactorName;
  composition: FactorComposition;
  metric: FactorMetric;
  kind: ReversalKind;
  before: {
    parameter: string;
    winner: FactorWinner;
    parallel: number | null;
    split: number | null;
  };
  after: { parameter: string; winner: FactorWinner; parallel: number | null; split: number | null };
}
function reversalsOf(points: FactorPoint[]): FactorReversal[] {
  const metrics: FactorMetric[] = ['value', 'completion', 'work'];
  const compositions = ['same-domain', 'mixed-domains'] as const;
  const found: FactorReversal[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1];
    const after = points[index];
    if (!before || !after) continue;
    for (const composition of compositions) {
      const earlierSide = composition === 'same-domain' ? before.sameDomain : before.mixed;
      const laterSide = composition === 'same-domain' ? after.sameDomain : after.mixed;
      for (const metric of metrics) {
        const earlier = earlierSide.outcome[metric];
        const later = laterSide.outcome[metric];
        const kind = reversalKind(earlier, later);
        if (!kind) continue;
        found.push({
          factor: before.factor,
          composition,
          metric,
          kind,
          before: {
            parameter: before.parameter,
            winner: earlier,
            parallel: metricValue(earlierSide.parallel, metric),
            split: metricValue(earlierSide.split, metric),
          },
          after: {
            parameter: after.parameter,
            winner: later,
            parallel: metricValue(laterSide.parallel, metric),
            split: metricValue(laterSide.split, metric),
          },
        });
      }
    }
  }
  return found;
}
/** 初回と同じ資源で、締切・統合進捗・競合工数・作業枠を一つずつ動かす。固定戦略。 */
export function compareParallelFactorReversals(seed: string | number) {
  const sweeps = {
    deadline: DEADLINES.map((value) => factorPoint('deadline', value, seed)),
    integrationRate: INTEGRATION_RATES.map((value) => factorPoint('integrationRate', value, seed)),
    conflictEffort: CONFLICT_EFFORTS.map((value) => factorPoint('conflictEffort', value, seed)),
    slots: SLOT_COUNTS.map((value) => factorPoint('slots', value, seed)),
  };
  return {
    conditions: {
      seed,
      initial: structuredClone(createParallelPrototype(seed)),
      baseline: { ...baselineParallelSetting },
      levels: {
        deadline: [...DEADLINES],
        integrationRate: [...INTEGRATION_RATES],
        conflictEffort: [...CONFLICT_EFFORTS],
        slots: [...SLOT_COUNTS],
      },
      resources:
        '初回と同じ。a/bはproductで各3工数・価値6。cはplatformで、このseedでは4工数・価値6。',
      judgments: {
        parallel: '未完了をa、b、cの順に、枠の数だけ選ぶ',
        split: '同領域を同時に選ばない。混合は領域ごとに1件。同領域だけの構成は1件ずつ',
      },
      metrics: {
        value: '締切までに完成した価値の合計',
        completion: '全件完成したtick。未完了はnull',
        work: '選択した枠の延べ数',
      },
      held: {
        deadline: '締切だけをhorizonにする。枠2、競合工数2、統合進捗1',
        integrationRate: '統合tickの進捗だけ。締切12、枠2、競合工数2。Coding中は統合を進めない',
        conflictEffort: '同領域の同時Codingで足す統合工数だけ。締切12、枠2、統合進捗1',
        slots: '作業枠だけ。締切12、競合工数2、統合進捗1。分ける判断は余った枠を同領域に使わない',
      },
      codingBlocksIntegration: true,
      owner: 'IDの辞書順で後のタスク',
      fixedStrategies: true,
      humanPlaytest: false,
      oneFactorAtATime: true,
      repeatedFirstComparison: false,
      normalRun: false,
      personalAssignment: false,
      productionAdoption: false,
    },
    sweeps,
    reversals: [
      ...reversalsOf(sweeps.deadline),
      ...reversalsOf(sweeps.integrationRate),
      ...reversalsOf(sweeps.conflictEffort),
      ...reversalsOf(sweeps.slots),
    ],
  };
}

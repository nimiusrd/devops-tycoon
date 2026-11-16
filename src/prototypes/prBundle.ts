/** RI-167: 同領域・未着手のレビュー2件だけを束ねる固定試作。要因比較は本番へ接続しない。 */
export interface BundleJob {
  id: string;
  domain: string;
  stage: 'review' | 'done';
  value: number;
  doneTick: number | null;
  rechecks: number;
  failFirst: boolean;
}
export interface BundleGroup {
  ids: string[];
  workLeft: number;
  started: boolean;
  failed: boolean;
}
export type BundleInput =
  { type: 'bundle'; ids: string[] } | { type: 'work'; id: string } | { type: 'wait' };
export type FixedBasis = 'shared-recheck' | 'shared-once' | 'per-job';
export interface BundleRules {
  horizon: number;
  valueA: number;
  valueB: number;
  precursorTicks: number;
  partialSuccess: boolean;
  bundleOpCost: number;
  fixedCost: number;
  fixedBasis: FixedBasis;
  assignees: number;
}
export interface BundleState {
  version: 1;
  seed: string;
  tick: number;
  horizon: number;
  workSpent: number;
  fixedCost: number;
  jobs: BundleJob[];
  groups: BundleGroup[];
  inputs: BundleInput[];
  rules?: BundleRules;
}
/** 内容工数は1/件で固定。この段では動かさない。 */
const CONTENT_PER_JOB = 1;
export const baselineBundleRules: BundleRules = Object.freeze({
  horizon: 7,
  valueA: 6,
  valueB: 6,
  precursorTicks: 0,
  partialSuccess: false,
  bundleOpCost: 0,
  fixedCost: 2,
  fixedBasis: 'shared-recheck',
  assignees: 1,
});
function activeRules(state: BundleState): BundleRules {
  return state.rules ?? baselineBundleRules;
}
function workUnits(count: number, rules: BundleRules, recheck: boolean): number {
  const content = count * CONTENT_PER_JOB;
  if (recheck && rules.fixedBasis === 'shared-once') return content;
  const fixed = rules.fixedBasis === 'per-job' ? count * rules.fixedCost : rules.fixedCost;
  return fixed + content;
}
function fixedCharge(count: number, rules: BundleRules, recheck: boolean): number {
  if (recheck && rules.fixedBasis === 'shared-once') return 0;
  return rules.fixedBasis === 'per-job' ? count * rules.fixedCost : rules.fixedCost;
}
export function createBundlePrototype(
  seed: string,
  failFirst = false,
  rules?: BundleRules,
): BundleState {
  const active = rules ?? baselineBundleRules;
  const state: BundleState = {
    version: 1,
    seed,
    tick: 0,
    horizon: active.horizon,
    workSpent: 0,
    fixedCost: 0,
    jobs: (['a', 'b'] as const).map((id) => ({
      id,
      domain: 'product',
      stage: 'review' as const,
      value: id === 'a' ? active.valueA : active.valueB,
      doneTick: null,
      rechecks: 0,
      failFirst: id === 'b' && failFirst,
    })),
    groups: ['a', 'b'].map((id) => ({
      ids: [id],
      workLeft: workUnits(1, active, false),
      started: false,
      failed: false,
    })),
    inputs: [],
  };
  if (rules) state.rules = { ...rules };
  return state;
}
function markDone(state: BundleState, id: string) {
  const job = state.jobs.find((candidate) => candidate.id === id)!;
  if (job.stage === 'done') return;
  job.stage = 'done';
  job.doneTick = state.tick;
}
function applyOneUnit(state: BundleState, group: BundleGroup, rules: BundleRules) {
  const recheck = group.failed;
  if (!group.started) {
    state.fixedCost += fixedCharge(group.ids.length, rules, recheck);
    group.started = true;
  }
  group.workLeft--;
  state.workSpent++;
  const failing = group.ids.filter((id) => state.jobs.find((job) => job.id === id)!.failFirst);
  // 予兆0は確認の最後。失敗する仕事は failFirst の公開値のまま。
  const discovering = !group.failed && failing.length > 0 && group.workLeft <= rules.precursorTicks;
  if (discovering) {
    const kept = rules.partialSuccess ? group.ids.filter((id) => !failing.includes(id)) : [];
    for (const id of kept) markDone(state, id);
    const recounted = rules.partialSuccess ? failing : group.ids;
    for (const id of recounted) state.jobs.find((job) => job.id === id)!.rechecks++;
    group.failed = true;
    group.started = false;
    group.ids = rules.partialSuccess ? [...failing] : [...group.ids];
    group.workLeft = workUnits(group.ids.length, rules, true);
    return;
  }
  if (group.workLeft === 0) for (const id of group.ids) markDone(state, id);
}
function applyWorkTick(state: BundleState, focusId: string, rules: BundleRules) {
  const focus = state.groups.find((group) => group.ids.includes(focusId) && group.workLeft > 0);
  if (!focus) return;
  const skipped = new Set<BundleGroup>();
  const worked = new Set<BundleGroup>();
  let capacity = rules.assignees;
  while (capacity > 0) {
    const open = state.groups.filter((group) => group.workLeft > 0 && !skipped.has(group));
    if (open.length === 0) break;
    const fresh = open.filter((group) => !worked.has(group));
    const pool = fresh.length > 0 ? fresh : open;
    const current = pool.includes(focus) ? focus : pool[0];
    if (!current) break;
    const before = current.workLeft;
    applyOneUnit(state, current, rules);
    worked.add(current);
    capacity--;
    if (current.workLeft !== before - 1) skipped.add(current);
  }
}
export function applyBundleInput(state: BundleState, input: BundleInput): BundleState {
  if (state.tick >= state.horizon) return state;
  const rules = activeRules(state);
  if (input.type === 'bundle') {
    const ids = [...input.ids].sort();
    const jobs = ids.map((id) => state.jobs.find((job) => job.id === id));
    if (
      ids.length !== 2 ||
      new Set(ids).size !== 2 ||
      jobs.some((job) => !job || job.stage !== 'review') ||
      jobs[0]!.domain !== jobs[1]!.domain ||
      ids.some(
        (id) =>
          !state.groups.some(
            (group) =>
              group.ids.length === 1 && group.ids[0] === id && !group.started && !group.failed,
          ),
      ) ||
      rules.bundleOpCost > state.horizon - state.tick
    )
      return state;
    const next = structuredClone(state);
    next.groups = next.groups.filter((group) => !ids.includes(group.ids[0]!));
    next.groups.push({
      ids,
      workLeft: workUnits(ids.length, rules, false),
      started: false,
      failed: false,
    });
    for (let spent = 0; spent < rules.bundleOpCost; spent++) {
      next.tick++;
      next.workSpent += rules.assignees;
    }
    next.inputs.push({ type: 'bundle', ids: [...ids] });
    return next;
  }
  const group =
    input.type === 'work'
      ? state.groups.find((candidate) => candidate.ids.includes(input.id) && candidate.workLeft > 0)
      : undefined;
  if (input.type === 'work' && !group) return state;
  const next = structuredClone(state);
  next.tick++;
  if (group) applyWorkTick(next, group.ids[0]!, rules);
  next.inputs.push(structuredClone(input));
  return next;
}
export function summarizeBundle(state: BundleState) {
  return {
    value: state.jobs
      .filter((job) => job.stage === 'done')
      .reduce((sum, job) => sum + job.value, 0),
    workSpent: state.workSpent,
    fixedCost: state.fixedCost,
    jobs: state.jobs,
    remaining: state.groups.filter((group) => group.workLeft > 0),
  };
}
function runFixed(initial: BundleState, strategy: 'separate' | 'bundle'): BundleState {
  let state =
    strategy === 'bundle'
      ? applyBundleInput(initial, { type: 'bundle', ids: ['a', 'b'] })
      : initial;
  while (state.tick < state.horizon) {
    const group = state.groups.find((candidate) => candidate.workLeft > 0);
    if (!group) break;
    const next = applyBundleInput(state, { type: 'work', id: group.ids[0]! });
    if (next === state) break;
    state = next;
  }
  return state;
}
export function compareBundleStrategies(seed: string) {
  return [false, true].flatMap((failFirst) =>
    (['separate', 'bundle'] as const).map((strategy) => {
      const initial = createBundlePrototype(seed, failFirst);
      const state = runFixed(initial, strategy);
      return { failFirst, strategy, initial, inputs: state.inputs, result: summarizeBundle(state) };
    }),
  );
}
export type BundleBoard = 'safe' | 'fail';
export type BundlePreference = 'separate' | 'bundle' | 'tie';
interface StrategyReport {
  value: number;
  workSpent: number;
  fixedCost: number;
  rechecks: number[];
  doneTicks: (number | null)[];
  remainingWork: number;
  inputs: BundleInput[];
}
interface FactorPoint {
  level: number | string;
  preference: BundlePreference;
  separate: StrategyReport;
  bundle: StrategyReport;
}
interface FactorSeries {
  factor: string;
  board: BundleBoard;
  points: FactorPoint[];
}
interface FactorReversal {
  factor: string;
  board: BundleBoard;
  before: {
    level: number | string;
    preference: BundlePreference;
    separate: Pick<StrategyReport, 'value' | 'workSpent'>;
    bundle: Pick<StrategyReport, 'value' | 'workSpent'>;
  };
  after: FactorReversal['before'];
}
type FactorLevel = number | string;
const factorSpecs: readonly {
  factor: string;
  levels: readonly FactorLevel[];
  patch: (level: FactorLevel) => Partial<BundleRules>;
}[] = [
  {
    factor: 'horizon',
    levels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    patch: (level) => ({ horizon: level as number }),
  },
  {
    factor: 'valueA',
    levels: [0, 1, 6, 12],
    patch: (level) => ({ valueA: level as number }),
  },
  {
    factor: 'valueB',
    levels: [0, 6, 12],
    patch: (level) => ({ valueB: level as number }),
  },
  {
    factor: 'precursor',
    levels: [0, 1, 2, 3],
    patch: (level) => ({ precursorTicks: level as number }),
  },
  {
    factor: 'partialSuccess',
    levels: ['no', 'yes'],
    patch: (level) => ({ partialSuccess: level === 'yes' }),
  },
  {
    factor: 'bundleOpCost',
    levels: [0, 1, 2, 3, 4, 5],
    patch: (level) => ({ bundleOpCost: level as number }),
  },
  {
    factor: 'fixedCost',
    levels: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    patch: (level) => ({ fixedCost: level as number }),
  },
  {
    factor: 'fixedBasis',
    levels: ['shared-recheck', 'shared-once', 'per-job'],
    patch: (level) => ({ fixedBasis: level as FixedBasis }),
  },
  {
    factor: 'assignees',
    levels: [1, 2, 3],
    patch: (level) => ({ assignees: level as number }),
  },
];
export function createBundleFactorState(
  seed: string,
  factor: string,
  board: BundleBoard,
  level: FactorLevel,
): BundleState {
  const spec = factorSpecs.find((candidate) => candidate.factor === factor);
  if (!spec || !spec.levels.includes(level))
    throw new Error(`unknown factor level ${factor}:${level}`);
  return createBundlePrototype(seed, board === 'fail', {
    ...baselineBundleRules,
    ...spec.patch(level),
  });
}
function reportOf(state: BundleState): StrategyReport {
  const summary = summarizeBundle(state);
  return {
    value: summary.value,
    workSpent: summary.workSpent,
    fixedCost: summary.fixedCost,
    rechecks: state.jobs.map((job) => job.rechecks),
    doneTicks: state.jobs.map((job) => job.doneTick),
    remainingWork: summary.remaining.reduce((sum, group) => sum + group.workLeft, 0),
    inputs: state.inputs,
  };
}
export function bundlePreference(
  separate: StrategyReport,
  bundled: StrategyReport,
): BundlePreference {
  if (separate.value !== bundled.value)
    return separate.value > bundled.value ? 'separate' : 'bundle';
  if (separate.workSpent !== bundled.workSpent)
    return separate.workSpent < bundled.workSpent ? 'separate' : 'bundle';
  return 'tie';
}
function brief(
  level: FactorLevel,
  preference: BundlePreference,
  separate: StrategyReport,
  bundled: StrategyReport,
) {
  return {
    level,
    preference,
    separate: { value: separate.value, workSpent: separate.workSpent },
    bundle: { value: bundled.value, workSpent: bundled.workSpent },
  };
}
/** 初回と同じ2件・同じ失敗条件で、要因を一つずつ動かす。固定戦略の計算。 */
export function compareBundleFactorReversals(seed: string) {
  const series: FactorSeries[] = factorSpecs.flatMap((spec) =>
    (['safe', 'fail'] as const).map((board) => ({
      factor: spec.factor,
      board,
      points: spec.levels.map((level) => {
        const separate = reportOf(
          runFixed(createBundleFactorState(seed, spec.factor, board, level), 'separate'),
        );
        const bundled = reportOf(
          runFixed(createBundleFactorState(seed, spec.factor, board, level), 'bundle'),
        );
        return {
          level,
          preference: bundlePreference(separate, bundled),
          separate,
          bundle: bundled,
        };
      }),
    })),
  );
  const reversals: FactorReversal[] = series.flatMap((entry) => {
    const found: FactorReversal[] = [];
    for (let index = 1; index < entry.points.length; index++) {
      const previous = entry.points[index - 1]!;
      const current = entry.points[index]!;
      if (previous.preference === current.preference) continue;
      found.push({
        factor: entry.factor,
        board: entry.board,
        before: brief(previous.level, previous.preference, previous.separate, previous.bundle),
        after: brief(current.level, current.preference, current.separate, current.bundle),
      });
    }
    return found;
  });
  return {
    conditions: {
      seed,
      fixedStrategies: true,
      humanPlaytest: false,
      productionIntegrated: false,
      failure:
        'bの初回確認だけ失敗し、再確認は成功する。失敗する仕事と再確認の成功は比較開始前の公開値で、この段では変えない。',
      preference:
        '出荷価値が高い方を上とする。出荷価値が同じなら投入工数が少ない方を上とする。固定費は投入工数の内訳であり、同点を割らない。',
      contentPerJob: CONTENT_PER_JOB,
      strategies: {
        separate: '残工数のあるレビューをa、bの順に進める',
        bundle: '最初にaとbを束ね、その後は束の残工数を進める',
      },
      assignment:
        '担当が複数のとき、同じtickでは残工数のあるレビューへ先に1工数ずつ配り、余りは起点のレビューに積む。入力idは起点だけで、余った担当の進行は入力に分けて書かない。',
      baseline: baselineBundleRules,
      oneAtATime: true,
      factorNotes: {
        horizon: '期末tick。初回は7。',
        valueA: 'aの出荷価値。bは6のまま。',
        valueB: 'bの出荷価値。aは6のまま。',
        precursor:
          '失敗する初回確認を、残工数がこの値以下になった時点で打ち切る。0は最後まで行う。失敗する仕事は変えない。',
        partialSuccess:
          'yesのとき、初回確認で失敗しなかった仕事は出荷し、失敗した仕事だけ再確認する。noは束全体を再確認する。',
        bundleOpCost:
          '束ね操作が消費するtick。その間はレビューを進めず、担当人数ぶんを投入工数に数える。残りtickが足りない操作は無消費で拒否する。',
        fixedCost: 'レビュー開始時の固定工数。計上の仕方はセッション共有のまま。',
        fixedBasis:
          'shared-recheckは束で1回、再確認でもう1回。shared-onceは再確認では払わない。per-jobは束でも件数分払う。額は2。',
        assignees: '1tickに投入できる工数。初回は1。',
      },
    },
    series,
    reversals,
  };
}

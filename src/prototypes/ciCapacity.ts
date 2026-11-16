/** RI-161: 固定仕事のFIFO CI。実サービスへの接続はない。 */
export interface CiJob {
  id: string;
  stage: 'review' | 'queue' | 'ci' | 'rework' | 'done';
  reviewLeft: number;
  ciLeft: number;
  attempts: number;
  failFirst: boolean;
  queuedOrder: number | null;
  completedTick: number | null;
  value: number;
  /** 無いときは期限なし。完了価値を満額にする。 */
  deadline?: number;
}
/** 比較で一つずつ動かす規則。状態に無いときは初回のCI混雑と同じ。 */
export interface CiRules {
  values: number[];
  deadlines: number[];
  /** 期限後に完了した仕事の価値。期限内は value。 */
  lateValue: number;
  ciEffort: number;
  failFirstIds: string[];
  /** 容量1枠・1tickの予算。空き枠も払う。 */
  capacityUnitCost: number;
  reviewSlots: number;
  /** 開始時のレビュー残。0はレビュー済み。 */
  reviewEffort: number;
  /** 1tickに修正から戻せる件数。0は担当が空かない。 */
  reworkSlots: number;
}
export const baselineCiRules: CiRules = {
  values: [8, 8, 8],
  deadlines: [6, 6, 6],
  lateValue: 0,
  ciEffort: 2,
  failFirstIds: ['b'],
  capacityUnitCost: 1,
  reviewSlots: 1,
  reviewEffort: 0,
  reworkSlots: 1,
};
export interface CiState {
  version: 1;
  seed: string | number;
  tick: number;
  horizon: number;
  capacity: 1 | 2;
  budget: number;
  queueSequence: number;
  queueWait: number;
  upstreamWait: number;
  jobs: CiJob[];
  inputs: ('all' | 'paced')[];
  /** 無いときは初回と同じ規則。初回の比較JSONはこのフィールドを持たない。 */
  rules?: CiRules;
}
export function createCiPrototype(
  seed: string | number,
  bottleneck: 'ci' | 'review',
  capacity: 1 | 2,
): CiState {
  return {
    version: 1,
    seed,
    tick: 0,
    horizon: 6,
    capacity,
    budget: 20,
    queueSequence: 0,
    queueWait: 0,
    upstreamWait: 0,
    inputs: [],
    jobs: ['a', 'b', 'c'].map((id) => ({
      id,
      stage: 'review',
      reviewLeft: bottleneck === 'ci' ? 0 : 3,
      ciLeft: 2,
      attempts: 0,
      failFirst: id === 'b',
      queuedOrder: null,
      completedTick: null,
      value: 8,
    })),
  };
}
function chargeOf(state: CiState): number {
  return state.capacity * (state.rules?.capacityUnitCost ?? 1);
}

/** 手戻り→レビュー→FIFO投入→CI処理→終端計上。規則が無いときは各1枠・単価1。 */
export function tickCiPrototype(state: CiState, input: 'all' | 'paced'): CiState {
  const charge = chargeOf(state);
  if (state.tick >= state.horizon || state.budget < charge) return state;
  const next = structuredClone(state);
  next.tick++;
  next.budget -= charge;
  const reworkSlots = next.rules?.reworkSlots ?? 1;
  for (const rework of next.jobs.filter((job) => job.stage === 'rework').slice(0, reworkSlots)) {
    rework.stage = 'review';
    rework.reviewLeft = 0;
  }
  const reviewSlots = next.rules?.reviewSlots ?? 1;
  for (const review of next.jobs
    .filter((job) => job.stage === 'review' && job.reviewLeft > 0)
    .slice(0, reviewSlots)) {
    review.reviewLeft--;
  }
  for (const job of next.jobs) {
    if (job.stage !== 'review' || job.reviewLeft !== 0) continue;
    const admitted = next.jobs.filter((j) => j.stage === 'queue' || j.stage === 'ci').length;
    if (input === 'paced' && admitted >= next.capacity) {
      next.upstreamWait++;
      continue;
    }
    job.stage = 'queue';
    job.queuedOrder = next.queueSequence++;
  }
  const waiting = next.jobs
    .filter((job) => job.stage === 'queue')
    .sort((a, b) => a.queuedOrder! - b.queuedOrder!);
  const slots = next.capacity - next.jobs.filter((job) => job.stage === 'ci').length;
  for (const job of waiting.slice(0, slots)) {
    job.stage = 'ci';
    job.attempts++;
  }
  next.queueWait += next.jobs.filter((job) => job.stage === 'queue').length;
  for (const job of next.jobs.filter((job) => job.stage === 'ci')) {
    job.ciLeft--;
    if (job.ciLeft > 0) continue;
    if (job.failFirst && job.attempts === 1) {
      job.stage = 'rework';
      job.ciLeft = next.rules?.ciEffort ?? 2;
      job.queuedOrder = null;
    } else {
      job.stage = 'done';
      job.completedTick = next.tick;
    }
  }
  next.inputs.push(input);
  return next;
}
function countedValue(state: CiState, job: CiJob): number {
  const late =
    job.deadline !== undefined && job.completedTick !== null && job.completedTick > job.deadline;
  return late ? (state.rules?.lateValue ?? 0) : job.value;
}

export function summarizeCi(state: CiState) {
  const done = state.jobs.filter((job) => job.stage === 'done');
  const value = done.reduce((sum, job) => sum + countedValue(state, job), 0);
  return {
    done: done.map((job) => job.id),
    value,
    budget: state.budget,
    cost: 20 - state.budget,
    netValue: value - (20 - state.budget),
    queueWait: state.queueWait,
    upstreamWait: state.upstreamWait,
    pending: state.jobs
      .filter((job) => job.stage !== 'done')
      .map((job) => ({
        id: job.id,
        stage: job.stage,
        reviewLeft: job.reviewLeft,
        ciLeft: job.ciLeft,
      })),
    attempts: state.jobs.map((job) => ({ id: job.id, attempts: job.attempts })),
  };
}
export function compareCiStrategies(seed: string | number) {
  return (['ci', 'review'] as const).flatMap((bottleneck) =>
    (
      [
        { capacity: 1, flow: 'all' },
        { capacity: 2, flow: 'all' },
        { capacity: 1, flow: 'paced' },
      ] as const
    ).map(({ capacity, flow }) => {
      const initial = createCiPrototype(seed, bottleneck, capacity);
      let state = initial;
      while (state.tick < state.horizon) state = tickCiPrototype(state, flow);
      return {
        bottleneck,
        capacity,
        flow,
        initial,
        inputs: state.inputs,
        result: summarizeCi(state),
      };
    }),
  );
}

const FACTOR_SEED = 'RI-161';
const FAIL_ORDER = ['b', 'c', 'a'] as const;

export type CiPreference = 'increase' | 'keep' | 'tie';

export interface CiFactorRun {
  inputs: ('all' | 'paced')[];
  result: ReturnType<typeof summarizeCi>;
  finished: { id: string; tick: number }[];
}

export interface CiFactorPoint {
  axis: string;
  parameter: string;
  rules: CiRules;
  preference: CiPreference;
  margin: number;
  runs: { capacity1: CiFactorRun; capacity2: CiFactorRun };
}

export interface CiFactorReversal {
  axis: string;
  before: { parameter: string; preference: CiPreference; capacity1: number; capacity2: number };
  after: { parameter: string; preference: CiPreference; capacity1: number; capacity2: number };
}

function cloneRules(rules: CiRules): CiRules {
  return {
    values: [...rules.values],
    deadlines: [...rules.deadlines],
    lateValue: rules.lateValue,
    ciEffort: rules.ciEffort,
    failFirstIds: [...rules.failFirstIds],
    capacityUnitCost: rules.capacityUnitCost,
    reviewSlots: rules.reviewSlots,
    reviewEffort: rules.reviewEffort,
    reworkSlots: rules.reworkSlots,
  };
}

function withRules(patch: Partial<CiRules>): CiRules {
  return cloneRules({ ...baselineCiRules, ...patch });
}

export function createCiFactorState(
  seed: string | number,
  capacity: 1 | 2,
  rules: CiRules,
): CiState {
  const ids = ['a', 'b', 'c'];
  const cloned = cloneRules(rules);
  return {
    version: 1,
    seed,
    tick: 0,
    horizon: 6,
    capacity,
    budget: 20,
    queueSequence: 0,
    queueWait: 0,
    upstreamWait: 0,
    inputs: [],
    rules: cloned,
    jobs: ids.map((id, index) => {
      const value = cloned.values[index];
      const deadline = cloned.deadlines[index];
      if (value === undefined || deadline === undefined) throw new Error(`job ${id} missing`);
      return {
        id,
        stage: 'review' as const,
        reviewLeft: cloned.reviewEffort,
        ciLeft: cloned.ciEffort,
        attempts: 0,
        failFirst: cloned.failFirstIds.includes(id),
        queuedOrder: null,
        completedTick: null,
        value,
        deadline,
      };
    }),
  };
}

function runCapacity(capacity: 1 | 2, rules: CiRules): CiFactorRun {
  let state = createCiFactorState(FACTOR_SEED, capacity, rules);
  while (state.tick < state.horizon) {
    const next = tickCiPrototype(state, 'all');
    if (next === state) break;
    state = next;
  }
  return {
    inputs: state.inputs,
    result: summarizeCi(state),
    finished: state.jobs.flatMap((job) =>
      job.completedTick === null ? [] : [{ id: job.id, tick: job.completedTick }],
    ),
  };
}

function preferenceOf(keep: number, increase: number): CiPreference {
  if (increase > keep) return 'increase';
  if (keep > increase) return 'keep';
  return 'tie';
}

function point(axis: string, parameter: string, rules: CiRules): CiFactorPoint {
  const capacity1 = runCapacity(1, rules);
  const capacity2 = runCapacity(2, rules);
  const keep = capacity1.result.netValue;
  const increase = capacity2.result.netValue;
  return {
    axis,
    parameter,
    rules: cloneRules(rules),
    preference: preferenceOf(keep, increase),
    margin: increase - keep,
    runs: { capacity1, capacity2 },
  };
}

function failIds(count: number): string[] {
  return FAIL_ORDER.slice(0, count);
}

function reversalsOf(rows: CiFactorPoint[]): CiFactorReversal[] {
  const found: CiFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after || before.preference === after.preference) continue;
    found.push({
      axis: before.axis,
      before: {
        parameter: before.parameter,
        preference: before.preference,
        capacity1: before.runs.capacity1.result.netValue,
        capacity2: before.runs.capacity2.result.netValue,
      },
      after: {
        parameter: after.parameter,
        preference: after.preference,
        capacity1: after.runs.capacity1.result.netValue,
        capacity2: after.runs.capacity2.result.netValue,
      },
    });
  }
  return found;
}

/** 初回のCI混雑・all投入と同じ資源で、要因を一つずつ動かす。固定戦略。 */
export function compareCiFactorReversals() {
  const sweeps = {
    jobValue: [8, 7, 6, 5].map((value) =>
      point('jobValue', `b=${value}`, withRules({ values: [8, value, 8] })),
    ),
    deadline: [6, 5, 4, 3, 2].map((deadline) =>
      point('deadline', String(deadline), withRules({ deadlines: [deadline, deadline, deadline] })),
    ),
    jobDeadline: [6, 4, 3].map((deadline) =>
      point('jobDeadline', `6/${deadline}/6`, withRules({ deadlines: [6, deadline, 6] })),
    ),
    ciEffort: [1, 2, 3, 4].map((ciEffort) =>
      point('ciEffort', String(ciEffort), withRules({ ciEffort })),
    ),
    failureCount: [0, 1, 2, 3].map((count) =>
      point(
        'failureCount',
        failIds(count).join('+') || '0',
        withRules({ failFirstIds: failIds(count) }),
      ),
    ),
    capacityUnitCost: [1, 2, 3].map((capacityUnitCost) =>
      point('capacityUnitCost', String(capacityUnitCost), withRules({ capacityUnitCost })),
    ),
    reviewSlots: [1, 2].map((reviewSlots) =>
      point('reviewSlots', String(reviewSlots), withRules({ reviewSlots })),
    ),
    reviewSlotsWithWork: [1, 2, 3].map((reviewSlots) =>
      point(
        'reviewSlotsWithWork',
        String(reviewSlots),
        withRules({ reviewEffort: 3, reviewSlots }),
      ),
    ),
    reworkSlots: [0, 1, 2].map((reworkSlots) =>
      point('reworkSlots', String(reworkSlots), withRules({ reworkSlots })),
    ),
  };
  const controls = [
    point('jobValue', '3/8/20', withRules({ values: [3, 8, 20] })),
    point('deadline', '6/6/5', withRules({ deadlines: [6, 6, 5] })),
  ];
  return {
    conditions: {
      seed: FACTOR_SEED,
      horizon: 6,
      budget: 20,
      jobs: ['a', 'b', 'c'],
      flow: 'all',
      lateValue: 0,
      failOrder: [...FAIL_ORDER],
      decision: { keep: 1, increase: 2, score: 'netValue' },
      baseline: cloneRules(baselineCiRules),
      held: {
        jobValue: 'a=8,c=8。期限と他の規則は基準',
        deadline: '全仕事が同じ期限。価値と他の規則は基準',
        jobDeadline: 'bの期限だけ。aとcは6。価値と他の規則は基準',
        ciEffort: '再実行も同じ工数。他の規則は基準',
        failureCount: '失敗はb、c、aの順に足す。他の規則は基準',
        capacityUnitCost: '空き枠も同じ単価。予算20のまま',
        reviewSlots: 'レビュー残0。枠だけを動かす',
        reviewSlotsWithWork: 'レビュー残は初回のレビュー混雑と同じ3。枠だけを動かす',
        reworkSlots: '失敗はbだけ。修正枠だけを動かす',
      },
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
    },
    sweeps,
    controls,
    reversals: Object.values(sweeps).flatMap((rows) => reversalsOf(rows)),
  };
}

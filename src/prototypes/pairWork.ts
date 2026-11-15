/** RI-178: ペアは2枠。進捗は既定1で、pairPace 2のときだけペアの作業tickが2。複雑な単独作業だけ手戻り2tick。人物育成は扱わない。 */
export interface PairJob {
  id: string;
  complex: boolean;
  work: number;
  progress: number;
  reworkLeft: number;
  reworkSpent: number;
  value: number;
  stage: 'backlog' | 'active' | 'rework' | 'done';
  slots: number;
  acquired: number;
  released: number;
}
export type PairBoard = 'complex' | 'routine';
export type PairStrategy = 'solo' | 'pair' | 'mixed';
export type PairPace = 1 | 2;
export type PairPreference = 'solo' | 'pair' | 'mixed' | 'tie';
export type PairInput = { type: 'solo' | 'pair' | 'interrupt'; id: string } | { type: 'tick' };
export interface PairState {
  version: 1;
  seed: string;
  tick: number;
  horizon: number;
  freeSlots: number;
  slotCapacity: number;
  jobs: PairJob[];
  inputs: PairInput[];
  /** 無いときは1。ペアで保持中の作業tickだけ進捗に足す。手戻りは加速しない。初回の比較JSONは持たない。 */
  pairPace?: PairPace;
}
function jobOf(id: string, complex: boolean): PairJob {
  return {
    id,
    complex,
    work: 2,
    progress: 0,
    reworkLeft: 0,
    reworkSpent: 0,
    value: complex ? 14 : 8,
    stage: 'backlog',
    slots: 0,
    acquired: 0,
    released: 0,
  };
}
export function createPairPrototype(seed: string, board: PairBoard): PairState {
  const jobs =
    board === 'complex'
      ? ['c1', 'c2', 'c3'].map((id) => jobOf(id, true))
      : ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map((id) => jobOf(id, false));
  return {
    version: 1,
    seed,
    tick: 0,
    horizon: 6,
    freeSlots: 2,
    slotCapacity: 2,
    jobs,
    inputs: [],
  };
}
function release(state: PairState, job: PairJob) {
  state.freeSlots += job.slots;
  job.released += job.slots;
  job.slots = 0;
}
function complete(state: PairState, job: PairJob) {
  release(state, job);
  job.stage = 'done';
}
export function applyPairInput(state: PairState, input: PairInput): PairState {
  if (state.tick >= state.horizon) return state;
  const target = input.type === 'tick' ? undefined : state.jobs.find((job) => job.id === input.id);
  if (input.type === 'solo' || input.type === 'pair') {
    const needed = input.type === 'pair' ? 2 : 1;
    if (!target || target.stage !== 'backlog' || state.freeSlots < needed) return state;
  } else if (input.type === 'interrupt') {
    if (!target || (target.stage !== 'active' && target.stage !== 'rework')) return state;
  }
  const next = structuredClone(state);
  if (input.type === 'solo' || input.type === 'pair') {
    const job = next.jobs.find((item) => item.id === input.id)!;
    const needed = input.type === 'pair' ? 2 : 1;
    job.slots = needed;
    job.acquired += needed;
    next.freeSlots -= needed;
    job.stage = job.reworkLeft > 0 ? 'rework' : 'active';
  } else if (input.type === 'interrupt') {
    const job = next.jobs.find((item) => item.id === input.id)!;
    release(next, job);
    job.stage = 'backlog';
  } else {
    next.tick += 1;
    const alreadyReworking = new Set(
      next.jobs.filter((job) => job.stage === 'rework').map((job) => job.id),
    );
    for (const job of next.jobs) {
      if (job.stage !== 'active') continue;
      job.progress += job.slots === 2 ? (next.pairPace ?? 1) : 1;
      if (job.progress < job.work) continue;
      if (job.complex && job.slots === 1) {
        job.stage = 'rework';
        job.reworkLeft = 2;
      } else complete(next, job);
    }
    for (const job of next.jobs) {
      if (!alreadyReworking.has(job.id)) continue;
      job.reworkLeft -= 1;
      job.reworkSpent += 1;
      if (job.reworkLeft <= 0) complete(next, job);
    }
  }
  next.inputs.push(structuredClone(input));
  return next;
}
export function summarizePair(state: PairState) {
  const done = state.jobs.filter((job) => job.stage === 'done');
  return {
    value: done.reduce((sum, job) => sum + job.value, 0),
    doneCount: done.length,
    unfinishedValue: state.jobs
      .filter((job) => job.stage !== 'done')
      .reduce((sum, job) => sum + job.value, 0),
    freeSlots: state.freeSlots,
    acquired: state.jobs.reduce((sum, job) => sum + job.acquired, 0),
    released: state.jobs.reduce((sum, job) => sum + job.released, 0),
    reworkSpent: state.jobs.reduce((sum, job) => sum + job.reworkSpent, 0),
    heldSlots: state.jobs.reduce((sum, job) => sum + job.slots, 0),
    netValue: done.reduce((sum, job) => sum + job.value, 0),
  };
}
export function choosePairAction(state: PairState, strategy: PairStrategy): PairInput {
  const backlog = state.jobs.find((job) => job.stage === 'backlog');
  if (strategy === 'mixed') {
    const complex = state.jobs.find((job) => job.stage === 'backlog' && job.complex);
    const routine = state.jobs.find((job) => job.stage === 'backlog' && !job.complex);
    if (complex && state.freeSlots >= 2) return { type: 'pair', id: complex.id };
    if (routine && state.freeSlots >= 1) return { type: 'solo', id: routine.id };
    return { type: 'tick' };
  }
  if (backlog && strategy === 'pair' && state.freeSlots >= 2)
    return { type: 'pair', id: backlog.id };
  if (backlog && strategy === 'solo' && state.freeSlots >= 1)
    return { type: 'solo', id: backlog.id };
  return { type: 'tick' };
}
export interface PairRun {
  strategy: PairStrategy;
  initial: PairState;
  inputs: PairInput[];
  result: ReturnType<typeof summarizePair>;
  doneIds: string[];
}
const FOLLOW_UP_COMPLEX = 3;
const FOLLOW_UP_LEADING = [1, 2, 3] as const;
function runPair(initial: PairState, strategy: PairStrategy, label: string) {
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 40) throw new Error(`${label}:${strategy}`);
    const next = applyPairInput(state, choosePairAction(state, strategy));
    if (next === state) throw new Error(`${label}:${strategy} tick ${state.tick}`);
    state = next;
  }
  return {
    strategy,
    initial,
    inputs: state.inputs,
    result: summarizePair(state),
    doneIds: state.jobs.filter((job) => job.stage === 'done').map((job) => job.id),
  };
}
export function comparePairStrategies(seed: string) {
  return (['complex', 'routine'] as const).flatMap((board) =>
    (['solo', 'pair'] as const).map((strategy) => {
      const run = runPair(createPairPrototype(seed, board), strategy, board);
      return {
        board,
        strategy,
        initial: run.initial,
        inputs: run.inputs,
        result: run.result,
      };
    }),
  );
}
function sidePreference(base: number, other: number, side: 'pair' | 'mixed'): PairPreference {
  if (other > base) return side;
  if (base > other) return 'solo';
  return 'tie';
}
function pairOrMixed(pair: number, mixed: number): PairPreference {
  if (pair > mixed) return 'pair';
  if (mixed > pair) return 'mixed';
  return 'tie';
}
function strictFlip(before: PairPreference, after: PairPreference) {
  return before !== after && before !== 'tie' && after !== 'tie';
}
export function createPairMix(
  seed: string,
  leadingRoutines: number,
  pairPace: PairPace = 1,
): PairState {
  const jobs = [
    ...Array.from({ length: leadingRoutines }, (_, index) => jobOf(`r${index + 1}`, false)),
    ...Array.from({ length: FOLLOW_UP_COMPLEX }, (_, index) => jobOf(`c${index + 1}`, true)),
  ];
  const state: PairState = {
    version: 1,
    seed,
    tick: 0,
    horizon: 6,
    freeSlots: 2,
    slotCapacity: 2,
    jobs,
    inputs: [],
  };
  return pairPace === 1 ? state : { ...state, pairPace };
}
function mixPoint(seed: string, leadingRoutines: number, pairPace: PairPace) {
  const runs = (['solo', 'pair', 'mixed'] as const).map((strategy) =>
    runPair(
      createPairMix(seed, leadingRoutines, pairPace),
      strategy,
      `n${leadingRoutines}:p${pairPace}`,
    ),
  );
  const [solo, pair, mixed] = runs;
  if (!solo || !pair || !mixed) throw new Error(`n${leadingRoutines}`);
  return {
    leadingRoutines,
    pairPace,
    solo: solo.result.netValue,
    pair: pair.result.netValue,
    mixed: mixed.result.netValue,
    pairVsSolo: sidePreference(solo.result.netValue, pair.result.netValue, 'pair'),
    mixedVsSolo: sidePreference(solo.result.netValue, mixed.result.netValue, 'mixed'),
    pairVsMixed: pairOrMixed(pair.result.netValue, mixed.result.netValue),
    runs,
  };
}
function leadingReversals(points: ReturnType<typeof mixPoint>[]) {
  const found = [];
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1];
    const after = points[index];
    if (!before || !after) continue;
    for (const decision of ['pair', 'mixed'] as const) {
      const key = decision === 'pair' ? 'pairVsSolo' : 'mixedVsSolo';
      if (before[key] === after[key]) continue;
      found.push({
        decision,
        before: {
          leadingRoutines: before.leadingRoutines,
          preference: before[key],
          solo: before.solo,
          other: decision === 'pair' ? before.pair : before.mixed,
        },
        after: {
          leadingRoutines: after.leadingRoutines,
          preference: after[key],
          solo: after.solo,
          other: decision === 'pair' ? after.pair : after.mixed,
        },
        strict: strictFlip(before[key], after[key]),
      });
    }
  }
  return found;
}
/** 初回と同じ期末・枠・工数・価値の上で、混合方針と速度を一つずつ動かす。固定戦略。 */
export function comparePairFollowUp(seed = 'RI-178') {
  const first = comparePairStrategies(seed);
  const leading = FOLLOW_UP_LEADING.map((count) => mixPoint(seed, count, 1));
  const paceOnFirst = (['complex', 'routine'] as const).map((board) => {
    const runs = (['solo', 'pair'] as const).map((strategy) =>
      runPair({ ...createPairPrototype(seed, board), pairPace: 2 }, strategy, `${board}:pace2`),
    );
    const [solo, pair] = runs;
    const baselineSolo = first.find((row) => row.board === board && row.strategy === 'solo');
    const baselinePair = first.find((row) => row.board === board && row.strategy === 'pair');
    if (!solo || !pair || !baselineSolo || !baselinePair) throw new Error(board);
    const preferenceAtPace1 = sidePreference(
      baselineSolo.result.netValue,
      baselinePair.result.netValue,
      'pair',
    );
    const preferenceAtPace2 = sidePreference(solo.result.netValue, pair.result.netValue, 'pair');
    return {
      board,
      pairPace: 2 as const,
      baselineSolo: baselineSolo.result.netValue,
      baselinePair: baselinePair.result.netValue,
      solo: solo.result.netValue,
      pair: pair.result.netValue,
      preferenceAtPace1,
      preferenceAtPace2,
      strictReversal: strictFlip(preferenceAtPace1, preferenceAtPace2),
      runs,
    };
  });
  const twoAtPace1 = leading.find((point) => point.leadingRoutines === 2);
  const twoAtPace2 = mixPoint(seed, 2, 2);
  if (!twoAtPace1) throw new Error('leading 2');
  return {
    conditions: {
      seed,
      horizon: 6,
      slotCapacity: 2,
      work: 2,
      complexValue: 14,
      routineValue: 8,
      complexSoloRework: 2,
      complexJobs: FOLLOW_UP_COMPLEX,
      leadingRoutines: [...FOLLOW_UP_LEADING],
      baselinePairPace: 1 as const,
      fastPairPace: 2 as const,
      strategies: {
        solo: '未着手の先頭を1枠で始める',
        pair: '未着手の先頭を2枠で始める',
        mixed: '複雑仕事は2枠が空いていればペア。定型は1枠で単独。複雑を単独では始めない',
      },
      score: 'netValue',
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionIntegration: false,
    },
    leadingRoutines: {
      pairPace: 1 as const,
      held: '進捗は1。複雑仕事3件の前に定型を1件ずつ足す。速度は動かさない。',
      points: leading,
      reversals: leadingReversals(leading),
    },
    firstBoardPace: {
      pairPace: 2 as const,
      held: '初回と同じ複雑3件と定型6件。進捗だけを2にする。混合方針は動かさない。',
      points: paceOnFirst,
    },
    twoRoutinePace: {
      leadingRoutines: 2,
      pairPace: 2 as const,
      held: '先頭定型2件・複雑3件のまま。進捗だけを2にする。',
      baseline: {
        pairPace: 1 as const,
        solo: twoAtPace1.solo,
        pair: twoAtPace1.pair,
        mixed: twoAtPace1.mixed,
        pairVsSolo: twoAtPace1.pairVsSolo,
        mixedVsSolo: twoAtPace1.mixedVsSolo,
        pairVsMixed: twoAtPace1.pairVsMixed,
      },
      solo: twoAtPace2.solo,
      pair: twoAtPace2.pair,
      mixed: twoAtPace2.mixed,
      pairVsSolo: twoAtPace2.pairVsSolo,
      mixedVsSolo: twoAtPace2.mixedVsSolo,
      pairVsMixed: twoAtPace2.pairVsMixed,
      strictReversals: {
        pair: strictFlip(twoAtPace1.pairVsSolo, twoAtPace2.pairVsSolo),
        mixed: strictFlip(twoAtPace1.mixedVsSolo, twoAtPace2.mixedVsSolo),
        pairVsMixed: strictFlip(twoAtPace1.pairVsMixed, twoAtPace2.pairVsMixed),
      },
      runs: twoAtPace2.runs,
    },
  };
}
export function pairFollowUpRuns(report: ReturnType<typeof comparePairFollowUp>): PairRun[] {
  return [
    ...report.leadingRoutines.points.flatMap((point) => point.runs),
    ...report.firstBoardPace.points.flatMap((point) => point.runs),
    ...report.twoRoutinePace.runs,
  ];
}

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
}
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
/** 手戻り1工数→レビュー1枠→FIFO投入→CI処理→終端計上。 */
export function tickCiPrototype(state: CiState, input: 'all' | 'paced'): CiState {
  if (state.tick >= state.horizon || state.budget < state.capacity) return state;
  const next = structuredClone(state);
  next.tick++;
  next.budget -= next.capacity;
  const rework = next.jobs.find((job) => job.stage === 'rework');
  if (rework) {
    rework.stage = 'review';
    rework.reviewLeft = 0;
  }
  const review = next.jobs.find((job) => job.stage === 'review' && job.reviewLeft > 0);
  if (review) review.reviewLeft--;
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
      job.ciLeft = 2;
      job.queuedOrder = null;
    } else {
      job.stage = 'done';
      job.completedTick = next.tick;
    }
  }
  next.inputs.push(input);
  return next;
}
export function summarizeCi(state: CiState) {
  const done = state.jobs.filter((job) => job.stage === 'done');
  const value = done.reduce((sum, job) => sum + job.value, 0);
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

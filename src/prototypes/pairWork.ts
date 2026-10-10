/** RI-178: ペアは2枠で進捗1。複雑な単独作業だけ手戻り2tick。人物育成は扱わない。 */
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
export type PairStrategy = 'solo' | 'pair';
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
    job.stage = job.reworkLeft > 0 && needed === 1 ? 'rework' : 'active';
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
      job.progress += 1;
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
  if (backlog && strategy === 'pair' && state.freeSlots >= 2)
    return { type: 'pair', id: backlog.id };
  if (backlog && strategy === 'solo' && state.freeSlots >= 1)
    return { type: 'solo', id: backlog.id };
  return { type: 'tick' };
}
export function comparePairStrategies(seed: string) {
  return (['complex', 'routine'] as const).flatMap((board) =>
    (['solo', 'pair'] as const).map((strategy) => {
      const initial = createPairPrototype(seed, board);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 40) throw new Error(`${board}:${strategy}`);
        const next = applyPairInput(state, choosePairAction(state, strategy));
        if (next === state) throw new Error(`${board}:${strategy} tick ${state.tick}`);
        state = next;
      }
      return { board, strategy, initial, inputs: state.inputs, result: summarizePair(state) };
    }),
  );
}

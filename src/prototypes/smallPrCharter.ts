/** RI-219: 小PR憲章。size が上限を超える出荷だけを禁止する。 */

export const SMALL_PR_LIMIT = 2;

export type CharterBoard = 'safe' | 'risky';
export type CharterStrategy = 'free' | 'charter';

export interface CharterJob {
  id: string;
  size: number;
  value: number;
  risk: number;
  done: boolean;
}

export type CharterInput =
  | { type: 'adopt' }
  | { type: 'split'; id: string }
  | { type: 'ship'; id: string }
  | { type: 'wait' };

export interface CharterState {
  version: 1;
  seed: string;
  board: CharterBoard;
  tick: number;
  horizon: number;
  riskWeight: number;
  charter: boolean;
  adoptedAt: number | null;
  jobs: CharterJob[];
  value: number;
  inputs: CharterInput[];
}

const RISK_WEIGHT: Record<CharterBoard, number> = { safe: 0, risky: 1 };

export function charterBlocks(charter: boolean, size: number): boolean {
  return charter && size > SMALL_PR_LIMIT;
}

/** 既存のサイズ上限がある場合は厳しい方だけを採用し、効果は足さない。 */
export function effectiveSizeLimit(charter: boolean, existing: number | null): number | null {
  if (!charter) return existing;
  if (existing === null) return SMALL_PR_LIMIT;
  return Math.min(existing, SMALL_PR_LIMIT);
}

function createJobs(): CharterJob[] {
  return [
    { id: 'small', size: 2, value: 4, risk: 0, done: false },
    { id: 'large', size: 4, value: 10, risk: 6, done: false },
  ];
}

export function createSmallPrCharter(seed: string, board: CharterBoard): CharterState {
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 3,
    riskWeight: RISK_WEIGHT[board],
    charter: false,
    adoptedAt: null,
    jobs: createJobs(),
    value: 0,
    inputs: [],
  };
}

function findJob(state: CharterState, id: string): CharterJob | undefined {
  return state.jobs.find((job) => job.id === id);
}

export function applySmallPrCharter(state: CharterState, input: CharterInput): CharterState {
  if (input.type === 'adopt') {
    if (state.charter || state.tick !== 0) return state;
    const next = structuredClone(state);
    next.charter = true;
    next.adoptedAt = state.tick;
    next.inputs.push({ type: 'adopt' });
    return next;
  }
  if (state.tick >= state.horizon) return state;
  if (input.type === 'wait') {
    const next = structuredClone(state);
    next.tick += 1;
    next.inputs.push({ type: 'wait' });
    return next;
  }
  const job = findJob(state, input.type === 'split' || input.type === 'ship' ? input.id : '');
  if (!job || job.done) return state;
  if (input.type === 'split') {
    if (!state.charter || job.size <= SMALL_PR_LIMIT) return state;
    const next = structuredClone(state);
    next.jobs = next.jobs.filter((candidate) => candidate.id !== job.id);
    next.jobs.push(
      { id: `${job.id}-a`, size: SMALL_PR_LIMIT, value: job.value / 2, risk: 0, done: false },
      { id: `${job.id}-b`, size: SMALL_PR_LIMIT, value: job.value / 2, risk: 0, done: false },
    );
    next.tick += 1;
    next.inputs.push({ type: 'split', id: job.id });
    return next;
  }
  if (input.type !== 'ship' || charterBlocks(state.charter, job.size)) return state;
  const next = structuredClone(state);
  const target = findJob(next, job.id);
  if (!target) return state;
  target.done = true;
  next.value += target.value - target.risk * next.riskWeight;
  next.tick += 1;
  next.inputs.push({ type: 'ship', id: job.id });
  return next;
}

export function viewSmallPrCharter(state: CharterState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    charter: state.charter,
    adoptedAt: state.adoptedAt,
    limit: state.charter ? SMALL_PR_LIMIT : null,
    forbids: state.charter ? 'sizeが2を超える出荷' : null,
    change: '開始時のみ',
    jobs: state.jobs.map((job) => ({
      id: job.id,
      size: job.size,
      done: job.done,
      blocked: charterBlocks(state.charter, job.size) && !job.done,
    })),
  };
}

export function summarizeSmallPrCharter(state: CharterState) {
  return {
    value: state.value,
    score: state.value,
    charter: state.charter,
    pending: state.jobs.filter((job) => !job.done).map((job) => job.id),
    lost: false,
  };
}

function netValue(state: CharterState, job: CharterJob): number {
  return job.value - job.risk * state.riskWeight;
}

export function chooseCharterAction(state: CharterState, strategy: CharterStrategy): CharterInput {
  if (strategy === 'charter' && !state.charter) return { type: 'adopt' };
  const open = state.jobs.filter((job) => !job.done);
  const blocked = open.find((job) => charterBlocks(state.charter, job.size));
  if (blocked) return { type: 'split', id: blocked.id };
  const next = [...open].sort(
    (a, b) => netValue(state, b) - netValue(state, a) || a.id.localeCompare(b.id),
  )[0];
  if (!next) return { type: 'wait' };
  return { type: 'ship', id: next.id };
}

export function compareSmallPrCharters(seed = 'RI-219') {
  return (['safe', 'risky'] as const).flatMap((board) =>
    (['free', 'charter'] as const).map((strategy) => {
      const initial = createSmallPrCharter(seed, board);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 20) throw new Error(`${board}:${strategy}`);
        const input = chooseCharterAction(state, strategy);
        const next = applySmallPrCharter(state, input);
        if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
        state = next;
      }
      return {
        board,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeSmallPrCharter(state),
      };
    }),
  );
}

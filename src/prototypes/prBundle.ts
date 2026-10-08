/** RI-167: 同領域・未着手のレビュー2件だけを束ねる固定試作。 */
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
  | { type: 'bundle'; ids: string[] }
  | { type: 'work'; id: string }
  | { type: 'wait' };
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
}
export function createBundlePrototype(seed: string, failFirst = false): BundleState {
  return {
    version: 1,
    seed,
    tick: 0,
    horizon: 7,
    workSpent: 0,
    fixedCost: 0,
    jobs: ['a', 'b'].map((id, i) => ({
      id,
      domain: 'product',
      stage: 'review',
      value: 6,
      doneTick: null,
      rechecks: 0,
      failFirst: i === 1 && failFirst,
    })),
    groups: ['a', 'b'].map((id) => ({ ids: [id], workLeft: 3, started: false, failed: false })),
    inputs: [],
  };
}
export function applyBundleInput(state: BundleState, input: BundleInput): BundleState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'bundle') {
    const ids = [...input.ids].sort();
    const jobs = ids.map((id) => state.jobs.find((j) => j.id === id));
    if (
      ids.length !== 2 ||
      new Set(ids).size !== 2 ||
      jobs.some((j) => !j || j.stage !== 'review') ||
      jobs[0]!.domain !== jobs[1]!.domain ||
      ids.some(
        (id) => !state.groups.some((g) => g.ids.length === 1 && g.ids[0] === id && !g.started),
      )
    )
      return state;
    const next = structuredClone(state);
    next.groups = next.groups.filter((g) => !ids.includes(g.ids[0]));
    next.groups.push({ ids, workLeft: 4, started: false, failed: false });
    next.inputs.push(structuredClone(input));
    return next;
  }
  const group =
    input.type === 'work'
      ? state.groups.find((g) => g.ids.includes(input.id) && g.workLeft > 0)
      : undefined;
  if (input.type === 'work' && !group) return state;
  const next = structuredClone(state);
  next.tick++;
  if (group) {
    const selected = next.groups.find((g) => g.ids[0] === group.ids[0])!;
    if (!selected.started) next.fixedCost += 2;
    selected.started = true;
    selected.workLeft--;
    next.workSpent++;
    if (selected.workLeft === 0) {
      if (
        !selected.failed &&
        selected.ids.some((id) => next.jobs.find((j) => j.id === id)!.failFirst)
      ) {
        selected.failed = true;
        selected.started = false;
        // 再確認も固定費2＋内容1/件。束全体が失敗範囲になり、元IDで記録する。
        selected.workLeft = 2 + selected.ids.length;
        for (const id of selected.ids) next.jobs.find((j) => j.id === id)!.rechecks++;
      } else
        for (const id of selected.ids) {
          const job = next.jobs.find((j) => j.id === id)!;
          job.stage = 'done';
          job.doneTick = next.tick;
        }
    }
  }
  next.inputs.push(structuredClone(input));
  return next;
}
export function summarizeBundle(state: BundleState) {
  return {
    value: state.jobs.filter((j) => j.stage === 'done').reduce((n, j) => n + j.value, 0),
    workSpent: state.workSpent,
    fixedCost: state.fixedCost,
    jobs: state.jobs,
    remaining: state.groups.filter((g) => g.workLeft > 0),
  };
}
export function compareBundleStrategies(seed: string) {
  return [false, true].flatMap((failFirst) =>
    (['separate', 'bundle'] as const).map((strategy) => {
      const initial = createBundlePrototype(seed, failFirst);
      let state =
        strategy === 'bundle'
          ? applyBundleInput(initial, { type: 'bundle', ids: ['a', 'b'] })
          : initial;
      while (state.tick < state.horizon) {
        const group = state.groups.find((g) => g.workLeft > 0);
        if (!group) break;
        state = applyBundleInput(state, { type: 'work', id: group.ids[0] });
      }
      return { failFirst, strategy, initial, inputs: state.inputs, result: summarizeBundle(state) };
    }),
  );
}

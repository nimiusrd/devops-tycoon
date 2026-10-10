/** RI-216: 3チーム・依存2本。通常の組織シミュレーションとは接続しない。 */

export const TEAMS = ['platform', 'product', 'incident'] as const;
export type TeamId = (typeof TEAMS)[number];
export type DependencyBoard = 'tight' | 'open';
export type DependencyStrategy = 'upstream' | 'crisis';

export interface TeamJob {
  id: string;
  team: TeamId;
  requires: string[];
  workLeft: number;
  total: number;
  value: number;
  deadline: number | null;
  lateValue: number;
  doneTick: number | null;
}

export interface DependencyEdge {
  requires: string;
  unlocks: string;
  source: TeamId;
  target: TeamId;
}

export type DependencyInput =
  { type: 'support'; team: TeamId } | { type: 'view'; team: TeamId } | { type: 'wait' };

export interface DependencyState {
  version: 1;
  seed: string;
  board: DependencyBoard;
  tick: number;
  horizon: number;
  jobs: TeamJob[];
  delivered: { id: string; tick: number; value: number }[];
  wasted: number;
  viewed: TeamId[];
  inputs: DependencyInput[];
}

const BOARDS: Record<DependencyBoard, number> = { tight: 3, open: 4 };

/** 完了と同じ期間には解放しない。次の処理機会からだけ対象になる。 */
export function unlockedForNextPeriod(doneTick: number | null, tick: number): boolean {
  return doneTick !== null && doneTick < tick;
}

export function dependencyEdges(jobs: readonly TeamJob[]): DependencyEdge[] {
  return jobs.flatMap((job) =>
    job.requires.map((requires) => {
      const source = jobs.find((candidate) => candidate.id === requires);
      if (!source) throw new Error('前提の欠落');
      return { requires, unlocks: job.id, source: source.team, target: job.team };
    }),
  );
}

function assertAcyclic(jobs: readonly TeamJob[]): void {
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error('循環依存');
    const job = jobs.find((candidate) => candidate.id === id);
    if (!job) throw new Error('前提の欠落');
    visiting.add(id);
    job.requires.forEach(visit);
    visiting.delete(id);
  };
  jobs.forEach((job) => visit(job.id));
}

function createJobs(): TeamJob[] {
  return [
    {
      id: 'gate',
      team: 'platform',
      requires: [],
      workLeft: 2,
      total: 2,
      value: 1,
      deadline: null,
      lateValue: 1,
      doneTick: null,
    },
    {
      id: 'feature',
      team: 'product',
      requires: ['gate'],
      workLeft: 2,
      total: 2,
      value: 8,
      deadline: null,
      lateValue: 8,
      doneTick: null,
    },
    {
      id: 'followup',
      team: 'incident',
      requires: ['gate'],
      workLeft: 2,
      total: 2,
      value: 4,
      deadline: null,
      lateValue: 4,
      doneTick: null,
    },
    {
      id: 'hot',
      team: 'incident',
      requires: [],
      workLeft: 2,
      total: 2,
      value: 6,
      deadline: 2,
      lateValue: 0,
      doneTick: null,
    },
  ];
}

export function createTeamDependencyPrototype(
  seed: string,
  board: DependencyBoard,
): DependencyState {
  const jobs = createJobs();
  const edges = dependencyEdges(jobs);
  assertAcyclic(jobs);
  if (edges.length !== 2) throw new Error('依存は2本');
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: BOARDS[board],
    jobs,
    delivered: [],
    wasted: 0,
    viewed: [],
    inputs: [],
  };
}

function jobById(state: DependencyState, id: string): TeamJob {
  const job = state.jobs.find((candidate) => candidate.id === id);
  if (!job) throw new Error('未知の仕事');
  return job;
}

export function jobEligible(state: DependencyState, id: string): boolean {
  const job = jobById(state, id);
  if (job.doneTick !== null || job.workLeft <= 0) return false;
  return job.requires.every((required) =>
    unlockedForNextPeriod(jobById(state, required).doneTick, state.tick),
  );
}

function deliveryValue(job: TeamJob, tick: number): number {
  if (job.deadline !== null && tick > job.deadline) return job.lateValue;
  return job.value;
}

/** 期間開始時の対象だけを進め、完了順は仕事の定義順に固定する。 */
export function supportMany(state: DependencyState, teams: readonly TeamId[]): DependencyState {
  if (state.tick >= state.horizon || teams.length === 0) return state;
  if (teams.some((team) => !TEAMS.includes(team))) return state;
  const next = structuredClone(state);
  const eligible = new Set(
    next.jobs.filter((job) => jobEligible(next, job.id)).map((job) => job.id),
  );
  const chosen = new Set<string>();
  for (const team of teams) {
    const job = next.jobs
      .filter(
        (candidate) =>
          candidate.team === team && eligible.has(candidate.id) && !chosen.has(candidate.id),
      )
      .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))[0];
    if (!job) {
      next.wasted += 1;
      continue;
    }
    chosen.add(job.id);
  }
  for (const job of next.jobs) {
    if (!chosen.has(job.id)) continue;
    job.workLeft -= 1;
    if (job.workLeft > 0) continue;
    job.doneTick = next.tick;
    next.delivered.push({ id: job.id, tick: next.tick, value: deliveryValue(job, next.tick) });
  }
  next.tick += 1;
  teams.forEach((team) => next.inputs.push({ type: 'support', team }));
  return next;
}

export function applyTeamDependency(
  state: DependencyState,
  input: DependencyInput,
): DependencyState {
  if (input.type === 'view') {
    if (state.viewed.includes(input.team)) return state;
    const next = structuredClone(state);
    next.viewed.push(input.team);
    next.inputs.push(input);
    return next;
  }
  if (state.tick >= state.horizon) return state;
  if (input.type === 'wait') {
    const next = structuredClone(state);
    next.tick += 1;
    next.inputs.push({ type: 'wait' });
    return next;
  }
  if (input.type !== 'support') return state;
  return supportMany(state, [input.team]);
}

export function viewTeamDependencies(state: DependencyState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    edges: dependencyEdges(state.jobs).map((edge) => ({
      ...edge,
      unlocked: unlockedForNextPeriod(jobById(state, edge.requires).doneTick, state.tick),
      blocked: !jobEligible(state, edge.unlocks) && jobById(state, edge.unlocks).doneTick === null,
    })),
    jobs: state.jobs.map((job) => ({
      id: job.id,
      team: job.team,
      workLeft: job.workLeft,
      eligible: jobEligible(state, job.id),
      doneTick: job.doneTick,
      requires: [...job.requires],
    })),
    fanout: { platform: 2, product: 0, incident: 0 },
    viewed: [...state.viewed],
  };
}

export function summarizeTeamDependency(state: DependencyState) {
  const value = state.delivered.reduce((sum, item) => sum + item.value, 0);
  return {
    value,
    wasted: state.wasted,
    delivered: state.delivered.map((item) => ({ ...item })),
    pending: state.jobs.filter((job) => job.doneTick === null).map((job) => job.id),
    score: value,
    lost: false,
  };
}

function gateOpen(state: DependencyState): boolean {
  return jobById(state, 'gate').doneTick !== null;
}

export function chooseDependencyAction(
  state: DependencyState,
  strategy: DependencyStrategy,
): DependencyInput {
  const hot = jobById(state, 'hot');
  if (
    strategy === 'crisis' &&
    hot.doneTick === null &&
    (hot.deadline === null || state.tick <= hot.deadline)
  ) {
    return { type: 'support', team: 'incident' };
  }
  if (!gateOpen(state)) return { type: 'support', team: 'platform' };
  if (jobEligible(state, 'feature')) return { type: 'support', team: 'product' };
  if (state.jobs.some((job) => job.team === 'incident' && jobEligible(state, job.id))) {
    return { type: 'support', team: 'incident' };
  }
  return { type: 'wait' };
}

export function compareTeamDependencies(seed = 'RI-216') {
  return (['tight', 'open'] as const).flatMap((board) =>
    (['upstream', 'crisis'] as const).map((strategy) => {
      const initial = createTeamDependencyPrototype(seed, board);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 20) throw new Error(`${board}:${strategy}`);
        const input = chooseDependencyAction(state, strategy);
        const next = applyTeamDependency(state, input);
        if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
        state = next;
      }
      return {
        board,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeTeamDependency(state),
      };
    }),
  );
}

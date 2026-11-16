/** RI-216: 3チーム・依存2本。通常の組織シミュレーションとは接続しない。 */

export const TEAMS = ['platform', 'product', 'incident'] as const;
export type TeamId = (typeof TEAMS)[number];
export type DependencyBoard = 'tight' | 'open';
export type DependencyStrategy = 'upstream' | 'crisis';
export type DependencyJudgment = 'aware' | 'blind';

/** 初回の資源を基準に、一つだけ動かして優劣の反転を見る。 */
export interface DependencyRules {
  passive: number;
  split: number;
  deadline: number;
}

export const baselineDependencyRules: DependencyRules = {
  passive: 0,
  split: 1,
  deadline: 2,
};

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
  | { type: 'support'; team: TeamId }
  | { type: 'support-batch'; teams: TeamId[] }
  | { type: 'view'; team: TeamId }
  | { type: 'wait' };

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
  next.inputs.push(
    teams.length === 1
      ? { type: 'support', team: teams[0] }
      : { type: 'support-batch', teams: [...teams] },
  );
  return next;
}

export function applyTeamDependency(
  state: DependencyState,
  input: DependencyInput,
  rules: DependencyRules = baselineDependencyRules,
): DependencyState {
  if (input.type !== 'view' && (rules.passive > 0 || rules.split > 1)) {
    return applyRuledPeriod(state, input, rules);
  }
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
  if (input.type === 'support') return supportMany(state, [input.team]);
  if (input.type === 'support-batch') return supportMany(state, input.teams);
  return state;
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

const FACTOR_SEED = 'RI-216';
const BASE_HORIZONS = [3, 4] as const;
const FOLLOWUP_HORIZONS = [3, 4, 5, 6, 7, 8] as const;

/** 支援1を1・2・3等分しても工数がずれないように、6分の1単位で足す。 */
const EFFORT_SCALE = 6;

function effortUnits(value: number): number {
  return Math.round(value * EFFORT_SCALE);
}

function copyInput(input: DependencyInput): DependencyInput {
  if (input.type === 'support-batch') return { type: 'support-batch', teams: [...input.teams] };
  return input;
}

function bestEligible(
  state: DependencyState,
  team: TeamId,
  eligible: ReadonlySet<string>,
  taken: ReadonlySet<string>,
): TeamJob | undefined {
  return state.jobs
    .filter((job) => job.team === team && eligible.has(job.id) && !taken.has(job.id))
    .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))[0];
}

function applyEfforts(state: DependencyState, effort: ReadonlyMap<string, number>): void {
  for (const job of state.jobs) {
    const amount = effort.get(job.id);
    if (!amount) continue;
    const left = effortUnits(job.workLeft) - amount;
    job.workLeft = left > 0 ? left / EFFORT_SCALE : 0;
    if (left > 0) continue;
    job.doneTick = state.tick;
    state.delivered.push({ id: job.id, tick: state.tick, value: deliveryValue(job, state.tick) });
  }
}

/** 自チーム処理と分割支援。分割1・処理0の初回経路はここを通らない。 */
function applyRuledPeriod(
  state: DependencyState,
  input: DependencyInput,
  rules: DependencyRules,
): DependencyState {
  if (state.tick >= state.horizon) return state;
  const teams =
    input.type === 'support' ? [input.team] : input.type === 'support-batch' ? input.teams : [];
  if (
    input.type !== 'wait' &&
    (teams.length === 0 || teams.some((team) => !TEAMS.includes(team)))
  ) {
    return state;
  }
  const next = structuredClone(state);
  const eligible = new Set(
    next.jobs.filter((job) => jobEligible(next, job.id)).map((job) => job.id),
  );
  const effort = new Map<string, number>();
  const add = (id: string, amount: number) =>
    effort.set(id, (effort.get(id) ?? 0) + effortUnits(amount));
  if (rules.passive > 0) {
    for (const team of TEAMS) {
      const job = bestEligible(next, team, eligible, new Set());
      if (job) add(job.id, rules.passive);
    }
  }
  let wastedUnits = 0;
  const allocations: { team: TeamId; effort: number }[] = [];
  if (input.type !== 'wait') {
    if (rules.split <= 1) {
      allocations.push(...teams.map((team) => ({ team, effort: 1 })));
    } else {
      const piece = 1 / rules.split;
      const used = teams.slice(0, rules.split);
      allocations.push(...used.map((team) => ({ team, effort: piece })));
      wastedUnits += effortUnits(Math.max(0, 1 - piece * used.length));
    }
  }
  const taken = new Set<string>();
  for (const allocation of allocations) {
    const job = bestEligible(next, allocation.team, eligible, taken);
    if (!job) {
      wastedUnits += effortUnits(allocation.effort);
      continue;
    }
    taken.add(job.id);
    add(job.id, allocation.effort);
  }
  next.wasted = (effortUnits(next.wasted) + wastedUnits) / EFFORT_SCALE;
  applyEfforts(next, effort);
  next.tick += 1;
  next.inputs.push(copyInput(input));
  return next;
}

function eligibleTeams(state: DependencyState): Set<TeamId> {
  const teams = new Set<TeamId>();
  for (const job of state.jobs) {
    if (jobEligible(state, job.id)) teams.add(job.team);
  }
  return teams;
}

/** 依存を見て支援先を並べる。先頭は初回の上流支援と同じ。 */
function awareOrder(state: DependencyState): TeamId[] {
  const eligible = eligibleTeams(state);
  const order: TeamId[] = [];
  if (!gateOpen(state) && eligible.has('platform')) order.push('platform');
  if (eligible.has('product')) order.push('product');
  if (eligible.has('incident')) order.push('incident');
  return order;
}

/** 依存を見ずに進む。先頭は初回の危機支援と同じ。 */
function blindOrder(state: DependencyState): TeamId[] {
  const eligible = eligibleTeams(state);
  const hot = jobById(state, 'hot');
  const order: TeamId[] = [];
  if (
    hot.doneTick === null &&
    (hot.deadline === null || state.tick <= hot.deadline) &&
    eligible.has('incident')
  ) {
    order.push('incident');
  }
  if (!gateOpen(state) && eligible.has('platform')) order.push('platform');
  if (eligible.has('product')) order.push('product');
  if (eligible.has('incident') && !order.includes('incident')) order.push('incident');
  return order;
}

export function chooseDependencyFactorInput(
  state: DependencyState,
  judgment: DependencyJudgment,
  rules: DependencyRules = baselineDependencyRules,
): DependencyInput {
  const order = judgment === 'aware' ? awareOrder(state) : blindOrder(state);
  const teams = order.slice(0, Math.max(1, rules.split));
  if (teams.length === 0) return { type: 'wait' };
  if (teams.length === 1) return { type: 'support', team: teams[0] };
  return { type: 'support-batch', teams };
}

export function createTeamDependencyFactorState(
  horizon: number,
  rules: DependencyRules = baselineDependencyRules,
): DependencyState {
  const state = createTeamDependencyPrototype(FACTOR_SEED, horizon === 3 ? 'tight' : 'open');
  state.horizon = horizon;
  const hot = state.jobs.find((job) => job.id === 'hot');
  if (!hot) throw new Error('hotの欠落');
  hot.deadline = rules.deadline;
  return state;
}

export interface DependencyFactorRun {
  inputs: DependencyInput[];
  result: ReturnType<typeof summarizeTeamDependency>;
}

export type DependencyPreference = 'aware' | 'blind' | 'tie';

export interface DependencyFactorBoard {
  horizon: number;
  aware: DependencyFactorRun;
  blind: DependencyFactorRun;
  preference: DependencyPreference;
  margin: number;
}

export interface DependencyFactorPoint {
  axis: 'passive' | 'split' | 'horizon' | 'deadline';
  parameter: string;
  rules: DependencyRules;
  boards: DependencyFactorBoard[];
}

export interface DependencyFactorReversal {
  axis: DependencyFactorPoint['axis'];
  before: {
    parameter: string;
    horizon: number;
    preference: DependencyPreference;
    aware: number;
    blind: number;
  };
  after: {
    parameter: string;
    horizon: number;
    preference: DependencyPreference;
    aware: number;
    blind: number;
  };
}

function preferenceOf(aware: number, blind: number): DependencyPreference {
  if (aware > blind) return 'aware';
  if (blind > aware) return 'blind';
  return 'tie';
}

function withRules(patch: Partial<DependencyRules>): DependencyRules {
  return { ...baselineDependencyRules, ...patch };
}

function runJudgment(
  horizon: number,
  judgment: DependencyJudgment,
  rules: DependencyRules,
): DependencyFactorRun {
  let state = createTeamDependencyFactorState(horizon, rules);
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 30) throw new Error(`${judgment}:${horizon}`);
    const input = chooseDependencyFactorInput(state, judgment, rules);
    const next = applyTeamDependency(state, input, rules);
    if (next === state) throw new Error(`${judgment}:${horizon}@${state.tick}`);
    state = next;
  }
  return { inputs: state.inputs, result: summarizeTeamDependency(state) };
}

function factorPoint(
  axis: DependencyFactorPoint['axis'],
  parameter: string,
  rules: DependencyRules,
  horizons: readonly number[],
): DependencyFactorPoint {
  return {
    axis,
    parameter,
    rules: { ...rules },
    boards: horizons.map((horizon) => {
      const aware = runJudgment(horizon, 'aware', rules);
      const blind = runJudgment(horizon, 'blind', rules);
      return {
        horizon,
        aware,
        blind,
        preference: preferenceOf(aware.result.score, blind.result.score),
        margin: aware.result.score - blind.result.score,
      };
    }),
  };
}

function packReversal(
  point: DependencyFactorPoint,
  board: DependencyFactorBoard,
): DependencyFactorReversal['before'] {
  return {
    parameter: point.parameter,
    horizon: board.horizon,
    preference: board.preference,
    aware: board.aware.result.score,
    blind: board.blind.result.score,
  };
}

function reversalsOf(rows: DependencyFactorPoint[]): DependencyFactorReversal[] {
  const found: DependencyFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after) continue;
    if (before.axis === 'horizon') {
      const early = before.boards[0];
      const late = after.boards[0];
      if (!early || !late || early.preference === late.preference) continue;
      found.push({
        axis: 'horizon',
        before: packReversal(before, early),
        after: packReversal(after, late),
      });
      continue;
    }
    for (const horizon of BASE_HORIZONS) {
      const early = before.boards.find((board) => board.horizon === horizon);
      const late = after.boards.find((board) => board.horizon === horizon);
      if (!early || !late || early.preference === late.preference) continue;
      found.push({
        axis: before.axis,
        before: packReversal(before, early),
        after: packReversal(after, late),
      });
    }
  }
  return found;
}

/** 初回と同じ資源で、自チーム処理・支援の分割・期末・期限を一つずつ動かす。固定戦略。 */
export function compareTeamDependencyFactors() {
  const sweeps = {
    passive: [0, 1, 2].map((passive) =>
      factorPoint('passive', String(passive), withRules({ passive }), BASE_HORIZONS),
    ),
    split: [1, 2, 3].map((split) =>
      factorPoint('split', String(split), withRules({ split }), BASE_HORIZONS),
    ),
    horizon: FOLLOWUP_HORIZONS.map((horizon) =>
      factorPoint('horizon', String(horizon), withRules({}), [horizon]),
    ),
    deadline: [0, 1, 2, 3].map((deadline) =>
      factorPoint('deadline', String(deadline), withRules({ deadline }), BASE_HORIZONS),
    ),
  };
  return {
    conditions: {
      seed: FACTOR_SEED,
      horizons: [...BASE_HORIZONS],
      followupHorizons: [...FOLLOWUP_HORIZONS],
      jobs: {
        gate: { work: 2, value: 1 },
        feature: { work: 2, value: 8, requires: 'gate' },
        followup: { work: 2, value: 4, requires: 'gate' },
        hot: { work: 2, value: 6, lateValue: 0 },
      },
      support: 1,
      decision: {
        aware:
          '依存を見て、前提が閉じていれば platform、feature が対象なら product、それ以外は incident',
        blind: '依存を見ず、期限内の hot が残っていれば incident、その後は同じ順',
        score: '納品した価値の合計',
        preference: '依存を見る差引が大きいとき aware、見ない方が大きいとき blind、同じとき tie',
      },
      baseline: { ...baselineDependencyRules },
      held: {
        passive:
          '自チームが支援なしで進める工数だけを動かす。支援は1チームへ1、期限は2、期末は3と4',
        split:
          '1工数を等分する数だけを動かす。自チーム処理は0、期限は2、期末は3と4。余った分割は空振り',
        horizon: '期末だけを動かす。自チーム処理は0、支援は分割しない、期限は2。仕事量は初回と同じ',
        deadline: 'hot の期限 tick だけを動かす。自チーム処理は0、支援は分割しない、期末は3と4',
      },
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    },
    sweeps,
    reversals: [
      ...reversalsOf(sweeps.passive),
      ...reversalsOf(sweeps.split),
      ...reversalsOf(sweeps.horizon),
      ...reversalsOf(sweeps.deadline),
    ],
  };
}

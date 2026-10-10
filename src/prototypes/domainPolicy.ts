/** RI-199: 方針が種類ごとのAI可否を先に決め、メンバー配布はその範囲だけで効く。 */

export type TaskKind = 'routine' | 'complex';
export type AiPolicy = 'all' | 'routine' | 'off';
export type DomainBoard = 'routine' | 'important';
export type DomainStrategy = 'all' | 'routine' | 'off' | 'no-member';
export interface DomainJob {
  id: string;
  kind: TaskKind;
  work: number;
  progress: number;
  value: number;
  aiAssisted: boolean;
  shipped: number | null;
  incident: number;
}
export type DomainInput =
  | { type: 'configure'; policy: string; memberAi: boolean }
  | { type: 'tick' };
export interface DomainState {
  version: 1;
  seed: string;
  board: DomainBoard;
  tick: number;
  horizon: number;
  policy: AiPolicy | null;
  memberAi: boolean | null;
  value: number;
  fees: number;
  incidents: number;
  aiTicks: number;
  humanTicks: number;
  jobs: DomainJob[];
  inputs: DomainInput[];
}

const FEE = 1;
const INCIDENT = 6;
const HUMAN = 1;
const AI = 2;

const BOARDS: Record<
  DomainBoard,
  { horizon: number; jobs: Array<Pick<DomainJob, 'id' | 'kind' | 'work' | 'value'>> }
> = {
  routine: {
    horizon: 6,
    jobs: [
      { id: 'r1', kind: 'routine', work: 2, value: 5 },
      { id: 'r2', kind: 'routine', work: 2, value: 5 },
      { id: 'r3', kind: 'routine', work: 2, value: 5 },
      { id: 'r4', kind: 'routine', work: 2, value: 5 },
      { id: 'c1', kind: 'complex', work: 2, value: 8 },
    ],
  },
  important: {
    horizon: 4,
    jobs: [
      { id: 'c1', kind: 'complex', work: 4, value: 20 },
      { id: 'c2', kind: 'complex', work: 4, value: 20 },
      { id: 'r1', kind: 'routine', work: 2, value: 4 },
    ],
  },
};

export function policyAllows(policy: AiPolicy, kind: TaskKind): boolean {
  if (policy === 'all') return true;
  if (policy === 'routine') return kind === 'routine';
  return false;
}

export function createDomainPolicyPrototype(seed: string, board: DomainBoard): DomainState {
  const preset = BOARDS[board];
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: preset.horizon,
    policy: null,
    memberAi: null,
    value: 0,
    fees: 0,
    incidents: 0,
    aiTicks: 0,
    humanTicks: 0,
    jobs: preset.jobs.map((job) => ({
      ...job,
      progress: 0,
      aiAssisted: false,
      shipped: null,
      incident: 0,
    })),
    inputs: [],
  };
}

export function viewDomainPolicy(state: DomainState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    board: state.board,
    policy: state.policy,
    memberAi: state.memberAi,
    feePerAiTick: FEE,
    complexIncident: INCIDENT,
    speeds: { human: HUMAN, ai: AI },
    jobs: state.jobs.map((job) => ({
      id: job.id,
      kind: job.kind,
      work: job.work,
      progress: job.progress,
      value: job.value,
      allowed: state.policy === null ? null : policyAllows(state.policy, job.kind),
      willAssist:
        state.policy !== null && state.memberAi !== null
          ? state.memberAi && policyAllows(state.policy, job.kind)
          : null,
      aiAssisted: job.aiAssisted,
      shipped: job.shipped,
      incident: job.incident,
    })),
  };
}

function isPolicy(value: string): value is AiPolicy {
  return value === 'all' || value === 'routine' || value === 'off';
}

function openJob(state: DomainState): DomainJob | undefined {
  return state.jobs.find((job) => job.shipped === null);
}

export function applyDomainPolicyInput(state: DomainState, input: DomainInput): DomainState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'configure') return configure(state, input.policy, input.memberAi);
  if (state.policy === null || state.memberAi === null) return state;
  const next = structuredClone(state);
  next.tick += 1;
  const job = openJob(next);
  if (job) work(next, job);
  next.inputs.push({ type: 'tick' });
  return next;
}

function configure(state: DomainState, policy: string, memberAi: boolean): DomainState {
  if (state.policy !== null || !isPolicy(policy) || typeof memberAi !== 'boolean') return state;
  const next = structuredClone(state);
  next.policy = policy;
  next.memberAi = memberAi;
  next.inputs.push({ type: 'configure', policy, memberAi });
  return next;
}

function work(state: DomainState, job: DomainJob): void {
  const assisted = state.memberAi === true && policyAllows(state.policy!, job.kind);
  job.aiAssisted = assisted;
  job.progress += assisted ? AI : HUMAN;
  if (assisted) {
    state.fees += FEE;
    state.aiTicks += 1;
  } else {
    state.humanTicks += 1;
  }
  if (job.progress < job.work) return;
  job.shipped = state.tick;
  state.value += job.value;
  if (assisted && job.kind === 'complex') {
    job.incident = INCIDENT;
    state.incidents += INCIDENT;
  }
}

export function summarizeDomainPolicy(state: DomainState) {
  return {
    policy: state.policy,
    memberAi: state.memberAi,
    value: state.value,
    fees: state.fees,
    incidents: state.incidents,
    netValue: state.value - state.fees - state.incidents,
    aiTicks: state.aiTicks,
    humanTicks: state.humanTicks,
    jobs: state.jobs.map((job) => ({
      id: job.id,
      kind: job.kind,
      aiAssisted: job.aiAssisted,
      shipped: job.shipped,
      incident: job.incident,
    })),
  };
}

export function chooseDomainPolicyAction(
  state: DomainState,
  strategy: DomainStrategy,
): DomainInput {
  if (state.policy !== null) return { type: 'tick' };
  if (strategy === 'no-member') return { type: 'configure', policy: 'all', memberAi: false };
  return {
    type: 'configure',
    policy: strategy === 'all' ? 'all' : strategy,
    memberAi: true,
  };
}

export function compareDomainPolicies(seed = 'RI-199') {
  return (['routine', 'important'] as const).flatMap((board) =>
    (['all', 'routine', 'off', 'no-member'] as const).map((strategy) => {
      const initial = createDomainPolicyPrototype(seed, board);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 20) throw new Error(`${board}:${strategy}`);
        const next = applyDomainPolicyInput(state, chooseDomainPolicyAction(state, strategy));
        if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
        state = next;
      }
      return {
        board,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeDomainPolicy(state),
      };
    }),
  );
}

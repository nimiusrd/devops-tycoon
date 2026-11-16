/** RI-199: 方針が種類ごとのAI可否を先に決め、メンバー配布はその範囲だけで効く。 */

export type TaskKind = 'routine' | 'complex';
export type AiPolicy = 'all' | 'routine' | 'off';
export type DomainBoard = 'routine' | 'important';
export type DomainStrategy = 'all' | 'routine' | 'off' | 'no-member';
/** 感度で一つだけ動かす係数。人の速度は含めない。 */
export interface DomainFactorRules {
  fee: number;
  aiSpeed: number;
  incident: number;
}
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
  { type: 'configure'; policy: string; memberAi: boolean } | { type: 'tick' };
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

/** 初回比較の係数。感度ではこのうち一つだけを変える。 */
export const baselineDomainRules: DomainFactorRules = {
  fee: FEE,
  aiSpeed: AI,
  incident: INCIDENT,
};

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

export function applyDomainPolicyInput(
  state: DomainState,
  input: DomainInput,
  rules: DomainFactorRules = baselineDomainRules,
): DomainState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'configure') return configure(state, input.policy, input.memberAi);
  if (state.policy === null || state.memberAi === null) return state;
  const next = structuredClone(state);
  next.tick += 1;
  const job = openJob(next);
  if (job) work(next, job, rules);
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

function work(state: DomainState, job: DomainJob, rules: DomainFactorRules): void {
  const assisted = state.memberAi === true && policyAllows(state.policy!, job.kind);
  job.aiAssisted = assisted;
  job.progress += assisted ? rules.aiSpeed : HUMAN;
  if (assisted) {
    state.fees += rules.fee;
    state.aiTicks += 1;
  } else {
    state.humanTicks += 1;
  }
  if (job.progress < job.work) return;
  job.shipped = state.tick;
  state.value += job.value;
  if (assisted && job.kind === 'complex') {
    job.incident = rules.incident;
    state.incidents += rules.incident;
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

const FACTOR_SEED = 'RI-199';
const FACTOR_BOARDS = ['routine', 'important'] as const;
/** 初回に使わない判断を上回った方針。定型中心は定型だけ、重要仕事中心は全許可。 */
const FACTOR_USE = { routine: 'routine', important: 'all' } as const satisfies Record<
  DomainBoard,
  DomainStrategy
>;
const FEE_STEPS = [0, 1, 2, 3, 4, 5] as const;
const AI_SPEED_STEPS = [1, 2, 3, 4] as const;
const INCIDENT_STEPS = [0, 4, 6, 7, 8, 9, 12] as const;
type DomainFactorAxis = 'fee' | 'aiSpeed' | 'incident';
type DomainFactorPreference = 'use' | 'off' | 'tie';
type DomainFactorStrategy = (typeof FACTOR_USE)[DomainBoard] | 'off';
interface DomainFactorRun {
  inputs: DomainInput[];
  result: ReturnType<typeof summarizeDomainPolicy>;
}
interface DomainFactorBoard {
  board: DomainBoard;
  useStrategy: (typeof FACTOR_USE)[DomainBoard];
  preference: DomainFactorPreference;
  margin: number;
  use: DomainFactorRun;
  off: DomainFactorRun;
}
interface DomainFactorPoint {
  axis: DomainFactorAxis;
  parameter: string;
  rules: DomainFactorRules;
  sameAsFirstComparison: boolean;
  boards: DomainFactorBoard[];
}
interface DomainFactorReversal {
  axis: DomainFactorAxis;
  board: DomainBoard;
  before: { parameter: string; preference: DomainFactorPreference; use: number; off: number };
  after: { parameter: string; preference: DomainFactorPreference; use: number; off: number };
}

function rulesMatchBaseline(rules: DomainFactorRules) {
  return (
    rules.fee === baselineDomainRules.fee &&
    rules.aiSpeed === baselineDomainRules.aiSpeed &&
    rules.incident === baselineDomainRules.incident
  );
}

function preferenceOf(useNet: number, offNet: number): DomainFactorPreference {
  if (useNet > offNet) return 'use';
  if (offNet > useNet) return 'off';
  return 'tie';
}

function runDomainFactor(
  board: DomainBoard,
  strategy: DomainFactorStrategy,
  rules: DomainFactorRules,
): DomainFactorRun {
  let state = createDomainPolicyPrototype(FACTOR_SEED, board);
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 20) throw new Error(`${board}:${strategy}`);
    const next = applyDomainPolicyInput(state, chooseDomainPolicyAction(state, strategy), rules);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { inputs: state.inputs, result: summarizeDomainPolicy(state) };
}

function factorBoard(board: DomainBoard, rules: DomainFactorRules): DomainFactorBoard {
  const useStrategy = FACTOR_USE[board];
  const use = runDomainFactor(board, useStrategy, rules);
  const off = runDomainFactor(board, 'off', rules);
  return {
    board,
    useStrategy,
    preference: preferenceOf(use.result.netValue, off.result.netValue),
    margin: use.result.netValue - off.result.netValue,
    use,
    off,
  };
}

function factorPoint(
  axis: DomainFactorAxis,
  parameter: string,
  rules: DomainFactorRules,
): DomainFactorPoint {
  return {
    axis,
    parameter,
    rules: { ...rules },
    sameAsFirstComparison: rulesMatchBaseline(rules),
    boards: FACTOR_BOARDS.map((board) => factorBoard(board, rules)),
  };
}

function boardAt(point: DomainFactorPoint, board: DomainBoard): DomainFactorBoard {
  const found = point.boards.find((item) => item.board === board);
  if (!found) throw new Error(board);
  return found;
}

function reversalsOf(rows: DomainFactorPoint[]): DomainFactorReversal[] {
  const found: DomainFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after) continue;
    for (const board of FACTOR_BOARDS) {
      const earlier = boardAt(before, board);
      const later = boardAt(after, board);
      if (earlier.preference === later.preference) continue;
      found.push({
        axis: before.axis,
        board,
        before: {
          parameter: before.parameter,
          preference: earlier.preference,
          use: earlier.use.result.netValue,
          off: earlier.off.result.netValue,
        },
        after: {
          parameter: after.parameter,
          preference: later.preference,
          use: later.use.result.netValue,
          off: later.off.result.netValue,
        },
      });
    }
  }
  return found;
}

function factorResources(board: DomainBoard) {
  const state = createDomainPolicyPrototype(FACTOR_SEED, board);
  return {
    horizon: state.horizon,
    use: FACTOR_USE[board],
    off: 'off' as const,
    jobs: state.jobs.map((job) => ({
      id: job.id,
      kind: job.kind,
      work: job.work,
      value: job.value,
    })),
  };
}

/** 初回と同じ資源で、利用費・AI速度・複雑作業の影響を一つずつ動かす。固定戦略。 */
export function compareDomainFactorReversals() {
  const sweeps = {
    fee: FEE_STEPS.map((fee) => factorPoint('fee', String(fee), { ...baselineDomainRules, fee })),
    aiSpeed: AI_SPEED_STEPS.map((aiSpeed) =>
      factorPoint('aiSpeed', String(aiSpeed), { ...baselineDomainRules, aiSpeed }),
    ),
    incident: INCIDENT_STEPS.map((incident) =>
      factorPoint('incident', String(incident), { ...baselineDomainRules, incident }),
    ),
  };
  return {
    conditions: {
      seed: FACTOR_SEED,
      humanSpeed: HUMAN,
      boards: {
        routine: factorResources('routine'),
        important: factorResources('important'),
      },
      decision: {
        use: '初回に使わない判断を上回った固定方針。定型中心は定型だけ、重要仕事中心は全許可',
        off: '方針off。配布があってもaiAssistedにならない',
        score: 'netValue' as const,
      },
      baseline: { ...baselineDomainRules },
      held: {
        fee: '利用費だけを動かす。AI速度2、影響6。人の速度1',
        aiSpeed: 'AI速度だけを動かす。利用費1、影響6。人の速度1',
        incident: '複雑作業の影響だけを動かす。利用費1、AI速度2。人の速度1',
      },
      feeDefinition: 'AIのtickごとに足す。完了件数には掛けない',
      aiSpeedDefinition: 'AIのtickが進める進捗。人の速度は1のまま',
      incidentDefinition: '複雑な仕事をAIのtickで完了したとき一度だけ引く。定型の完了では出ない',
      steps: {
        fee: [...FEE_STEPS],
        aiSpeed: [...AI_SPEED_STEPS],
        incident: [...INCIDENT_STEPS],
      },
      omitted: '定型中心の全許可、重要仕事中心の定型だけ、未配布は初回JSONのまま再出力しない',
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    },
    sweeps,
    reversals: [
      ...reversalsOf(sweeps.fee),
      ...reversalsOf(sweeps.aiSpeed),
      ...reversalsOf(sweeps.incident),
    ],
  };
}

/** RI-193: ゲーム内の権限2段階。実端末やGitHubの権限は操作しない。 */
export type Scope = 'read' | 'edit';
export type Domain = 'routine' | 'critical';
export type PermissionScenario = 'routine' | 'critical';
export type PermissionStrategy = Scope;
export interface PermissionJob {
  id: string;
  domain: Domain;
  work: number;
  progress: number;
  value: number;
  approvalLeft: number;
  shipped: number | null;
  blast: number;
}
export type PermissionInput = { type: 'scope'; scope: string } | { type: 'tick' };
export interface PermissionState {
  version: 1;
  seed: string;
  scenario: PermissionScenario;
  tick: number;
  horizon: number;
  scope: Scope | null;
  shippedValue: number;
  loss: number;
  jobs: PermissionJob[];
  resolutions: string[];
  inputs: PermissionInput[];
}
const JOB_WORK = 4;
/** 初回比較の資源。承認tickは重要仕事の待ち、影響は edit 出荷時に一度だけ引く。 */
export interface PermissionRules {
  approvalTicks: number;
  blast: number;
}
export const baselinePermissionRules: PermissionRules = {
  approvalTicks: 2,
  blast: 20,
};

export function createPermissionPrototype(
  seed: string,
  scenario: PermissionScenario,
  rules: PermissionRules = baselinePermissionRules,
): PermissionState {
  const jobs: PermissionJob[] =
    scenario === 'routine'
      ? [job('r1', 'routine', rules), job('r2', 'routine', rules)]
      : [job('c1', 'critical', rules)];
  return {
    version: 1,
    seed,
    scenario,
    tick: 0,
    horizon: scenario === 'routine' ? 6 : 8,
    scope: null,
    shippedValue: 0,
    loss: 0,
    jobs,
    resolutions: [],
    inputs: [],
  };
}

function job(id: string, domain: Domain, rules: PermissionRules): PermissionJob {
  return {
    id,
    domain,
    work: JOB_WORK,
    progress: 0,
    value: domain === 'routine' ? 6 : 16,
    approvalLeft: domain === 'critical' ? rules.approvalTicks : 0,
    shipped: null,
    blast: 0,
  };
}

export function viewPermission(state: PermissionState) {
  return {
    tick: state.tick,
    scope: state.scope,
    policy: {
      read: { routine: 'allowed', critical: 'approval' },
      edit: { routine: 'allowed', critical: 'blast' },
    },
    jobs: state.jobs.map((item) => ({
      id: item.id,
      domain: item.domain,
      progress: item.progress,
      work: item.work,
      approvalLeft: item.approvalLeft,
      status: jobStatus(state.scope, item),
      shipped: item.shipped,
      blast: item.blast,
    })),
  };
}

function jobStatus(scope: Scope | null, item: PermissionJob): string {
  if (item.shipped !== null) return 'shipped';
  if (scope === null) return 'unscoped';
  if (item.domain === 'critical' && scope === 'read' && item.approvalLeft > 0) return 'approval';
  return 'allowed';
}

function openJob(state: PermissionState): PermissionJob | undefined {
  return state.jobs.find((item) => item.shipped === null);
}

export function applyPermissionInput(
  state: PermissionState,
  input: PermissionInput,
  rules: PermissionRules = baselinePermissionRules,
): PermissionState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'scope') return assignScope(state, input.scope);
  if (state.scope === null) return state;
  return workTick(state, rules);
}

function assignScope(state: PermissionState, scope: string): PermissionState {
  if ((scope !== 'read' && scope !== 'edit') || state.tick > 0 || state.scope === scope) {
    return state;
  }
  const next = structuredClone(state);
  next.scope = scope;
  next.inputs.push({ type: 'scope', scope });
  return next;
}

function workTick(state: PermissionState, rules: PermissionRules): PermissionState {
  const next = structuredClone(state);
  next.tick += 1;
  const item = openJob(next);
  if (!item || !next.scope) {
    next.resolutions.push(`t${next.tick}:idle`);
    next.inputs.push({ type: 'tick' });
    return next;
  }
  const notes = [`t${next.tick}:${item.id}`];
  if (item.domain === 'critical' && next.scope === 'read' && item.approvalLeft > 0) {
    item.approvalLeft -= 1;
    notes.push('approval');
  } else {
    const speed = next.scope === 'edit' ? 2 : 1;
    item.progress += speed;
    notes.push(`${next.scope}+${speed}`);
    if (item.progress >= item.work) {
      item.shipped = item.value;
      next.shippedValue += item.value;
      notes.push(`ship:${item.value}`);
      if (item.domain === 'critical' && next.scope === 'edit') {
        item.blast = rules.blast;
        next.loss += rules.blast;
        notes.push(`blast:${rules.blast}`);
      }
    }
  }
  next.resolutions.push(notes.join(','));
  next.inputs.push({ type: 'tick' });
  return next;
}

export function summarizePermission(state: PermissionState) {
  return {
    tick: state.tick,
    scope: state.scope,
    shippedValue: state.shippedValue,
    loss: state.loss,
    jobs: state.jobs.map((item) => ({
      id: item.id,
      status: jobStatus(state.scope, item),
      shipped: item.shipped,
      blast: item.blast,
      approvalLeft: item.approvalLeft,
    })),
    resolutions: state.resolutions,
    netValue: state.shippedValue - state.loss,
  };
}

export function choosePermissionAction(
  state: PermissionState,
  strategy: PermissionStrategy,
): PermissionInput {
  if (state.tick === 0 && state.scope !== strategy) return { type: 'scope', scope: strategy };
  return { type: 'tick' };
}

const COMPARE_ROWS: { scenario: PermissionScenario; strategies: PermissionStrategy[] }[] = [
  { scenario: 'routine', strategies: ['edit', 'read'] },
  { scenario: 'critical', strategies: ['read', 'edit'] },
];

export function comparePermissionStrategies(seed: string) {
  return COMPARE_ROWS.flatMap(({ scenario, strategies }) =>
    strategies.map((strategy) => {
      const initial = createPermissionPrototype(seed, scenario);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 40) throw new Error(`${scenario}:${strategy}`);
        const action = choosePermissionAction(state, strategy);
        const next = applyPermissionInput(state, action);
        if (next === state) throw new Error(`${scenario}:${strategy} tick ${state.tick}`);
        state = next;
      }
      return {
        scenario,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizePermission(state),
      };
    }),
  );
}

const FACTOR_SEED = 'RI-193';
const FACTOR_SCENARIOS: PermissionScenario[] = ['routine', 'critical'];
const APPROVAL_SWEEP = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const BLAST_SWEEP = [0, 1, 15, 16, 20, 32];
export type PermissionPreference = 'preapprove' | 'confirm' | 'tie';
export interface PermissionFactorRun {
  inputs: PermissionInput[];
  result: ReturnType<typeof summarizePermission>;
}
export interface PermissionScenarioComparison {
  scenario: PermissionScenario;
  preference: PermissionPreference;
  margin: number;
  preapprove: PermissionFactorRun;
  confirm: PermissionFactorRun;
}
export interface PermissionFactorPoint {
  axis: string;
  parameter: string;
  rules: PermissionRules;
  scenarios: PermissionScenarioComparison[];
}
export interface PermissionFactorReversal {
  axis: string;
  scenario: PermissionScenario;
  before: {
    parameter: string;
    preference: PermissionPreference;
    preapprove: number;
    confirm: number;
  };
  after: {
    parameter: string;
    preference: PermissionPreference;
    preapprove: number;
    confirm: number;
  };
}
function cloneRules(rules: PermissionRules): PermissionRules {
  return { ...rules };
}
function withRules(patch: Partial<PermissionRules>): PermissionRules {
  return { ...baselinePermissionRules, ...patch };
}
function preferenceOf(preapprove: number, confirm: number): PermissionPreference {
  if (preapprove > confirm) return 'preapprove';
  if (confirm > preapprove) return 'confirm';
  return 'tie';
}
function runPermission(
  scenario: PermissionScenario,
  strategy: PermissionStrategy,
  rules: PermissionRules,
): PermissionFactorRun {
  let state = createPermissionPrototype(FACTOR_SEED, scenario, rules);
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 40) throw new Error(`${scenario}:${strategy}`);
    const next = applyPermissionInput(state, choosePermissionAction(state, strategy), rules);
    if (next === state) throw new Error(`${scenario}:${strategy} tick ${state.tick}`);
    state = next;
  }
  return { inputs: state.inputs, result: summarizePermission(state) };
}
function point(axis: string, parameter: string, rules: PermissionRules): PermissionFactorPoint {
  const scenarios = FACTOR_SCENARIOS.map((scenario) => {
    const preapprove = runPermission(scenario, 'edit', rules);
    const confirm = runPermission(scenario, 'read', rules);
    return {
      scenario,
      preference: preferenceOf(preapprove.result.netValue, confirm.result.netValue),
      margin: preapprove.result.netValue - confirm.result.netValue,
      preapprove,
      confirm,
    };
  });
  return { axis, parameter, rules: cloneRules(rules), scenarios };
}
function reversalsOf(rows: PermissionFactorPoint[]): PermissionFactorReversal[] {
  const found: PermissionFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after) continue;
    for (const scenario of FACTOR_SCENARIOS) {
      const earlier = before.scenarios.find((item) => item.scenario === scenario);
      const later = after.scenarios.find((item) => item.scenario === scenario);
      if (!earlier || !later || earlier.preference === later.preference) continue;
      found.push({
        axis: before.axis,
        scenario,
        before: {
          parameter: before.parameter,
          preference: earlier.preference,
          preapprove: earlier.preapprove.result.netValue,
          confirm: earlier.confirm.result.netValue,
        },
        after: {
          parameter: after.parameter,
          preference: later.preference,
          preapprove: later.preapprove.result.netValue,
          confirm: later.confirm.result.netValue,
        },
      });
    }
  }
  return found;
}
/** 初回と同じ資源で、承認tickと影響を一つずつ動かす。固定戦略。 */
export function comparePermissionFactorReversals() {
  const sweeps = {
    approvalTicks: APPROVAL_SWEEP.map((approvalTicks) =>
      point('approvalTicks', String(approvalTicks), withRules({ approvalTicks })),
    ),
    blast: BLAST_SWEEP.map((blast) => point('blast', String(blast), withRules({ blast }))),
  };
  return {
    conditions: {
      seed: FACTOR_SEED,
      scenarios: [...FACTOR_SCENARIOS],
      resources: {
        routine: { jobs: 2, work: JOB_WORK, value: 6, horizon: 6 },
        critical: { jobs: 1, work: JOB_WORK, value: 16, horizon: 8 },
        readSpeed: 1,
        editSpeed: 2,
      },
      decision: {
        preapprove: 'edit',
        confirm: 'read',
        score: 'netValue',
        margin: '事前の差引 - 都度の差引',
      },
      baseline: cloneRules(baselinePermissionRules),
      approvalAppliesTo: 'critical の初期 approvalLeft だけ。routine は 0',
      blastAppliesTo: 'critical を edit で出荷したとき一度。routine には掛けない',
      held: {
        approvalTicks: '承認tickだけを動かす。影響20。0は待ちなし、8は重要の期末いっぱい',
        blast: '影響だけを動かす。承認tickは2。0は同点、15は差引がまだ正、16は差引0、32は価値の2倍',
      },
      scopeConsumesTick: false,
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    },
    sweeps,
    reversals: Object.values(sweeps).flatMap((rows) => reversalsOf(rows)),
  };
}

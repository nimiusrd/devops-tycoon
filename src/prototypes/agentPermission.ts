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
const APPROVAL_TICKS = 2;
const BLAST = 20;

export function createPermissionPrototype(
  seed: string,
  scenario: PermissionScenario,
): PermissionState {
  const jobs: PermissionJob[] =
    scenario === 'routine' ? [job('r1', 'routine'), job('r2', 'routine')] : [job('c1', 'critical')];
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

function job(id: string, domain: Domain): PermissionJob {
  return {
    id,
    domain,
    work: JOB_WORK,
    progress: 0,
    value: domain === 'routine' ? 6 : 16,
    approvalLeft: domain === 'critical' ? APPROVAL_TICKS : 0,
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
): PermissionState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'scope') return assignScope(state, input.scope);
  if (state.scope === null) return state;
  return workTick(state);
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

function workTick(state: PermissionState): PermissionState {
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
        item.blast = BLAST;
        next.loss += BLAST;
        notes.push(`blast:${BLAST}`);
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

/** RI-180: 同種の仕事だけを速くする再利用資産。無関係な仕事へは効かせない。 */
export type WorkKind = 'matching' | 'other';
export type AssetStatus = 'none' | 'fresh' | 'stale-held' | 'stale-used' | 'retired';
export type AssetScenario = 'single' | 'repeat' | 'stale-many' | 'stale-few';
export type AssetStrategy = 'direct' | 'build' | 'update' | 'retire' | 'continue';
export type AssetInput = { type: 'build' | 'update' | 'retire' | 'continue-stale' | 'tick' };
export interface AssetJob {
  id: string;
  kind: WorkKind;
  effort: number;
  progress: number;
  value: number;
}
export interface AssetState {
  version: 1;
  seed: number;
  tick: number;
  horizon: number;
  premiseVersion: number;
  premiseChangeAt: number | null;
  asset: AssetStatus;
  assetPremise: number | null;
  busy: { kind: 'build' | 'update'; remaining: number } | null;
  focus: number;
  focusSpent: number;
  buildTicksSpent: number;
  updateTicksSpent: number;
  earnedValue: number;
  stalePenalty: number;
  jobs: AssetJob[];
  inputs: AssetInput[];
}
const JOB_EFFORT = 4;
const JOB_VALUE = 6;
const BUILD_TICKS = 4;
const UPDATE_TICKS = 4;
const MATCHING_SPEED = 2;
const STALE_PENALTY = 2;

function job(id: string, kind: WorkKind): AssetJob {
  return { id, kind, effort: JOB_EFFORT, progress: 0, value: JOB_VALUE };
}
function scenarioJobs(scenario: AssetScenario): AssetJob[] {
  const matching = scenario === 'single' ? 2 : scenario === 'stale-few' ? 3 : 8;
  const jobs = Array.from({ length: matching }, (_, index) => job(`m${index + 1}`, 'matching'));
  if (scenario === 'single') jobs.push(job('o1', 'other'));
  return jobs;
}
export function createReusablePrototype(seed: number, scenario: AssetScenario): AssetState {
  return {
    version: 1,
    seed,
    tick: 0,
    horizon:
      scenario === 'single' ? 10 : scenario === 'repeat' ? 20 : scenario === 'stale-many' ? 24 : 14,
    premiseVersion: 0,
    premiseChangeAt: scenario === 'stale-many' || scenario === 'stale-few' ? 8 : null,
    asset: 'none',
    assetPremise: null,
    busy: null,
    focus: 2,
    focusSpent: 0,
    buildTicksSpent: 0,
    updateTicksSpent: 0,
    earnedValue: 0,
    stalePenalty: 0,
    jobs: scenarioJobs(scenario),
    inputs: [],
  };
}
export function viewReusable(state: AssetState) {
  const stale = state.asset === 'stale-held' || state.asset === 'stale-used';
  return {
    tick: state.tick,
    horizon: state.horizon,
    premiseVersion: state.premiseVersion,
    asset: state.asset,
    stale,
    assetPremise: state.assetPremise,
    busy: state.busy,
    focus: state.focus,
    buildTicksSpent: state.buildTicksSpent,
    updateTicksSpent: state.updateTicksSpent,
    jobs: state.jobs.map((item) => ({
      id: item.id,
      kind: item.kind,
      progress: item.progress,
      effort: item.effort,
      speed:
        !state.busy &&
        item.kind === 'matching' &&
        (state.asset === 'fresh' || state.asset === 'stale-used')
          ? MATCHING_SPEED
          : 1,
    })),
  };
}
export function applyReusableInput(state: AssetState, input: AssetInput): AssetState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'build' && (state.asset !== 'none' || state.busy || state.focus < 1))
    return state;
  if (
    input.type === 'update' &&
    ((state.asset !== 'stale-held' && state.asset !== 'stale-used') ||
      state.busy ||
      state.focus < 1)
  )
    return state;
  if (
    input.type === 'retire' &&
    ((state.asset !== 'stale-held' && state.asset !== 'stale-used') || state.busy)
  )
    return state;
  if (input.type === 'continue-stale' && (state.asset !== 'stale-held' || state.busy)) return state;
  const next = structuredClone(state);
  if (input.type === 'build' || input.type === 'update') {
    next.focus -= 1;
    next.focusSpent += 1;
    next.busy = {
      kind: input.type,
      remaining: input.type === 'build' ? BUILD_TICKS : UPDATE_TICKS,
    };
  } else if (input.type === 'retire') next.asset = 'retired';
  else if (input.type === 'continue-stale') next.asset = 'stale-used';
  else {
    next.tick += 1;
    if (next.premiseChangeAt === next.tick) {
      next.premiseVersion += 1;
      if (next.asset === 'fresh' || next.asset === 'stale-used') next.asset = 'stale-held';
    }
    if (next.busy) {
      const kind = next.busy.kind;
      next.busy.remaining -= 1;
      if (kind === 'build') next.buildTicksSpent += 1;
      else next.updateTicksSpent += 1;
      if (next.busy.remaining === 0) {
        next.asset = 'fresh';
        next.assetPremise = next.premiseVersion;
        next.busy = null;
      }
    } else {
      const current = next.jobs.find((item) => item.progress < item.effort);
      if (current) {
        const speed =
          current.kind === 'matching' && (next.asset === 'fresh' || next.asset === 'stale-used')
            ? MATCHING_SPEED
            : 1;
        current.progress = Math.min(current.effort, current.progress + speed);
        if (current.progress === current.effort) {
          next.earnedValue += current.value;
          if (current.kind === 'matching' && next.asset === 'stale-used')
            next.stalePenalty += STALE_PENALTY;
        }
      }
    }
  }
  next.inputs.push(structuredClone(input));
  return next;
}
export function summarizeReusable(state: AssetState) {
  return {
    asset: state.asset,
    stale: state.asset === 'stale-held' || state.asset === 'stale-used',
    premiseVersion: state.premiseVersion,
    earnedValue: state.earnedValue,
    stalePenalty: state.stalePenalty,
    focusSpent: state.focusSpent,
    buildTicksSpent: state.buildTicksSpent,
    updateTicksSpent: state.updateTicksSpent,
    completed: state.jobs.filter((item) => item.progress >= item.effort).length,
    unfinished: state.jobs.filter((item) => item.progress < item.effort).length,
    netValue: state.earnedValue - state.stalePenalty - state.focusSpent,
  };
}
export function compareReusableStrategies() {
  const plans: { scenario: AssetScenario; strategy: AssetStrategy }[] = [
    { scenario: 'single', strategy: 'direct' },
    { scenario: 'single', strategy: 'build' },
    { scenario: 'repeat', strategy: 'direct' },
    { scenario: 'repeat', strategy: 'build' },
    { scenario: 'stale-many', strategy: 'update' },
    { scenario: 'stale-many', strategy: 'retire' },
    { scenario: 'stale-many', strategy: 'continue' },
    { scenario: 'stale-few', strategy: 'update' },
    { scenario: 'stale-few', strategy: 'retire' },
    { scenario: 'stale-few', strategy: 'continue' },
  ];
  return plans.map(({ scenario, strategy }) => {
    const initial = createReusablePrototype(1, scenario);
    let state = strategy === 'direct' ? initial : applyReusableInput(initial, { type: 'build' });
    while (state.tick < state.horizon) {
      if (state.asset === 'stale-held' && !state.busy) {
        const response: AssetInput['type'] | null =
          strategy === 'update'
            ? 'update'
            : strategy === 'retire'
              ? 'retire'
              : strategy === 'continue'
                ? 'continue-stale'
                : null;
        if (response) state = applyReusableInput(state, { type: response });
      }
      state = applyReusableInput(state, { type: 'tick' });
    }
    return {
      scenario,
      seed: 1,
      strategy,
      initial,
      inputs: state.inputs,
      result: summarizeReusable(state),
    };
  });
}

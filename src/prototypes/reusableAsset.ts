/** RI-180: 同種の仕事だけを速くする再利用資産。無関係な仕事へは効かせない。 */
export type WorkKind = 'matching' | 'other';
export type AssetStatus = 'none' | 'fresh' | 'stale-held' | 'stale-used' | 'retired';
export type AssetScenario = 'single' | 'repeat' | 'stale-many' | 'stale-few';
export type AssetStrategy = 'direct' | 'build' | 'update' | 'retire' | 'continue';
export type AssetDecision = 'skip' | 'maintain';
export type AssetFactor = 'buildTicks' | 'matchingSpeed' | 'stalePenalty' | 'premiseChangeAt';
export type AssetInput = { type: 'build' | 'update' | 'retire' | 'continue-stale' | 'tick' };
/** 初回の規則。状態に rules が無いときはこの値。感度はここから一つだけ動かす。 */
export interface AssetRules {
  buildTicks: number;
  matchingSpeed: number;
  stalePenalty: number;
}
export const baselineAssetRules: AssetRules = {
  buildTicks: 4,
  matchingSpeed: 2,
  stalePenalty: 2,
};
/** 要因比較で固定する初回の資源。工数・価値・集中力・更新tickは動かさない。 */
export const reusableFactorResources = {
  seed: 1,
  effort: 4,
  value: 6,
  focus: 2,
  updateTicks: 4,
} as const;
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
  /** 無いときは初回の規則。初回の比較JSONはこのフィールドを持たない。 */
  rules?: AssetRules;
}
const SCENARIOS: AssetScenario[] = ['single', 'repeat', 'stale-many', 'stale-few'];
const FACTORS: AssetFactor[] = ['buildTicks', 'matchingSpeed', 'stalePenalty', 'premiseChangeAt'];
const SPEED_LEVELS = [1, 2, 3, 4, 5, 6];
const PENALTY_LEVELS = [0, 1, 2, 3, 4, 5, 6];

function assetRules(state: AssetState): AssetRules {
  return state.rules ?? baselineAssetRules;
}
/** 速度ボーナスは同種かつ新鮮か継続利用のときだけ。無関係な仕事と整備中は対象外。 */
function workSpeed(state: AssetState, kind: WorkKind): number {
  if (state.busy) return 0;
  if (kind === 'matching' && (state.asset === 'fresh' || state.asset === 'stale-used'))
    return assetRules(state).matchingSpeed;
  return 1;
}
function job(id: string, kind: WorkKind): AssetJob {
  return {
    id,
    kind,
    effort: reusableFactorResources.effort,
    progress: 0,
    value: reusableFactorResources.value,
  };
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
    horizon: scenario === 'single' ? 10 : scenario === 'repeat' ? 20 : 24,
    premiseVersion: 0,
    premiseChangeAt: scenario === 'stale-many' || scenario === 'stale-few' ? 8 : null,
    asset: 'none',
    assetPremise: null,
    busy: null,
    focus: reusableFactorResources.focus,
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
    busy: state.busy ? { ...state.busy } : null,
    focus: state.focus,
    buildTicksSpent: state.buildTicksSpent,
    updateTicksSpent: state.updateTicksSpent,
    jobs: state.jobs.map((item) => ({
      id: item.id,
      kind: item.kind,
      progress: item.progress,
      effort: item.effort,
      speed: workSpeed(state, item.kind),
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
      remaining:
        input.type === 'build' ? assetRules(next).buildTicks : reusableFactorResources.updateTicks,
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
        current.progress = Math.min(
          current.effort,
          current.progress + workSpeed(next, current.kind),
        );
        if (current.progress === current.effort) {
          next.earnedValue += current.value;
          if (current.kind === 'matching' && next.asset === 'stale-used')
            next.stalePenalty += assetRules(next).stalePenalty;
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
function range(first: number, last: number) {
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}
function factorLevels(factor: AssetFactor, horizon: number): (number | null)[] {
  if (factor === 'buildTicks') return range(1, horizon);
  if (factor === 'matchingSpeed') return [...SPEED_LEVELS];
  if (factor === 'stalePenalty') return [...PENALTY_LEVELS];
  return [null, ...range(1, horizon)];
}
function rulesFor(factor: AssetFactor, level: number | null): AssetRules {
  if (factor === 'premiseChangeAt' || level === null) return { ...baselineAssetRules };
  return { ...baselineAssetRules, [factor]: level };
}
function levelLabel(level: number | null) {
  return level === null ? 'none' : String(level);
}
/** 整備するは build のあと、古くなった資産を一度だけ使い続ける。整備しないは tick だけ。 */
export function runReusableDecision(
  scenario: AssetScenario,
  decision: AssetDecision,
  rules: AssetRules,
  premiseChangeAt: number | null,
) {
  const initial = createReusablePrototype(reusableFactorResources.seed, scenario);
  initial.premiseChangeAt = premiseChangeAt;
  initial.rules = { ...rules };
  let state = decision === 'skip' ? initial : applyReusableInput(initial, { type: 'build' });
  while (state.tick < state.horizon) {
    if (decision === 'maintain' && state.asset === 'stale-held' && !state.busy)
      state = applyReusableInput(state, { type: 'continue-stale' });
    state = applyReusableInput(state, { type: 'tick' });
  }
  return { initial, inputs: state.inputs, result: summarizeReusable(state) };
}
export type AssetFactorWinner = 'maintain' | 'skip' | 'tie';
export interface AssetFactorPoint {
  factor: AssetFactor;
  level: string;
  scenario: AssetScenario;
  decision: AssetDecision;
  rules: AssetRules;
  premiseChangeAt: number | null;
  initial: AssetState;
  inputs: AssetInput[];
  result: ReturnType<typeof summarizeReusable>;
}
export interface AssetFactorReversal {
  factor: AssetFactor;
  scenario: AssetScenario;
  from: { level: string; winner: AssetFactorWinner; maintain: number; skip: number };
  to: { level: string; winner: AssetFactorWinner; maintain: number; skip: number };
}
function decisionWinner(maintain: number, skip: number): AssetFactorWinner {
  if (maintain > skip) return 'maintain';
  if (maintain < skip) return 'skip';
  return 'tie';
}
function pairAt(list: AssetFactorPoint[], level: string) {
  const maintain = list.find((row) => row.level === level && row.decision === 'maintain');
  const skip = list.find((row) => row.level === level && row.decision === 'skip');
  if (!maintain || !skip) return null;
  return {
    level,
    winner: decisionWinner(maintain.result.netValue, skip.result.netValue),
    maintain: maintain.result.netValue,
    skip: skip.result.netValue,
  };
}
function reversalsOf(rows: AssetFactorPoint[]): AssetFactorReversal[] {
  const grouped = new Map<string, AssetFactorPoint[]>();
  for (const row of rows) {
    const key = `${row.factor}:${row.scenario}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const reversals: AssetFactorReversal[] = [];
  for (const list of grouped.values()) {
    const levels: string[] = [];
    for (const row of list) if (!levels.includes(row.level)) levels.push(row.level);
    for (let index = 1; index < levels.length; index += 1) {
      const from = pairAt(list, levels[index - 1]);
      const to = pairAt(list, levels[index]);
      if (!from || !to || from.winner === to.winner) continue;
      reversals.push({ factor: list[0].factor, scenario: list[0].scenario, from, to });
    }
  }
  return reversals;
}
/** 初回と同じ資源で要因を一つずつ動かし、整備すると整備しないだけを再計算する。 */
export function compareReusableFactorReversals() {
  const rows: AssetFactorPoint[] = [];
  for (const scenario of SCENARIOS) {
    const sample = createReusablePrototype(reusableFactorResources.seed, scenario);
    for (const factor of FACTORS) {
      for (const level of factorLevels(factor, sample.horizon)) {
        const rules = rulesFor(factor, level);
        const premiseChangeAt = factor === 'premiseChangeAt' ? level : sample.premiseChangeAt;
        for (const decision of ['skip', 'maintain'] as const) {
          rows.push({
            factor,
            level: levelLabel(level),
            scenario,
            decision,
            rules,
            premiseChangeAt,
            ...runReusableDecision(scenario, decision, rules, premiseChangeAt),
          });
        }
      }
    }
  }
  return {
    conditions: {
      seed: reusableFactorResources.seed,
      resources: reusableFactorResources,
      baseline: baselineAssetRules,
      scenarios: Object.fromEntries(
        SCENARIOS.map((scenario) => {
          const sample = createReusablePrototype(reusableFactorResources.seed, scenario);
          return [
            scenario,
            {
              horizon: sample.horizon,
              premiseChangeAt: sample.premiseChangeAt,
              matching: sample.jobs.filter((item) => item.kind === 'matching').length,
              other: sample.jobs.filter((item) => item.kind === 'other').length,
            },
          ];
        }),
      ),
      speedLevels: SPEED_LEVELS,
      penaltyLevels: PENALTY_LEVELS,
      decisions: {
        skip: 'tick-only',
        maintain: 'build-then-continue-stale-once',
      },
      fixedStrategies: true,
      humanPlaytest: false,
      productionIntegration: false,
      inputEncoding: 'type',
    },
    rows,
    reversals: reversalsOf(rows),
  };
}

/** RI-200: 3チームが共通の利用枠を一度だけ消費する。未配分チームは人間速度で続ける。 */

export type TeamId = 'core' | 'platform' | 'product';
export type QuotaScenario = 'flagship' | 'spread';
export type QuotaStrategy = 'focus' | 'even' | 'none' | 'reserve';
export interface TeamQuota {
  id: TeamId;
  allocation: number;
  used: number;
  value: number;
  fatigue: number;
  deadline: number | null;
}
export type QuotaInput =
  | { type: 'allocate'; amounts: Record<string, number>; reserve: number }
  | { type: 'release' }
  | { type: 'tick' };
export interface QuotaState {
  version: 1;
  seed: string;
  scenario: QuotaScenario;
  tick: number;
  horizon: number;
  pool: number;
  penalty: number;
  reserve: number;
  forfeited: number;
  opened: boolean;
  released: boolean;
  charges: number;
  penalties: number;
  teams: TeamQuota[];
  inputs: QuotaInput[];
}
export interface QuotaRates {
  human: number;
  aiValue: Record<TeamId, number>;
}
export interface QuotaSetup {
  pool?: number;
  penalty?: number;
}

const TEAMS: readonly TeamId[] = ['core', 'platform', 'product'];
const POOL = 6;
const HORIZON = 4;
const HUMAN = 3;
const AI_VALUE = { core: 8, platform: 5, product: 5 } as const;
const AI_FATIGUE = { core: 1, platform: 2, product: 2 } as const;
/** 初回比較の通常運転とAI価値。他チームを動かすとき主力はこの差3を保つ。 */
export const baselineQuotaRates: QuotaRates = {
  human: HUMAN,
  aiValue: { core: AI_VALUE.core, platform: AI_VALUE.platform, product: AI_VALUE.product },
};
const AI_GAP = AI_VALUE.core - AI_VALUE.platform;

const SCENARIOS: Record<
  QuotaScenario,
  { penalty: number; deadlines: Record<TeamId, number | null> }
> = {
  flagship: { penalty: 12, deadlines: { core: 24, platform: null, product: null } },
  spread: { penalty: 10, deadlines: { core: 15, platform: 15, product: 15 } },
};

const PLANS: Record<'none' | 'reserve', { amounts: Record<TeamId, number>; reserve: number }> = {
  none: { amounts: { core: 0, platform: 0, product: 0 }, reserve: 0 },
  reserve: { amounts: { core: 2, platform: 2, product: 0 }, reserve: 2 },
};

function nonNegativeInteger(value: number | undefined, fallback: number) {
  if (value === undefined || !Number.isInteger(value) || value < 0) return fallback;
  return value;
}

export function createQuotaPrototype(
  seed: string,
  scenario: QuotaScenario,
  setup?: QuotaSetup,
): QuotaState {
  const preset = SCENARIOS[scenario];
  return {
    version: 1,
    seed,
    scenario,
    tick: 0,
    horizon: HORIZON,
    pool: nonNegativeInteger(setup?.pool, POOL),
    penalty: nonNegativeInteger(setup?.penalty, preset.penalty),
    reserve: 0,
    forfeited: 0,
    opened: false,
    released: false,
    charges: 0,
    penalties: 0,
    teams: TEAMS.map((id) => ({
      id,
      allocation: 0,
      used: 0,
      value: 0,
      fatigue: 0,
      deadline: preset.deadlines[id],
    })),
    inputs: [],
  };
}

export function viewQuota(state: QuotaState, rates: QuotaRates = baselineQuotaRates) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    pool: state.pool,
    reserve: state.reserve,
    forfeited: state.forfeited,
    opened: state.opened,
    released: state.released,
    charges: state.charges,
    penalty: state.penalty,
    humanValue: rates.human,
    aiValue: { ...rates.aiValue },
    aiFatigue: AI_FATIGUE,
    teams: state.teams.map((team) => ({
      id: team.id,
      allocation: team.allocation,
      used: team.used,
      remaining: team.allocation - team.used,
      value: team.value,
      fatigue: team.fatigue,
      deadline: team.deadline,
      gap: team.deadline === null ? null : team.deadline - team.value,
    })),
  };
}

function readAmounts(amounts: Record<string, number>): Record<TeamId, number> | null {
  if (amounts === null || typeof amounts !== 'object') return null;
  const out = { core: 0, platform: 0, product: 0 };
  for (const id of TEAMS) {
    const value = amounts[id];
    if (!Number.isInteger(value) || value < 0) return null;
    out[id] = value;
  }
  return out;
}

export function applyQuotaInput(
  state: QuotaState,
  input: QuotaInput,
  rates: QuotaRates = baselineQuotaRates,
): QuotaState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'allocate') return allocate(state, input.amounts, input.reserve);
  if (input.type === 'release') return release(state);
  if (!state.opened) return state;
  const next = structuredClone(state);
  for (const team of next.teams) spend(next, team, rates);
  next.tick += 1;
  if (next.tick === next.horizon) settle(next);
  next.inputs.push({ type: 'tick' });
  return next;
}

function allocate(state: QuotaState, amounts: Record<string, number>, reserve: number): QuotaState {
  const parsed = readAmounts(amounts);
  if (state.opened || !parsed || !Number.isInteger(reserve) || reserve < 0) return state;
  const assigned = TEAMS.reduce((sum, id) => sum + parsed[id], 0) + reserve;
  if (assigned > state.pool) return state;
  const next = structuredClone(state);
  for (const team of next.teams) team.allocation = parsed[team.id];
  next.reserve = reserve;
  next.forfeited = state.pool - assigned;
  next.opened = true;
  next.inputs.push({
    type: 'allocate',
    amounts: { core: parsed.core, platform: parsed.platform, product: parsed.product },
    reserve,
  });
  return next;
}

function release(state: QuotaState): QuotaState {
  if (!state.opened || state.released || state.tick !== 2) return state;
  const next = structuredClone(state);
  const target = shortageTeam(next);
  if (target && next.reserve > 0) target.allocation += next.reserve;
  else next.forfeited += next.reserve;
  next.reserve = 0;
  next.released = true;
  next.inputs.push({ type: 'release' });
  return next;
}

function shortageTeam(state: QuotaState): TeamQuota | undefined {
  let best: TeamQuota | undefined;
  let bestGap = 0;
  for (const team of state.teams) {
    if (team.deadline === null) continue;
    const gap = team.deadline - team.value;
    if (gap > bestGap) {
      best = team;
      bestGap = gap;
    }
  }
  return best;
}

function spend(state: QuotaState, team: TeamQuota, rates: QuotaRates): void {
  if (team.allocation - team.used <= 0) {
    team.value += rates.human;
    return;
  }
  team.used += 1;
  state.charges += 1;
  team.value += rates.aiValue[team.id];
  team.fatigue += AI_FATIGUE[team.id];
}

function settle(state: QuotaState): void {
  const leftover = state.teams.reduce((sum, team) => sum + (team.allocation - team.used), 0);
  state.forfeited += leftover + state.reserve;
  state.reserve = 0;
  for (const team of state.teams) {
    team.allocation = team.used;
    if (team.deadline !== null && team.value < team.deadline) state.penalties += state.penalty;
  }
}

export function summarizeQuota(state: QuotaState) {
  const value = state.teams.reduce((sum, team) => sum + team.value, 0);
  const fatigue = state.teams.reduce((sum, team) => sum + team.fatigue, 0);
  const used = state.teams.reduce((sum, team) => sum + team.used, 0);
  return {
    value,
    fatigue,
    penalties: state.penalties,
    score: value - state.penalties,
    used,
    charges: state.charges,
    forfeited: state.forfeited,
    reserve: state.reserve,
    singleLedger: used === state.charges && used + state.forfeited === state.pool,
    teams: state.teams.map((team) => ({
      id: team.id,
      allocation: team.allocation,
      used: team.used,
      value: team.value,
      fatigue: team.fatigue,
      met: team.deadline === null || team.value >= team.deadline,
    })),
  };
}

function cappedShare(pool: number, order: readonly TeamId[]): Record<TeamId, number> {
  const amounts = { core: 0, platform: 0, product: 0 };
  let left = pool;
  while (left > 0) {
    let placed = false;
    for (const id of order) {
      if (left === 0) break;
      if (amounts[id] >= HORIZON) continue;
      amounts[id] += 1;
      left -= 1;
      placed = true;
    }
    if (!placed) break;
  }
  return amounts;
}

function allocationPlan(strategy: QuotaStrategy, pool: number) {
  if (strategy === 'reserve' || strategy === 'none') return PLANS[strategy];
  if (strategy === 'focus') {
    const core = Math.min(HORIZON, pool);
    const rest = cappedShare(pool - core, ['platform', 'product']);
    return { amounts: { core, platform: rest.platform, product: rest.product }, reserve: 0 };
  }
  return { amounts: cappedShare(pool, TEAMS), reserve: 0 };
}

export function chooseQuotaAction(state: QuotaState, strategy: QuotaStrategy): QuotaInput {
  if (!state.opened) {
    const plan = allocationPlan(strategy, state.pool);
    return { type: 'allocate', amounts: { ...plan.amounts }, reserve: plan.reserve };
  }
  if (strategy === 'reserve' && state.tick === 2 && !state.released) return { type: 'release' };
  return { type: 'tick' };
}

export function compareQuotaStrategies(seed = 'RI-200') {
  return (['flagship', 'spread'] as const).flatMap((scenario) =>
    (['focus', 'even', 'none', 'reserve'] as const).map((strategy) => {
      const initial = createQuotaPrototype(seed, scenario);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 20) throw new Error(`${scenario}:${strategy}`);
        const next = applyQuotaInput(state, chooseQuotaAction(state, strategy));
        if (next === state) throw new Error(`${scenario}:${strategy}@${state.tick}`);
        state = next;
      }
      return {
        scenario,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeQuota(state),
      };
    }),
  );
}

const FACTOR_SEED = 'RI-200';
const POOLS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;
const AI_LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;
const PENALTIES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 24] as const;
export type QuotaPreference = 'allocate' | 'none' | 'tie';
export type QuotaFactorAxis = 'pool' | 'aiValue' | 'penalty';
export interface QuotaFactorRules {
  pool: number;
  horizon: number;
  human: number;
  aiValue: Record<TeamId, number>;
  aiFatigue: Record<TeamId, number>;
  penalty: number;
  deadlines: Record<TeamId, number | null>;
}
export interface QuotaFactorRun {
  inputs: QuotaInput[];
  result: ReturnType<typeof summarizeQuota>;
}
export interface QuotaFactorPoint {
  axis: QuotaFactorAxis;
  scenario: QuotaScenario;
  parameter: string;
  rules: QuotaFactorRules;
  preference: QuotaPreference;
  bestAllocate: 'focus' | 'even' | 'tie';
  margin: number;
  sameAsFirstComparison: boolean;
  focus: QuotaFactorRun;
  even: QuotaFactorRun;
  none: QuotaFactorRun;
}
export interface QuotaFactorReversal {
  axis: QuotaFactorAxis;
  scenario: QuotaScenario;
  before: {
    parameter: string;
    preference: QuotaPreference;
    focus: number;
    even: number;
    none: number;
  };
  after: {
    parameter: string;
    preference: QuotaPreference;
    focus: number;
    even: number;
    none: number;
  };
}

function factorRules(
  scenario: QuotaScenario,
  patch: { pool?: number; aiLevel?: number; penalty?: number },
): QuotaFactorRules {
  const preset = SCENARIOS[scenario];
  const other = patch.aiLevel ?? AI_VALUE.platform;
  return {
    pool: patch.pool ?? POOL,
    horizon: HORIZON,
    human: HUMAN,
    aiValue: { core: other + AI_GAP, platform: other, product: other },
    aiFatigue: {
      core: AI_FATIGUE.core,
      platform: AI_FATIGUE.platform,
      product: AI_FATIGUE.product,
    },
    penalty: patch.penalty ?? preset.penalty,
    deadlines: { ...preset.deadlines },
  };
}

function matchesFirst(scenario: QuotaScenario, rules: QuotaFactorRules) {
  const preset = SCENARIOS[scenario];
  return (
    rules.pool === POOL &&
    rules.horizon === HORIZON &&
    rules.human === HUMAN &&
    rules.penalty === preset.penalty &&
    rules.aiValue.core === AI_VALUE.core &&
    rules.aiValue.platform === AI_VALUE.platform &&
    rules.aiValue.product === AI_VALUE.product
  );
}

function runFactor(
  rules: QuotaFactorRules,
  scenario: QuotaScenario,
  strategy: 'focus' | 'even' | 'none',
): QuotaFactorRun {
  let state = createQuotaPrototype(FACTOR_SEED, scenario, {
    pool: rules.pool,
    penalty: rules.penalty,
  });
  const rates = { human: rules.human, aiValue: rules.aiValue };
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 20) throw new Error(`${scenario}:${strategy}:${rules.pool}`);
    const next = applyQuotaInput(state, chooseQuotaAction(state, strategy), rates);
    if (next === state) throw new Error(`${scenario}:${strategy}@${state.tick}`);
    state = next;
  }
  return { inputs: state.inputs, result: summarizeQuota(state) };
}

function preferenceOf(allocate: number, withhold: number): QuotaPreference {
  if (allocate > withhold) return 'allocate';
  if (withhold > allocate) return 'none';
  return 'tie';
}

function bestAllocateOf(focus: number, even: number): QuotaFactorPoint['bestAllocate'] {
  if (focus === even) return 'tie';
  return focus > even ? 'focus' : 'even';
}

function factorPoint(
  axis: QuotaFactorAxis,
  scenario: QuotaScenario,
  parameter: string,
  rules: QuotaFactorRules,
): QuotaFactorPoint {
  const focus = runFactor(rules, scenario, 'focus');
  const even = runFactor(rules, scenario, 'even');
  const none = runFactor(rules, scenario, 'none');
  const allocate = Math.max(focus.result.score, even.result.score);
  return {
    axis,
    scenario,
    parameter,
    rules,
    preference: preferenceOf(allocate, none.result.score),
    bestAllocate: bestAllocateOf(focus.result.score, even.result.score),
    margin: allocate - none.result.score,
    sameAsFirstComparison: matchesFirst(scenario, rules),
    focus,
    even,
    none,
  };
}

function sweepAxis(
  axis: QuotaFactorAxis,
  values: readonly number[],
  patch: (value: number) => { pool?: number; aiLevel?: number; penalty?: number },
) {
  return (['flagship', 'spread'] as const).flatMap((scenario) =>
    values.map((value) =>
      factorPoint(axis, scenario, String(value), factorRules(scenario, patch(value))),
    ),
  );
}

function reversalsOf(rows: QuotaFactorPoint[]): QuotaFactorReversal[] {
  const found: QuotaFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after || before.scenario !== after.scenario) continue;
    if (before.preference === after.preference) continue;
    found.push({
      axis: before.axis,
      scenario: before.scenario,
      before: {
        parameter: before.parameter,
        preference: before.preference,
        focus: before.focus.result.score,
        even: before.even.result.score,
        none: before.none.result.score,
      },
      after: {
        parameter: after.parameter,
        preference: after.preference,
        focus: after.focus.result.score,
        even: after.even.result.score,
        none: after.none.result.score,
      },
    });
  }
  return found;
}

/** 初回と同じ資源で、枠・AI価値・納期の罰を一つずつ動かす。固定戦略。 */
export function compareQuotaFactorReversals() {
  const sweeps = {
    pool: sweepAxis('pool', POOLS, (pool) => ({ pool })),
    aiValue: sweepAxis('aiValue', AI_LEVELS, (aiLevel) => ({ aiLevel })),
    penalty: sweepAxis('penalty', PENALTIES, (penalty) => ({ penalty })),
  };
  return {
    conditions: {
      seed: FACTOR_SEED,
      horizon: HORIZON,
      human: HUMAN,
      teams: [...TEAMS],
      decision: {
        allocate: ['focus', 'even'] as const,
        withhold: 'none' as const,
        score: 'score' as const,
        rule: '配る側は集中と均等の高い差引。配らない側は未配分。差が0なら同点。',
      },
      baseline: {
        pool: POOL,
        aiValue: { ...baselineQuotaRates.aiValue },
        aiGap: AI_GAP,
        penalty: { flagship: SCENARIOS.flagship.penalty, spread: SCENARIOS.spread.penalty },
      },
      held: {
        pool: '枠だけを動かす。AIは主力8・他5。罰は盤面のまま。',
        aiValue: '他チームのAI価値だけを動かす。主力はその3上。枠は6。罰は盤面のまま。',
        penalty: '罰だけを動かす。枠は6。AIは主力8・他5。',
      },
      allocation: {
        focus: '主力へ最大4。残りは基盤と製品へ交互に、各チーム最大4。',
        even: '主力、基盤、製品の順に1ずつ。各チーム最大4。',
        none: '配分0。枠はその場で消滅する。',
      },
      capPerTeam: HORIZON,
      fatigueInScore: false,
      omitted: '保留の再配分は初回JSONのまま再出力しない',
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    },
    sweeps,
    reversals: [
      ...reversalsOf(sweeps.pool),
      ...reversalsOf(sweeps.aiValue),
      ...reversalsOf(sweeps.penalty),
    ],
  };
}

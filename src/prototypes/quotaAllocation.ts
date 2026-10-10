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

const TEAMS: readonly TeamId[] = ['core', 'platform', 'product'];
const POOL = 6;
const HORIZON = 4;
const HUMAN = 3;
const AI_VALUE = { core: 8, platform: 5, product: 5 } as const;
const AI_FATIGUE = { core: 1, platform: 2, product: 2 } as const;

const SCENARIOS: Record<
  QuotaScenario,
  { penalty: number; deadlines: Record<TeamId, number | null> }
> = {
  flagship: { penalty: 12, deadlines: { core: 24, platform: null, product: null } },
  spread: { penalty: 10, deadlines: { core: 15, platform: 15, product: 15 } },
};

const PLANS: Record<QuotaStrategy, { amounts: Record<TeamId, number>; reserve: number }> = {
  focus: { amounts: { core: 4, platform: 1, product: 1 }, reserve: 0 },
  even: { amounts: { core: 2, platform: 2, product: 2 }, reserve: 0 },
  none: { amounts: { core: 0, platform: 0, product: 0 }, reserve: 0 },
  reserve: { amounts: { core: 2, platform: 2, product: 0 }, reserve: 2 },
};

export function createQuotaPrototype(seed: string, scenario: QuotaScenario): QuotaState {
  const preset = SCENARIOS[scenario];
  return {
    version: 1,
    seed,
    scenario,
    tick: 0,
    horizon: HORIZON,
    pool: POOL,
    penalty: preset.penalty,
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

export function viewQuota(state: QuotaState) {
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
    humanValue: HUMAN,
    aiValue: AI_VALUE,
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

export function applyQuotaInput(state: QuotaState, input: QuotaInput): QuotaState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'allocate') return allocate(state, input.amounts, input.reserve);
  if (input.type === 'release') return release(state);
  if (!state.opened) return state;
  const next = structuredClone(state);
  for (const team of next.teams) spend(next, team);
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

function spend(state: QuotaState, team: TeamQuota): void {
  if (team.allocation - team.used <= 0) {
    team.value += HUMAN;
    return;
  }
  team.used += 1;
  state.charges += 1;
  team.value += AI_VALUE[team.id];
  team.fatigue += AI_FATIGUE[team.id];
}

function settle(state: QuotaState): void {
  const leftover = state.teams.reduce((sum, team) => sum + (team.allocation - team.used), 0);
  state.forfeited += leftover + state.reserve;
  state.reserve = 0;
  for (const team of state.teams) {
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

export function chooseQuotaAction(state: QuotaState, strategy: QuotaStrategy): QuotaInput {
  if (!state.opened) {
    const plan = PLANS[strategy];
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

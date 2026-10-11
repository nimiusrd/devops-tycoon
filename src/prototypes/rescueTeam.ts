/** RI-224: 3チームから救援1期間を貸し出す。RI-221 の当番交代へは未接続。 */

export type TeamId = 'alpha' | 'bravo' | 'spare';
export type RescueBoard = 'local' | 'wide' | 'deadline';
export type RescueStrategy = 'none' | 'focus' | 'spread';
export type RescueLoans = Record<TeamId, number>;
export type RescueInput =
  | { type: 'dispatch'; loans: RescueLoans }
  | { type: 'resolve' }
  | { type: 'return' }
  | { type: 'view' };

export interface RescueTeamMember {
  id: TeamId;
  capacity: number;
  output: number;
  loaned: number;
}

export interface RescueState {
  version: 1;
  seed: string;
  board: RescueBoard;
  tick: number;
  horizon: number;
  duration: 1;
  phase: 'plan' | 'out' | 'back';
  incident: number;
  incidentLeft: number;
  penaltyEach: number;
  penalty: number;
  penaltyApplied: boolean;
  recovered: number;
  resolved: boolean;
  returned: boolean;
  shipped: number;
  teams: RescueTeamMember[];
  inputs: RescueInput[];
}

const TEAM_IDS: readonly TeamId[] = ['alpha', 'bravo', 'spare'];
const CAPACITY = 4;

const BOARDS: Record<RescueBoard, { incident: number; penaltyEach: number; output: RescueLoans }> =
  {
    local: { incident: 4, penaltyEach: 5, output: { alpha: 2, bravo: 2, spare: 2 } },
    wide: { incident: 6, penaltyEach: 6, output: { alpha: 2, bravo: 2, spare: 2 } },
    deadline: { incident: 4, penaltyEach: 3, output: { alpha: 6, bravo: 2, spare: 2 } },
  };

function createTeams(output: RescueLoans): RescueTeamMember[] {
  return TEAM_IDS.map((id) => ({ id, capacity: CAPACITY, output: output[id], loaned: 0 }));
}

export function createRescueTeam(seed: string, board: RescueBoard): RescueState {
  const preset = BOARDS[board];
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 3,
    duration: 1,
    phase: 'plan',
    incident: preset.incident,
    incidentLeft: preset.incident,
    penaltyEach: preset.penaltyEach,
    penalty: 0,
    penaltyApplied: false,
    recovered: 0,
    resolved: false,
    returned: false,
    shipped: 0,
    teams: createTeams(preset.output),
    inputs: [],
  };
}

export function availableCapacity(team: RescueTeamMember): number {
  return team.capacity - team.loaned;
}

function loanTotal(teams: readonly RescueTeamMember[]): number {
  return teams.reduce((sum, team) => sum + team.loaned, 0);
}

function isLoans(value: unknown): value is RescueLoans {
  if (value === null || typeof value !== 'object') return false;
  const loans = value as Record<string, unknown>;
  return TEAM_IDS.every((id) => {
    const amount = loans[id];
    return (
      typeof amount === 'number' && Number.isInteger(amount) && amount >= 0 && amount <= CAPACITY
    );
  });
}

export function planRescueLoans(state: RescueState, strategy: RescueStrategy): RescueLoans {
  const loans = { alpha: 0, bravo: 0, spare: 0 };
  if (strategy === 'none') return loans;
  if (strategy === 'spread') {
    const each = Math.ceil(state.incident / state.teams.length);
    for (const team of state.teams) loans[team.id] = Math.min(team.capacity, each);
    return loans;
  }
  let pick = state.teams[0]!;
  for (const team of state.teams) {
    if (team.output <= pick.output) pick = team;
  }
  loans[pick.id] = Math.min(pick.capacity, state.incident);
  return loans;
}

export function dispatchRescue(state: RescueState, loans: unknown): RescueState {
  if (state.phase !== 'plan' || !isLoans(loans)) return state;
  const next = structuredClone(state);
  for (const team of next.teams) team.loaned = loans[team.id];
  next.phase = 'out';
  next.tick += 1;
  next.inputs.push({
    type: 'dispatch',
    loans: { alpha: loans.alpha, bravo: loans.bravo, spare: loans.spare },
  });
  return next;
}

/** 貸し出し中の余力は元チームの出荷に使わない。復旧は救援プールだけで一度行う。 */
export function resolveRescue(state: RescueState): RescueState {
  if (state.phase !== 'out' || state.resolved || state.returned) return state;
  const next = structuredClone(state);
  next.recovered = Math.min(next.incidentLeft, loanTotal(next.teams));
  next.incidentLeft -= next.recovered;
  next.shipped += next.teams.reduce((sum, team) => sum + availableCapacity(team) * team.output, 0);
  if (next.incidentLeft > 0 && !next.penaltyApplied) {
    next.penalty += next.incidentLeft * next.penaltyEach;
    next.penaltyApplied = true;
  }
  next.resolved = true;
  next.tick += 1;
  next.inputs.push({ type: 'resolve' });
  return next;
}

/** 終了と中断のどちらも、貸し出しを一度だけ返す。中断は未復旧のまま罰を確定する。 */
export function returnRescue(state: RescueState): RescueState {
  if (state.phase !== 'out' || state.returned) return state;
  const next = structuredClone(state);
  if (!next.resolved && next.incidentLeft > 0 && !next.penaltyApplied) {
    next.penalty += next.incidentLeft * next.penaltyEach;
    next.penaltyApplied = true;
  }
  for (const team of next.teams) team.loaned = 0;
  next.returned = true;
  next.phase = 'back';
  next.shipped += next.teams.reduce((sum, team) => sum + team.capacity * team.output, 0);
  next.tick += 1;
  next.inputs.push({ type: 'return' });
  return next;
}

export function applyRescueTeam(state: RescueState, input: RescueInput): RescueState {
  if (input.type === 'view') return state;
  if (input.type === 'dispatch') return dispatchRescue(state, input.loans);
  if (input.type === 'resolve') return resolveRescue(state);
  if (input.type === 'return') return returnRescue(state);
  return state;
}

export function viewRescueTeam(state: RescueState) {
  return {
    tick: state.tick,
    phase: state.phase,
    duration: state.duration,
    incidentLeft: state.incidentLeft,
    teams: state.teams.map((team) => ({
      id: team.id,
      capacity: team.capacity,
      output: team.output,
      loaned: team.loaned,
      available: availableCapacity(team),
    })),
    plans: (['none', 'focus', 'spread'] as const).map((strategy) => {
      const loans = planRescueLoans(state, strategy);
      const recovery = Math.min(
        state.incident,
        TEAM_IDS.reduce((sum, id) => sum + loans[id], 0),
      );
      const sourceShip = state.teams.reduce(
        (sum, team) => sum + (team.capacity - loans[team.id]) * team.output,
        0,
      );
      return { strategy, loans, recovery, sourceShip, duration: state.duration };
    }),
  };
}

export function summarizeRescueTeam(state: RescueState) {
  return {
    shipped: state.shipped,
    recovered: state.recovered,
    incidentLeft: state.incidentLeft,
    penalty: state.penalty,
    returned: state.returned,
    loaned: state.teams.map((team) => ({ id: team.id, loaned: team.loaned })),
    score: state.shipped - state.penalty,
    lost: false,
  };
}

export function chooseRescueAction(state: RescueState, strategy: RescueStrategy): RescueInput {
  if (state.phase === 'plan') return { type: 'dispatch', loans: planRescueLoans(state, strategy) };
  if (!state.resolved) return { type: 'resolve' };
  return { type: 'return' };
}

export function compareRescueTeams(seed = 'RI-224') {
  return (['local', 'wide', 'deadline'] as const).flatMap((board) =>
    (['none', 'focus', 'spread'] as const).map((strategy) => {
      const initial = createRescueTeam(seed, board);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 10) throw new Error(`${board}:${strategy}`);
        const input = chooseRescueAction(state, strategy);
        const next = applyRescueTeam(state, input);
        if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
        state = next;
      }
      return { board, strategy, initial, inputs: state.inputs, result: summarizeRescueTeam(state) };
    }),
  );
}

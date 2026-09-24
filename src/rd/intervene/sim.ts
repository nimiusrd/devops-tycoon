import { createRng, randInt } from '../../sim/rng';
import { DEFAULT_ACTIONS, KNOBS, SEED_DEFS } from './knobs';
import { actionsForArm } from './policies';
import type {
  ActionId,
  ArmId,
  ExperimentState,
  ExperimentTotals,
  PeriodActions,
  PeriodCount,
  PeriodLog,
  PeriodTeamLog,
  PlannedArmId,
  SeedId,
  TeamId,
  TeamState,
} from './types';
import { DEFAULT_PERIODS, TEAM_IDS } from './types';

export interface ActionSpec {
  readonly processMul: number;
  readonly pressureRelief: number;
  readonly crisisRelief: number;
  readonly fatigueAdd: number;
  readonly nextCapabilityAdd: number;
  readonly focusCost: number;
}

export const ACTION_SPECS: Record<ActionId, ActionSpec> = {
  support: KNOBS.support,
  train: KNOBS.train,
  delegate: KNOBS.delegate,
};

export function clampMetric(value: number): number {
  return Math.min(KNOBS.metricMax, Math.max(0, value));
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function sameActions(left: PeriodActions, right: PeriodActions): boolean {
  return TEAM_IDS.every((id) => left[id] === right[id]);
}

export function countSupport(actions: PeriodActions): number {
  return TEAM_IDS.filter((id) => actions[id] === 'support').length;
}

export function assertValidActions(actions: PeriodActions): void {
  if (countSupport(actions) > 1) {
    throw new Error('直接支援は1期間あたり1チームまで');
  }
}

function teamMap(teams: readonly TeamState[]): Record<TeamId, TeamState> {
  const map = {} as Record<TeamId, TeamState>;
  for (const team of teams) {
    map[team.id] = team;
  }
  for (const id of TEAM_IDS) {
    if (!map[id]) {
      throw new Error(`missing team: ${id}`);
    }
  }
  return map;
}

/** チーム専用 RNG。閲覧順や他チーム処理順に依存しない。 */
export function teamPeriodRngKey(rngSeed: string, period: number, teamId: TeamId): string {
  return `${rngSeed}:period:${period}:team:${teamId}`;
}

export function resolveTeamPeriod(
  team: TeamState,
  action: ActionId,
  period: number,
  rngSeed: string,
): TeamState {
  const spec = ACTION_SPECS[action];
  const rng = createRng(teamPeriodRngKey(rngSeed, period, team.id));
  const noise = randInt(rng, -KNOBS.rngAmplitude, KNOBS.rngAmplitude);
  const incoming = KNOBS.incomingBase + team.pressure * KNOBS.incomingPressure + noise;
  const processed = team.capability * KNOBS.processRate * spec.processMul;
  const crisis = clampMetric(
    team.crisis +
      incoming * KNOBS.crisisFromIncoming -
      processed * KNOBS.crisisFromProcess -
      spec.crisisRelief,
  );
  const pressure = clampMetric(
    team.pressure +
      incoming * KNOBS.pressureFromIncoming -
      processed * KNOBS.pressureFromProcess -
      spec.pressureRelief,
  );
  const output = Math.max(
    0,
    processed * KNOBS.outputFromProcess - crisis * KNOBS.outputCrisisPenalty,
  );
  const overload = Math.max(0, pressure + crisis - team.capability);
  const fatigue = clampMetric(
    team.fatigue * KNOBS.fatigueCarry + overload * KNOBS.fatigueFromOverload + spec.fatigueAdd,
  );
  const capability = clampMetric(team.capability + spec.nextCapabilityAdd);
  return {
    ...team,
    pressure: round1(pressure),
    capability: round1(capability),
    crisis: round1(crisis),
    output: round1(output),
    fatigue: round1(fatigue),
  };
}

export function companyScore(teams: readonly TeamState[]): number {
  const output = teams.reduce((sum, team) => sum + team.output, 0);
  const crisis = teams.reduce((sum, team) => sum + team.crisis, 0);
  const fatigue = teams.reduce((sum, team) => sum + team.fatigue, 0);
  return round1(
    output * KNOBS.company.outputWeight -
      crisis * KNOBS.company.crisisWeight -
      fatigue * KNOBS.company.fatigueWeight,
  );
}

export function resolvePeriod(input: {
  readonly period: number;
  readonly rngSeed: string;
  readonly teams: readonly TeamState[];
  readonly actions: PeriodActions;
}): { readonly teams: TeamState[]; readonly companyScore: number } {
  assertValidActions(input.actions);
  const byId = teamMap(input.teams);
  const teams = TEAM_IDS.map((id) =>
    resolveTeamPeriod(byId[id], input.actions[id], input.period, input.rngSeed),
  );
  return { teams, companyScore: companyScore(teams) };
}

export function createInitialState(
  seedId: SeedId,
  arm: PlannedArmId = 'manual',
  periods: PeriodCount = DEFAULT_PERIODS,
): ExperimentState {
  const def = SEED_DEFS[seedId];
  const plannedActions =
    arm === 'manual'
      ? DEFAULT_ACTIONS
      : actionsForArm(arm, { period: 1, teams: def.teams, seedId });
  return {
    seedId,
    rngSeed: def.rngSeed,
    periods,
    period: 1,
    finished: false,
    teams: def.teams.map((team) => ({ ...team })),
    plannedActions,
    lastCommittedActions: DEFAULT_ACTIONS,
    arm,
    logs: [],
    judgmentCount: 0,
  };
}

/** 閲覧専用。コピーを返し、RNG も状態も動かさない。 */
export function peekTeam(state: ExperimentState, teamId: TeamId): TeamState {
  const team = state.teams.find((item) => item.id === teamId);
  if (!team) {
    throw new Error(`unknown team: ${teamId}`);
  }
  return { ...team };
}

export function setTeamAction(
  state: ExperimentState,
  teamId: TeamId,
  action: ActionId,
): ExperimentState {
  if (state.finished) return state;
  const plannedActions: Record<TeamId, ActionId> = { ...state.plannedActions, [teamId]: action };
  if (action === 'support') {
    for (const id of TEAM_IDS) {
      if (id !== teamId && plannedActions[id] === 'support') {
        plannedActions[id] = 'delegate';
      }
    }
  }
  return {
    ...state,
    plannedActions,
    arm: 'manual',
  };
}

export function applyArm(state: ExperimentState, arm: ArmId): ExperimentState {
  if (state.finished) return state;
  return {
    ...state,
    arm,
    plannedActions: actionsForArm(arm, {
      period: state.period,
      teams: state.teams,
      seedId: state.seedId,
    }),
  };
}

function nextPlannedActions(
  state: ExperimentState,
  nextPeriod: number,
  teams: readonly TeamState[],
): PeriodActions {
  if (state.arm === 'manual') return state.plannedActions;
  return actionsForArm(state.arm, { period: nextPeriod, teams, seedId: state.seedId });
}

export function advancePeriod(state: ExperimentState): ExperimentState {
  if (state.finished) return state;
  assertValidActions(state.plannedActions);
  const resolved = resolvePeriod({
    period: state.period,
    rngSeed: state.rngSeed,
    teams: state.teams,
    actions: state.plannedActions,
  });
  const judgmentDelta = sameActions(state.plannedActions, state.lastCommittedActions) ? 0 : 1;
  const judgmentCount = state.judgmentCount + judgmentDelta;
  const teamLogs: PeriodTeamLog[] = TEAM_IDS.map((id, index) => {
    const team = resolved.teams[index];
    return {
      id,
      action: state.plannedActions[id],
      output: team.output,
      fatigue: team.fatigue,
      crisis: team.crisis,
      nextCapability: team.capability,
    };
  });
  const log: PeriodLog = {
    period: state.period,
    actions: state.plannedActions,
    teams: teamLogs,
    outputSum: round1(teamLogs.reduce((sum, team) => sum + team.output, 0)),
    fatigueSum: round1(teamLogs.reduce((sum, team) => sum + team.fatigue, 0)),
    crisisSum: round1(teamLogs.reduce((sum, team) => sum + team.crisis, 0)),
    nextCapabilitySum: round1(teamLogs.reduce((sum, team) => sum + team.nextCapability, 0)),
    companyScore: resolved.companyScore,
    judgmentDelta,
    judgmentCount,
  };
  const finished = state.period >= state.periods;
  const nextPeriod = finished ? state.period : state.period + 1;
  return {
    ...state,
    period: nextPeriod,
    finished,
    teams: resolved.teams,
    plannedActions: finished
      ? state.plannedActions
      : nextPlannedActions(state, nextPeriod, resolved.teams),
    lastCommittedActions: state.plannedActions,
    logs: [...state.logs, log],
    judgmentCount,
  };
}

export function runRemaining(state: ExperimentState): ExperimentState {
  let current = state;
  while (!current.finished) {
    if (current.arm !== 'manual') {
      current = applyArm(current, current.arm);
    }
    current = advancePeriod(current);
  }
  return current;
}

export function resetExperiment(
  seedId: SeedId,
  arm: PlannedArmId = 'manual',
  periods: PeriodCount = DEFAULT_PERIODS,
): ExperimentState {
  return createInitialState(seedId, arm, periods);
}

export function totalsFromState(state: ExperimentState): ExperimentTotals {
  const last = state.logs[state.logs.length - 1];
  return {
    outputSum: round1(state.logs.reduce((sum, log) => sum + log.outputSum, 0)),
    fatigueSum: round1(state.logs.reduce((sum, log) => sum + log.fatigueSum, 0)),
    crisisSum: round1(state.logs.reduce((sum, log) => sum + log.crisisSum, 0)),
    nextCapabilitySum: round1(state.logs.reduce((sum, log) => sum + log.nextCapabilitySum, 0)),
    companyScoreSum: round1(state.logs.reduce((sum, log) => sum + log.companyScore, 0)),
    judgmentCount: state.judgmentCount,
    lastCrisisSum: last
      ? last.crisisSum
      : round1(state.teams.reduce((sum, team) => sum + team.crisis, 0)),
    lastFatigueSum: last
      ? last.fatigueSum
      : round1(state.teams.reduce((sum, team) => sum + team.fatigue, 0)),
    lastCapabilitySum: last
      ? last.nextCapabilitySum
      : round1(state.teams.reduce((sum, team) => sum + team.capability, 0)),
  };
}

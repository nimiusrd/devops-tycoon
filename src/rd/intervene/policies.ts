import { KNOBS } from './knobs';
import type { ActionId, ArmId, PeriodActions, TeamId, TeamState } from './types';
import { TEAM_IDS } from './types';

export interface ArmPolicyInput {
  readonly period: number;
  readonly teams: readonly TeamState[];
}

function allActions(action: ActionId): PeriodActions {
  return {
    alpha: action,
    bravo: action,
    charlie: action,
  };
}

function teamById(teams: readonly TeamState[], id: TeamId): TeamState {
  const team = teams.find((item) => item.id === id);
  if (!team) {
    throw new Error(`unknown team: ${id}`);
  }
  return team;
}

/**
 * 状況選択のヒューリスティック。仮説を通すための最適化ではない。
 * 危機が閾値以上なら最も危機の大きい1チームを直接支援し、
 * 残りは能力不足かつ危機が閾値未満なら育成、それ以外は委任。
 */
export function situationActions(teams: readonly TeamState[]): PeriodActions {
  const ordered = TEAM_IDS.map((id) => teamById(teams, id));
  const worst = ordered.reduce((current, team) => (team.crisis > current.crisis ? team : current));
  const actions: Record<TeamId, ActionId> = {
    alpha: 'delegate',
    bravo: 'delegate',
    charlie: 'delegate',
  };
  if (worst.crisis >= KNOBS.situation.crisisSupportThreshold) {
    actions[worst.id] = 'support';
  }
  for (const team of ordered) {
    if (actions[team.id] === 'support') continue;
    if (
      team.capability < KNOBS.situation.capabilityTrainThreshold &&
      team.crisis < KNOBS.situation.crisisSupportThreshold
    ) {
      actions[team.id] = 'train';
    }
  }
  return actions;
}

/** 指定アームの今期方針。閲覧順や RNG は使わない。 */
export function actionsForArm(arm: ArmId, input: ArmPolicyInput): PeriodActions {
  switch (arm) {
    case 'always-intervene':
      return {
        ...allActions('delegate'),
        [KNOBS.alwaysInterveneTeam]: 'support',
      };
    case 'train-then-delegate':
      return input.period <= KNOBS.trainThenDelegateTrainPeriods
        ? allActions('train')
        : allActions('delegate');
    case 'full-delegate':
      return allActions('delegate');
    case 'situation':
      return situationActions(input.teams);
    default: {
      const _never: never = arm;
      return _never;
    }
  }
}

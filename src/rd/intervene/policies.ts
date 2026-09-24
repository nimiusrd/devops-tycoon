import { KNOBS } from './knobs';
import type { ActionId, ArmId, PeriodActions, SeedId, TeamId, TeamState } from './types';
import { TEAM_IDS } from './types';

export interface ArmPolicyInput {
  readonly period: number;
  readonly teams: readonly TeamState[];
  readonly seedId: SeedId;
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

function trainThenDelegateActions(input: ArmPolicyInput): PeriodActions {
  return input.period <= KNOBS.trainThenDelegateTrainPeriods
    ? allActions('train')
    : allActions('delegate');
}

/**
 * 状況選択のヒューリスティック。仮説を通すための最適化ではない。
 * 危機が閾値以上なら最も危機の大きい1チームを直接支援する。
 * 安定: 残りは能力不足かつ危機が閾値未満なら育成。
 * 逼迫: 残りは能力不足なら危機が高くても育成（支援枠は1のまま）。
 */
export function situationActions(teams: readonly TeamState[], seedId: SeedId): PeriodActions {
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
  const trainDespiteCrisis = seedId === 'crisis' && KNOBS.crisis.situationTrainDespiteHighCrisis;
  for (const team of ordered) {
    if (actions[team.id] === 'support') continue;
    const lowCapability = team.capability < KNOBS.situation.capabilityTrainThreshold;
    const hasSlack = team.crisis < KNOBS.situation.crisisSupportThreshold;
    if (lowCapability && (trainDespiteCrisis || hasSlack)) {
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
      return trainThenDelegateActions(input);
    case 'full-delegate':
      return allActions('delegate');
    case 'situation':
      return situationActions(input.teams, input.seedId);
    default: {
      const _never: never = arm;
      return _never;
    }
  }
}

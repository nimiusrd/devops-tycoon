/** Issue #538 R&D 試作の型。本番の RunEngine / TeamRunState とは独立する。 */

export const TEAM_IDS = ['alpha', 'bravo', 'charlie'] as const;
export type TeamId = (typeof TEAM_IDS)[number];

export const ACTION_IDS = ['support', 'train', 'delegate'] as const;
export type ActionId = (typeof ACTION_IDS)[number];

export const SEED_IDS = ['crisis', 'stable'] as const;
export type SeedId = (typeof SEED_IDS)[number];

export const ARM_IDS = [
  'always-intervene',
  'train-then-delegate',
  'full-delegate',
  'situation',
] as const;
export type ArmId = (typeof ARM_IDS)[number];

export type PlannedArmId = ArmId | 'manual';

export const PERIODS = 4;

/** チームが持つ能力は 1 軸だけ（処理能力）。 */
export const SKILL_ID = 'throughput' as const;

export interface TeamState {
  readonly id: TeamId;
  readonly name: string;
  /** 負荷・圧力 0–100 */
  readonly pressure: number;
  /** 処理能力（唯一のスキル）0–100 */
  readonly capability: number;
  /** 未解決危機 0–100 */
  readonly crisis: number;
  /** 今期の短期出荷 */
  readonly output: number;
  /** 消耗 0–100 */
  readonly fatigue: number;
}

export type PeriodActions = Readonly<Record<TeamId, ActionId>>;

export interface PeriodTeamLog {
  readonly id: TeamId;
  readonly action: ActionId;
  readonly output: number;
  readonly fatigue: number;
  readonly crisis: number;
  readonly nextCapability: number;
}

export interface PeriodLog {
  readonly period: number;
  readonly actions: PeriodActions;
  readonly teams: readonly PeriodTeamLog[];
  readonly outputSum: number;
  readonly fatigueSum: number;
  readonly crisisSum: number;
  readonly nextCapabilitySum: number;
  readonly companyScore: number;
  readonly judgmentDelta: number;
  readonly judgmentCount: number;
}

export interface ExperimentState {
  readonly seedId: SeedId;
  readonly rngSeed: string;
  readonly period: number;
  readonly finished: boolean;
  readonly teams: readonly TeamState[];
  readonly plannedActions: PeriodActions;
  readonly lastCommittedActions: PeriodActions;
  readonly arm: PlannedArmId;
  readonly logs: readonly PeriodLog[];
  readonly judgmentCount: number;
}

export interface ExperimentTotals {
  readonly outputSum: number;
  readonly fatigueSum: number;
  readonly crisisSum: number;
  readonly nextCapabilitySum: number;
  readonly companyScoreSum: number;
  readonly judgmentCount: number;
  readonly lastCrisisSum: number;
  readonly lastFatigueSum: number;
  readonly lastCapabilitySum: number;
}

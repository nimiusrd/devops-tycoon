/**
 * RI-139: SPEC F-9 の7敗因を、完全探索なしで比較する代表シナリオ。
 *
 * 既定コホートの合否ゲート（RI-132）とは独立した少数fixtureであり、限定介入だけを
 * 同一乱数状態から分岐する。ここで得た結果を完全な有効手集合とは扱わない。
 */
import type { ActionId } from '../../src/sim/types';
import type { LoseReason } from '../../src/sim/run/types';
import { OUTCOME_BALANCE } from '../../src/data/balance';
import { CONSECUTIVE_INCIDENT_SPRINT_CAP, REVIEW_FREEZE_PEAK } from '../../src/sim/outcome';
import { runOnce, type DangerSample, type RunLog } from './harness';

export const F9_SPEC_REASONS = [
  'seniorBurnout',
  'moraleCollapse',
  'techDebt',
  'reviewFreeze',
  'incidentCascade',
  'aiDependency',
  'budgetExhausted',
] as const satisfies readonly LoseReason[];

export type F9SpecReason = (typeof F9_SPEC_REASONS)[number];
export type F9WarningKey =
  | 'seniorHp'
  | 'morale'
  | 'techDebt'
  | 'reviewQueuePeak'
  | 'consecutiveIncidentSprints'
  | 'aiDependencyUnsafe'
  | 'budget';

export interface F9NaturalScenario {
  reason: Exclude<F9SpecReason, 'incidentCascade'>;
  difficulty: string;
  policy: string;
  seed: string;
  warningKey: F9WarningKey;
  probes: readonly ActionId[];
}

export const F9_NATURAL_SCENARIOS: readonly F9NaturalScenario[] = [
  {
    reason: 'seniorBurnout',
    difficulty: 'easy',
    policy: 'naiveNoInterventionCtl',
    seed: 'pt-5',
    warningKey: 'seniorHp',
    probes: ['interruptReview', 'andon', 'pairReview'],
  },
  {
    reason: 'moraleCollapse',
    difficulty: 'nightmare',
    policy: 'naiveNoInterventionCtl',
    seed: 'pt-2',
    warningKey: 'morale',
    probes: ['firefight', 'andon', 'pairReview'],
  },
  {
    reason: 'techDebt',
    difficulty: 'nightmare',
    policy: 'naiveNoInterventionCtl',
    seed: 'pt-4',
    warningKey: 'techDebt',
    probes: ['firefight', 'andon', 'pairReview'],
  },
  {
    reason: 'reviewFreeze',
    difficulty: 'easy',
    policy: 'securityNeglect',
    seed: 'pt-5',
    warningKey: 'reviewQueuePeak',
    probes: ['splitPr', 'pairReview'],
  },
  {
    reason: 'aiDependency',
    difficulty: 'nightmare',
    policy: 'naiveNoInterventionCtl',
    seed: 'pt-7',
    warningKey: 'aiDependencyUnsafe',
    probes: ['aiThrottle', 'pairReview'],
  },
  {
    reason: 'budgetExhausted',
    difficulty: 'easy',
    policy: 'harnessBloated',
    seed: 'pt-9',
    warningKey: 'budget',
    probes: ['aiThrottle', 'andon', 'pairReview'],
  },
] as const;

export interface F9LimitedBranch {
  actionId: string;
  sprintsToLose: number | null;
  leftDanger: boolean;
  loseReason: string | null;
  status: string;
  truncated: boolean;
}

export interface F9RepresentativeObservation {
  reason: F9SpecReason;
  source: string;
  warningKey: F9WarningKey;
  firstDanger: DangerSample;
  sprintsPlayed: number;
  lostPhase: string;
  lostPrevState: NonNullable<RunLog['lostPrevState']>;
  mechanicallyAvailable: string[];
  counterfactualOrigin: NonNullable<RunLog['counterfactualOrigin']>;
  counterfactualApplicableActions: NonNullable<RunLog['counterfactualApplicableActions']>;
  baseline: NonNullable<RunLog['counterfactualBaseline']>;
  branches: F9LimitedBranch[];
  effectiveProbes: string[];
}

/** 危険域へ入った位置から敗北までの、代表シナリオ内の進行差。 */
export function dangerToLossGap(observation: F9RepresentativeObservation): number {
  return Math.max(0, observation.sprintsPlayed - observation.firstDanger.sprintsPlayed);
}

/** 実測警告・危険到達／敗北速度・決着位置・限定介入の組を安定キー化する。 */
export function representativeFingerprint(observation: F9RepresentativeObservation): string {
  return [
    observedWarningIndicators(observation).join(','),
    `${observation.firstDanger.sprintsPlayed}:${dangerToLossGap(observation)}:${observation.lostPhase}`,
    [...observation.effectiveProbes].sort().join(','),
  ].join('|');
}

/** 手動ラベルではなく、最初の危険域で実測した値から警告指標を再構成する。 */
export function observedWarningIndicators(
  observation: F9RepresentativeObservation,
): F9WarningKey[] {
  const signals = observation.firstDanger.signals;
  const indicators: F9WarningKey[] = [];
  if (signals.seniorHp < 50) indicators.push('seniorHp');
  if (signals.morale < 40) indicators.push('morale');
  if (Math.max(signals.techDebt, signals.activeTeamTechDebt) >= 60) {
    indicators.push('techDebt');
  }
  if (
    signals.aiDependency >= 50 &&
    signals.aiLiteracy <= OUTCOME_BALANCE.loseAiLiteracyUnsafeMax.value
  ) {
    indicators.push('aiDependencyUnsafe');
  }
  if (
    signals.budget <= 15 ||
    signals.budgetAfterNextInfraCharge <= 15 ||
    signals.strategicSpendExhaustsBudget
  ) {
    indicators.push('budget');
  }
  const reviewWatch = Math.round(REVIEW_FREEZE_PEAK * OUTCOME_BALANCE.reviewFreezeWatchRatio.value);
  if (signals.reviewQueue >= reviewWatch || signals.reviewQueuePeak >= reviewWatch) {
    indicators.push('reviewQueuePeak');
  }
  if (signals.consecutiveIncidentSprints >= CONSECUTIVE_INCIDENT_SPRINT_CAP - 2) {
    indicators.push('consecutiveIncidentSprints');
  }
  return indicators.sort();
}

export function fingerprintCollisions(
  observations: readonly F9RepresentativeObservation[],
): Array<{ fingerprint: string; reasons: F9SpecReason[] }> {
  const byFingerprint = new Map<string, string[]>();
  for (const observation of observations) {
    const key = representativeFingerprint(observation);
    const reasons = byFingerprint.get(key) ?? [];
    reasons.push(observation.reason);
    byFingerprint.set(key, reasons);
  }
  return [...byFingerprint.entries()]
    .filter(([, reasons]) => reasons.length > 1)
    .map(([fingerprint, reasons]) => ({
      fingerprint,
      reasons: reasons as F9SpecReason[],
    }));
}

/** 自然発生する6敗因を固定条件で再走し、限定介入だけを評価する。 */
export function observeNaturalF9Scenario(scenario: F9NaturalScenario): F9RepresentativeObservation {
  const log = runOnce(scenario.seed, scenario.difficulty, scenario.policy, 'fresh', {
    forceCounterfactual: true,
    recordCounterfactualBranches: true,
    counterfactualFrame: 'first-all-actions',
    counterfactual: {
      actions: scenario.probes,
      includeStrategic: false,
      maxSprints: 2,
      maxActionBranches: scenario.probes.length,
      maxComboBranches: 0,
      maxStrategicBranches: 0,
    },
  });
  if (log.status !== 'lost' || log.loseReason !== scenario.reason) {
    throw new Error(
      `${scenario.reason}: ${scenario.difficulty}/${scenario.policy}/${scenario.seed} が代表敗因を再現しない`,
    );
  }
  const firstDanger = log.availableActionsInDangerFirstSample;
  const lostPrevState = log.lostPrevState;
  const counterfactualOrigin = log.counterfactualOrigin;
  const counterfactualApplicableActions = log.counterfactualApplicableActions;
  const baseline = log.counterfactualBaseline;
  const branches = log.counterfactualBranches;
  if (
    !firstDanger ||
    !lostPrevState ||
    !counterfactualOrigin ||
    !counterfactualApplicableActions ||
    !baseline ||
    !branches
  ) {
    throw new Error(`${scenario.reason}: 代表観測が欠落`);
  }
  if (log.counterfactualIncomplete) {
    throw new Error(`${scenario.reason}: 限定介入を完全に評価できていない`);
  }
  const unavailable = scenario.probes.filter(
    (probe) => !counterfactualApplicableActions.includes(probe),
  );
  if (unavailable.length > 0) {
    throw new Error(`${scenario.reason}: 発動不能な限定介入: ${unavailable.join(', ')}`);
  }
  return {
    reason: scenario.reason,
    source: `${scenario.difficulty}/${scenario.policy}/${scenario.seed}`,
    warningKey: scenario.warningKey,
    firstDanger,
    sprintsPlayed: log.sprintsPlayed,
    lostPhase: log.lostPhase ?? 'unknown',
    lostPrevState,
    mechanicallyAvailable: log.availableActionsInDanger ?? [],
    counterfactualOrigin,
    counterfactualApplicableActions,
    baseline,
    branches,
    effectiveProbes: log.effectiveActionsInDanger ?? [],
  };
}

/**
 * 敗因予兆の危険域と、その時点の機械的発動可能手（RI-89 / RI-101）。
 *
 * プレイテスト観測と反実仮想評価が同じ定義を共有する。
 */
import { ALL_ACTION_IDS, canApplyAction } from '../actions';
import { assignableTasks } from '../assignTask';
import { clamp } from '../clamp';
import { canRecruit, RECRUIT_COST } from '../member';
import { OUTCOME_BALANCE, PROCESS_BALANCE } from '../../data/balance';
import {
  securityCustomerTrustDelta,
  securityCustomerTrustFromRaw,
  securityFragility,
} from '../model';
import { CONSECUTIVE_INCIDENT_SPRINT_CAP, REVIEW_FREEZE_PEAK } from '../outcome';
import { companyOrgFromTeams } from '../orgscale';
import type { ActionId } from '../types';
import { foldRunEffects, infraBillingRateForSprint } from './effects';
import { measureGoalProgress } from './quarterReview';
import { computeInfraCost } from './sprintBaselineBuild';
import type { RunEngine } from './engine';
import type { LoseReason, RunState, SprintKind } from './types';

/** HUD・四半期閾値の手前として観測する敗因。 */
export type DangerLoseReason = Extract<
  LoseReason,
  | 'seniorBurnout'
  | 'moraleCollapse'
  | 'techDebt'
  | 'aiDependency'
  | 'budgetExhausted'
  | 'trustExhausted'
  | 'kpiMissed'
  | 'reviewFreeze'
  | 'incidentCascade'
  | 'bossFailed'
  | 'reorgRequired'
>;

/** 対象省略で不可でも、明示 target（Backlog→Coding ドラッグ）なら差配できるか。 */
export function canApplyAssignTaskWithExplicitTarget(
  sprint: NonNullable<RunState['sprint']>,
  org: RunState['org'],
  tick: number,
): boolean {
  for (const task of assignableTasks(sprint)) {
    const target = { taskId: task.id, lane: 'coding' as const };
    if (canApplyAction('assignTask', sprint, org, tick, target).ok) return true;
  }
  return false;
}

/** 盤面上の機械的発動可能介入（RI-89 と同じ規則）。 */
export function listApplicableActions(engine: RunEngine): ActionId[] {
  const s = engine.snapshot();
  if (s.phase !== 'sprint' || !s.sprint || s.sprint.complete) return [];
  const available: ActionId[] = [];
  for (const id of ALL_ACTION_IDS) {
    if (canApplyAction(id, s.sprint, s.org, s.sprintTick).ok) {
      available.push(id);
      continue;
    }
    if (
      id === 'assignTask' &&
      canApplyAssignTaskWithExplicitTarget(s.sprint, s.org, s.sprintTick)
    ) {
      available.push(id);
    }
  }
  return available;
}

/**
 * F-9 / RI-89: 敗因予兆の危険域（HUD・四半期閾値の手前）。
 * 指標ごとに対応する敗因へ紐づけ、最終敗因の窓だけを報告できるようにする。
 */
export function activeDangerReasons(engine: RunEngine): DangerLoseReason[] {
  const s = engine.snapshot();
  const minTrust = Math.min(
    s.stakeholderTrust.management,
    s.stakeholderTrust.customers + pendingCustomerTrustDelta(s),
    s.stakeholderTrust.team,
  );
  const liveKpi = engine.previewLiveQuarterKpi();
  const kpiOrg = liveKpi?.org ?? companyOrgFromTeams(s.teams, s.org);
  const out: DangerLoseReason[] = [];
  if (kpiOrg.seniorHp < 50) out.push('seniorBurnout');
  if (kpiOrg.morale < 40) out.push('moraleCollapse');
  const liveTechDebt = liveKpi?.org.techDebt ?? kpiOrg.techDebt;
  if (s.org.techDebt >= 60 || liveTechDebt >= 60) out.push('techDebt');
  if (
    s.org.aiDependency >= 50 &&
    s.org.aiLiteracy <= OUTCOME_BALANCE.loseAiLiteracyUnsafeMax.value
  ) {
    out.push('aiDependency');
  }
  const nextBudget = budgetAfterNextInfraCharge(s);
  if (s.budget <= 15 || nextBudget <= 15 || strategicSpendExhaustsBudget(s)) {
    out.push('budgetExhausted');
  }
  const kpiTotals = liveKpi?.totals ?? s.quarterTotals;
  const kpiMissCount = measureGoalProgress({
    goal: s.quarterGoal,
    org: kpiOrg,
    totals: kpiTotals,
  }).filter((p) => p.status === 'missed').length;
  if (minTrust <= 25) out.push('trustExhausted');
  if (kpiMissCount >= OUTCOME_BALANCE.quarterCrisisMissedKpiMin.value) out.push('kpiMissed');
  else if (
    s.budget > OUTCOME_BALANCE.loseBudgetMax.value &&
    s.budget <= OUTCOME_BALANCE.quarterCrisisBudgetMax.value &&
    minTrust > OUTCOME_BALANCE.quarterCrisisTrustMax.value
  ) {
    out.push('kpiMissed');
  }
  const currentReviewQueue = s.sprint?.tasks.filter((task) => task.lane === 'review').length ?? 0;
  const otherReviewQueues = s.teams
    .filter((team) => team.id !== s.activeTeamId)
    .map((team) => team.reviewQueue);
  const reviewQueueLive = Math.max(currentReviewQueue, ...otherReviewQueues, 0);
  const sprintReviewPeak = s.sprint?.metrics.reviewQueueMax ?? 0;
  const projectedReviewPeak = liveKpi?.totals.reviewQueuePeak ?? 0;
  const runReviewPeak = s.totals.reviewQueuePeak ?? 0;
  const reviewWatch = Math.round(REVIEW_FREEZE_PEAK * OUTCOME_BALANCE.reviewFreezeWatchRatio.value);
  if (
    reviewQueueLive >= reviewWatch ||
    sprintReviewPeak >= reviewWatch ||
    projectedReviewPeak >= reviewWatch ||
    runReviewPeak >= reviewWatch
  ) {
    out.push('reviewFreeze');
  }
  if ((s.totals.consecutiveIncidentSprints ?? 0) >= CONSECUTIVE_INCIDENT_SPRINT_CAP - 2)
    out.push('incidentCascade');
  if (s.currentSprintKind === 'boss') out.push('bossFailed');
  if (
    (minTrust <= OUTCOME_BALANCE.quarterReorgTrustMax.value &&
      kpiMissCount >= OUTCOME_BALANCE.quarterReorgTrustMissedKpiMin.value) ||
    (s.quarterNumber >= OUTCOME_BALANCE.quarterReorgMinQuarter.value &&
      kpiMissCount >= OUTCOME_BALANCE.quarterReorgMissedKpiMin.value)
  )
    out.push('reorgRequired');
  return out;
}

/** 今選択でき、支払い後残高が 0 になる戦略支出があるか。 */
function strategicSpendExhaustsBudget(s: RunState): boolean {
  if (s.budget <= 0) return false;
  const costs: number[] = [];
  if (s.phase === 'shop' && s.shop) {
    for (const card of s.shop.cards) {
      if (!card.bought && s.budget >= card.cost) costs.push(card.cost);
    }
    if (s.shop.relic && !s.shop.relic.bought && s.budget >= s.shop.relic.cost) {
      costs.push(s.shop.relic.cost);
    }
    if (
      s.shop.recruit &&
      !s.shop.recruit.bought &&
      canRecruit(s.roster) &&
      s.budget >= s.shop.recruit.cost
    ) {
      costs.push(s.shop.recruit.cost);
    }
  }
  if (
    (s.phase === 'recruit' || s.phase === 'rest') &&
    canRecruit(s.roster) &&
    s.budget >= RECRUIT_COST
  ) {
    costs.push(RECRUIT_COST);
  }
  return costs.some((cost) => cost > 0 && s.budget === cost);
}

/** resolveSprint と同じ確定済み障害による顧客信頼デルタ。 */
function pendingCustomerTrustDelta(s: RunState): number {
  if (s.phase !== 'sprint' || !s.sprint) return 0;
  const metrics = s.sprint.metrics;
  const spread = metrics.spread ?? 0;
  const incidents = metrics.incidentCount ?? 0;
  const minimumCount = PROCESS_BALANCE.incidentTrustMinimumCount.value;
  if (spread > 0 && spread >= minimumCount && typeof metrics.securityTrustSpreadRaw === 'number') {
    return securityCustomerTrustFromRaw(
      metrics.securityTrustSpreadRaw +
        Math.max(minimumCount, incidents) *
          PROCESS_BALANCE.incidentTrustPerIncidentRaw.value *
          (metrics.securityTrustIncidentFragility ?? securityFragility(s.org.securityLevel)),
    );
  }
  return securityCustomerTrustDelta(s.org.securityLevel, incidents, spread);
}

function nextSprintKind(s: RunState): SprintKind {
  const nextIndex = s.sprintIndexInQuarter + 1;
  if (nextIndex > s.sprintsPerQuarter) return 'normal';
  if (nextIndex >= s.sprintsPerQuarter) return 'boss';
  return s.pendingSprintKind;
}

/** 次スプリント開始時に確定するインフラ課金後の残高。 */
function budgetAfterNextInfraCharge(s: RunState): number {
  const fold = foldRunEffects({
    deck: s.deck,
    relics: s.relics,
    evolution: s.evolution,
    difficulty: s.difficulty,
    trials: s.trials,
    scenario: s.scenario,
  });
  const rate = infraBillingRateForSprint(
    nextSprintKind(s),
    s.trials.includes('frontier-dependency'),
    fold.frontierModelCostPerDependency,
  );
  if (rate === null) return s.budget;
  const driftedActive = clamp(s.org.aiDependency + fold.aiDependencyDriftPerSprint, 0, 100);
  const teamsForBilling = s.teams.map((team) =>
    team.id === s.activeTeamId ? { ...team, aiDependency: driftedActive } : team,
  );
  const companyDep = companyOrgFromTeams(teamsForBilling, {
    ...s.org,
    aiDependency: driftedActive,
  }).aiDependency;
  return Math.max(0, s.budget - computeInfraCost(companyDep, rate, fold.effects.infraCostMul));
}

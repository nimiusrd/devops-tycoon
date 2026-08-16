/**
 * 敗因予兆の危険域と、その時点の機械的発動可能手（RI-89 / RI-101）。
 *
 * プレイテスト観測と反実仮想評価が同じ定義を共有する。
 */
import { ALL_ACTION_IDS, canApplyAction } from '../actions';
import { assignableTasks } from '../assignTask';
import { clamp } from '../clamp';
import { canRecruit, RECRUIT_COST } from '../member';
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
    s.stakeholderTrust.customers,
    s.stakeholderTrust.team,
  );
  const liveKpi = engine.previewLiveQuarterKpi();
  const kpiOrg = liveKpi?.org ?? companyOrgFromTeams(s.teams, s.org);
  const out: DangerLoseReason[] = [];
  if (kpiOrg.seniorHp < 50) out.push('seniorBurnout');
  if (kpiOrg.morale < 40) out.push('moraleCollapse');
  const liveTechDebt = liveKpi?.org.techDebt ?? kpiOrg.techDebt;
  if (s.org.techDebt >= 60 || liveTechDebt >= 60) out.push('techDebt');
  if (s.org.aiDependency >= 50 && s.org.aiLiteracy <= 30) out.push('aiDependency');
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
  if (minTrust <= 25 || s.budget <= 5 || s.org.seniorHp <= 10) out.push('trustExhausted');
  if (kpiMissCount >= 4) out.push('kpiMissed');
  else if (s.budget > 0 && s.budget <= 5 && minTrust > 15) out.push('kpiMissed');
  const currentReviewQueue = s.sprint?.tasks.filter((task) => task.lane === 'review').length ?? 0;
  const otherReviewQueues = s.teams
    .filter((team) => team.id !== s.activeTeamId)
    .map((team) => team.reviewQueue);
  const reviewQueueLive = Math.max(currentReviewQueue, ...otherReviewQueues, 0);
  const sprintReviewPeak = s.sprint?.metrics.reviewQueueMax ?? 0;
  const projectedReviewPeak = liveKpi?.totals.reviewQueuePeak ?? 0;
  const runReviewPeak = s.totals.reviewQueuePeak ?? 0;
  const reviewWatch = Math.round(REVIEW_FREEZE_PEAK * 0.75);
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
  if ((minTrust <= 20 && kpiMissCount >= 2) || (s.quarterNumber >= 2 && kpiMissCount >= 3))
    out.push('reorgRequired');
  return out;
}

/** 採用・ショップなど、今開いている／直後に来る戦略支出で残高が 0 になるか。 */
function strategicSpendExhaustsBudget(s: RunState): boolean {
  if (s.budget <= 0) return false;
  const costs: number[] = [];
  if (canRecruit(s.roster)) costs.push(RECRUIT_COST);
  if (s.shop) {
    for (const card of s.shop.cards) {
      if (!card.bought) costs.push(card.cost);
    }
    if (s.shop.relic && !s.shop.relic.bought) costs.push(s.shop.relic.cost);
    if (s.shop.recruit && !s.shop.recruit.bought) costs.push(s.shop.recruit.cost);
  }
  return costs.some((cost) => cost > 0 && s.budget <= cost);
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

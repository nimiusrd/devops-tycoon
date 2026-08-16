/**
 * 敗因予兆の危険域と、その時点の機械的発動可能手（RI-89 / RI-101）。
 *
 * プレイテスト観測と反実仮想評価が同じ定義を共有する。
 */
import { ALL_ACTION_IDS, canApplyAction } from '../actions';
import { assignableTasks } from '../assignTask';
import { CONSECUTIVE_INCIDENT_SPRINT_CAP, REVIEW_FREEZE_PEAK } from '../outcome';
import type { ActionId } from '../types';
import { measureGoalProgress } from './quarterReview';
import type { RunEngine } from './engine';
import type { LoseReason, RunState } from './types';

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
  const out: DangerLoseReason[] = [];
  if (s.org.seniorHp < 50) out.push('seniorBurnout');
  if (s.org.morale < 40) out.push('moraleCollapse');
  const liveTechDebt = liveKpi?.org.techDebt ?? s.org.techDebt;
  if (s.org.techDebt >= 60 || liveTechDebt >= 60) out.push('techDebt');
  if (s.org.aiDependency >= 50 && s.org.aiLiteracy <= 30) out.push('aiDependency');
  if (s.budget <= 15) out.push('budgetExhausted');
  const lateInQuarter = s.sprintIndexInQuarter >= Math.ceil(s.sprintsPerQuarter / 2);
  const kpiMissCount = liveKpi
    ? measureGoalProgress({
        goal: s.quarterGoal,
        org: liveKpi.org,
        totals: liveKpi.totals,
      }).filter((p) => p.status === 'missed').length
    : 0;
  if (minTrust <= 25 || s.budget <= 5 || s.org.seniorHp <= 10) out.push('trustExhausted');
  if (lateInQuarter && kpiMissCount >= 4) out.push('kpiMissed');
  if (s.budget > 0 && s.budget <= 5 && minTrust > 15) out.push('kpiMissed');
  const liveReviewPeak = Math.max(
    s.totals.reviewQueuePeak,
    s.sprint?.metrics.reviewQueueMax ?? 0,
    liveKpi?.totals.reviewQueuePeak ?? 0,
  );
  const reviewQueueDanger = liveReviewPeak >= Math.round(REVIEW_FREEZE_PEAK * 0.75);
  const reviewFreezeEventRisk = s.org.seniorHp <= 45;
  if (reviewQueueDanger || reviewFreezeEventRisk) out.push('reviewFreeze');
  if ((s.totals.consecutiveIncidentSprints ?? 0) >= CONSECUTIVE_INCIDENT_SPRINT_CAP - 2)
    out.push('incidentCascade');
  if (s.currentSprintKind === 'boss') out.push('bossFailed');
  if (
    (minTrust <= 20 && s.quarterNumber >= 2) ||
    (s.quarterNumber >= 2 && lateInQuarter && kpiMissCount >= 3)
  )
    out.push('reorgRequired');
  return out;
}

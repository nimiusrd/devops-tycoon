/**
 * Issue #602 の隔離決定論 sim。#731 の師弟処理と #538 の障害抽選だけを複製する。
 * 本番へは接続しない。
 */

import { COMPARISON_SEEDS, CONDITIONS, PARAMS, POLICIES } from './params.mjs';
import { createRng } from './rng.mjs';

function capacityFromReview(review) {
  return Math.floor(review / 10);
}

export function createState() {
  return {
    version: 1,
    period: 0,
    mentorReview: PARAMS.mentorReview,
    apprenticeReview: PARAMS.apprenticeReview,
    lessons: 0,
    backlog: 0,
    delivered: 0,
    apprenticeGrowthWork: 0,
    history: [],
  };
}

/**
 * seed から期間数だけ u ~ Uniform[0, 1) を引く。
 * 条件も方針もキーに入れない。同じ seed の安定／危機／両方針が同じ列を共有する。
 */
export function drawPeriodUniforms(seed, periods = PARAMS.periods) {
  const rng = createRng(seed);
  return Array.from({ length: periods }, () => rng());
}

export function incidentsFromDraws(draws, incidentRate) {
  return draws.map((value) => value < incidentRate);
}

export function advancePeriod(state, teach, incident) {
  const mentorBase = capacityFromReview(state.mentorReview);
  const apprenticeBase = capacityFromReview(state.apprenticeReview);
  const mentorCapacity = incident
    ? Math.max(0, mentorBase - PARAMS.incidentMentorCapacityLoss)
    : mentorBase;
  const apprenticeCapacity = apprenticeBase;
  const canTeach =
    teach &&
    !incident &&
    state.lessons < PARAMS.maxLessons &&
    state.apprenticeReview < PARAMS.abilityCap &&
    mentorCapacity >= PARAMS.mentorCapacityCost &&
    apprenticeCapacity >= PARAMS.apprenticeCapacityCost;
  const mentorCapacityCost = canTeach ? PARAMS.mentorCapacityCost : 0;
  const apprenticeCapacityCost = canTeach ? PARAMS.apprenticeCapacityCost : 0;
  const baselineReview = PARAMS.apprenticeReview;
  let remaining = state.backlog + PARAMS.demandPerPeriod;
  const mentorWork = Math.min(remaining, Math.max(0, mentorCapacity - mentorCapacityCost));
  remaining -= mentorWork;
  const apprenticeWork = Math.min(
    remaining,
    Math.max(0, apprenticeCapacity - apprenticeCapacityCost),
  );
  remaining -= apprenticeWork;
  const reviewGain = canTeach
    ? Math.min(PARAMS.reviewGain, PARAMS.abilityCap - state.apprenticeReview)
    : 0;
  const baselineCapacity = Math.max(0, capacityFromReview(baselineReview) - apprenticeCapacityCost);
  const apprenticeGrowthWork = Math.max(0, apprenticeWork - baselineCapacity);
  const period = {
    period: state.period + 1,
    incident,
    taught: canTeach,
    mentorWork,
    apprenticeWork,
    apprenticeGrowthWork,
    mentorCapacityCost,
    apprenticeCapacityCost,
    reviewGain,
    backlog: remaining,
  };
  return {
    ...state,
    period: state.period + 1,
    apprenticeReview: state.apprenticeReview + reviewGain,
    lessons: state.lessons + Number(canTeach),
    backlog: remaining,
    delivered: state.delivered + mentorWork + apprenticeWork,
    apprenticeGrowthWork: state.apprenticeGrowthWork + apprenticeGrowthWork,
    history: [...state.history, period],
  };
}

export function runIncidents(incidents, policy) {
  let state = createState();
  for (const incident of incidents) {
    const teach = policy.teachFirstLessons > 0 && state.lessons < policy.teachFirstLessons;
    state = advancePeriod(state, teach, incident);
  }
  return {
    policyId: policy.id,
    delivered: state.delivered,
    backlog: state.backlog,
    apprenticeReview: state.apprenticeReview,
    apprenticeGrowthWork: state.apprenticeGrowthWork,
    lessons: state.lessons,
    grown: state.lessons >= PARAMS.maxLessons,
    incidents: [...incidents],
    history: state.history,
  };
}

export function runPolicy(seed, condition, policy, periods = PARAMS.periods) {
  const draws = drawPeriodUniforms(seed, periods);
  const incidents = incidentsFromDraws(draws, condition.incidentRate);
  return {
    seed,
    conditionId: condition.id,
    incidentRate: condition.incidentRate,
    draws,
    ...runIncidents(incidents, policy),
  };
}

export function summarizePolicies(seed, conditionId, periods = PARAMS.periods) {
  const condition = CONDITIONS[conditionId];
  const draws = drawPeriodUniforms(seed, periods);
  const incidents = incidentsFromDraws(draws, condition.incidentRate);
  return Object.values(POLICIES).map((policy) => ({
    seed,
    conditionId: condition.id,
    incidentRate: condition.incidentRate,
    draws,
    ...runIncidents(incidents, policy),
  }));
}

export function winnerOf(concentrateDelivered, mentorDelivered) {
  if (mentorDelivered > concentrateDelivered) return 'mentor';
  if (concentrateDelivered > mentorDelivered) return 'concentrate';
  return 'tie';
}

export function assertSameIncidents(expected, actual, label) {
  const left = expected.map((flag) => Number(flag)).join(',');
  const right = actual.map((flag) => Number(flag)).join(',');
  if (left !== right) {
    throw new Error(`${label}: incident sequence mismatch: ${left} vs ${right}`);
  }
}

function periodNumbers(flags) {
  return flags.map((flag, index) => (flag ? index + 1 : null)).filter((period) => period !== null);
}

/**
 * 抽選列を方針の前に作り、同じ列で両方針を走らせる。
 * 生成列と両方針の history が一致することを assert する。
 */
export function compareCell(seed, conditionId, periods = PARAMS.periods) {
  const condition = CONDITIONS[conditionId];
  const draws = drawPeriodUniforms(seed, periods);
  const incidents = incidentsFromDraws(draws, condition.incidentRate);
  const concentrate = runIncidents(incidents, POLICIES.concentrate);
  const mentor = runIncidents(incidents, POLICIES.mentor);
  assertSameIncidents(incidents, concentrate.incidents, `${seed}/${conditionId}/concentrate`);
  assertSameIncidents(incidents, mentor.incidents, `${seed}/${conditionId}/mentor`);
  assertSameIncidents(
    concentrate.incidents,
    mentor.incidents,
    `${seed}/${conditionId}/shared-policies`,
  );
  const concentrateHistory = concentrate.history.map((entry) => Number(entry.incident)).join(',');
  const mentorHistory = mentor.history.map((entry) => Number(entry.incident)).join(',');
  const expectedHistory = incidents.map((flag) => Number(flag)).join(',');
  if (concentrateHistory !== expectedHistory || mentorHistory !== expectedHistory) {
    throw new Error(`${seed}/${conditionId}: history incidents diverged from pre-drawn sequence`);
  }
  return {
    seed,
    conditionId,
    incidentRate: condition.incidentRate,
    draws,
    incidents,
    incidentPeriods: periodNumbers(incidents),
    lessonPeriods: periodNumbers(mentor.history.map((entry) => entry.taught)),
    concentrateDelivered: concentrate.delivered,
    mentorDelivered: mentor.delivered,
    winner: winnerOf(concentrate.delivered, mentor.delivered),
    apprenticeGrowthWork: mentor.apprenticeGrowthWork,
    concentrateGrowthWork: concentrate.apprenticeGrowthWork,
    lessons: mentor.lessons,
  };
}

export function compareAll() {
  const rows = COMPARISON_SEEDS.flatMap((seed) =>
    Object.keys(CONDITIONS).map((conditionId) => compareCell(seed, conditionId)),
  );
  const stableRows = rows.filter((row) => row.conditionId === 'stable');
  const crisisRows = rows.filter((row) => row.conditionId === 'crisis');
  const stableMentorWins = stableRows.filter((row) => row.winner === 'mentor').length;
  const crisisConcentrateWins = crisisRows.filter((row) => row.winner === 'concentrate').length;
  const stableTies = stableRows.filter((row) => row.winner === 'tie').length;
  const crisisTies = crisisRows.filter((row) => row.winner === 'tie').length;
  const stablePassed = stableMentorWins >= PARAMS.passLine.stableMentorWins;
  const crisisPassed = crisisConcentrateWins >= PARAMS.passLine.crisisConcentrateWins;
  return {
    frozen: {
      periods: PARAMS.periods,
      demandPerPeriod: PARAMS.demandPerPeriod,
      mentorReview: PARAMS.mentorReview,
      apprenticeReview: PARAMS.apprenticeReview,
      stableIncidentRate: PARAMS.stableIncidentRate,
      crisisIncidentRate: PARAMS.crisisIncidentRate,
      crisisIncidentMultiplier: PARAMS.crisisIncidentMultiplier,
      seeds: COMPARISON_SEEDS,
      decisionMetric: PARAMS.decisionMetric,
      passLine: PARAMS.passLine,
    },
    rows,
    scores: {
      stableMentorWins,
      crisisConcentrateWins,
      stableTies,
      crisisTies,
      seedCount: PARAMS.passLine.seeds,
      stableRequired: PARAMS.passLine.stableMentorWins,
      crisisRequired: PARAMS.passLine.crisisConcentrateWins,
      stablePassed,
      crisisPassed,
    },
    verdict: stablePassed && crisisPassed ? 'Pass' : 'Kill',
  };
}

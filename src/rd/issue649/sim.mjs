/**
 * Issue #649 の隔離決定論 sim。本番の RunEngine / firefight には接続しない。
 * Phase 1 は式の実装と smoke 用の自明ケースだけを公開する。
 */

import { PARAMS, POLICIES, ROLES } from './params.mjs';

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * 役割枠への割当。同一人物の二重割当は後勝ちせず、違反として数えて無視する。
 * 初期割当の順序は recovery → investigation → communication。
 */
export function assignRoles(staffIds, roleLists) {
  const assigned = new Map();
  const roles = { recovery: [], investigation: [], communication: [] };
  let violations = 0;

  for (const role of ROLES) {
    for (const staffId of roleLists[role] ?? []) {
      if (!staffIds.includes(staffId)) {
        violations += 1;
        continue;
      }
      if (assigned.has(staffId)) {
        violations += 1;
        continue;
      }
      assigned.set(staffId, role);
      roles[role].push(staffId);
    }
  }

  return {
    roles,
    unassigned: staffIds.filter((staffId) => !assigned.has(staffId)),
    violations,
  };
}

export function roleListsForPolicy(staffIds, policy) {
  const unused = [...staffIds];
  const take = (count) => unused.splice(0, count);
  return {
    recovery: take(policy.recovery),
    investigation: take(policy.investigation),
    communication: take(policy.communication),
  };
}

export function recoveryRate(recoveryCount, params) {
  return recoveryCount > 0 ? recoveryCount * params.recoveryPower : params.baselineRecoveryRate;
}

export function recoveryTimeForCount(recoveryCount, params) {
  return params.baseRecoveryWork / recoveryRate(recoveryCount, params);
}

export function recurrenceChance(baseRecurrence, investigationCount, params) {
  return clamp(baseRecurrence - investigationCount * params.investigationRecurrenceReduction, 0, 1);
}

export function trustDropPerIncident(communicationCount, params) {
  return Math.max(
    0,
    params.baseTrustDrop - communicationCount * params.communicationTrustReduction,
  );
}

/**
 * 閉じた式。tick ループは持たない。investigation-first の 1 回交代だけを位相で表す。
 *
 * 調査完了後、investigation-first は調査担当 1 人を復旧へ移す。
 * 残り調査担当は役割完了で未配置になり、通常成果だけを出す。
 * 説明担当は停止中ずっと枠を占め、信頼低下だけを抑える。
 */
export function simulate(params, condition, policy) {
  const lists = roleListsForPolicy(params.staffIds, policy);
  const assignment = assignRoles(params.staffIds, lists);
  const recoveryCount = assignment.roles.recovery.length;
  const investigationCount = assignment.roles.investigation.length;
  const communicationCount = assignment.roles.communication.length;

  const chance = recurrenceChance(condition.baseRecurrence, investigationCount, params);
  const recurred = chance >= params.recurrenceThreshold;
  const incidentCount = 1 + (recurred ? 1 : 0);
  const dropPerIncident = trustDropPerIncident(communicationCount, params);
  const effectiveTrustDrop = Math.min(1, dropPerIncident * incidentCount);

  const investigationTicks =
    investigationCount > 0 ? params.investigationWork / investigationCount : 0;

  let firstRecoveryTime;
  let switchesPaid = 0;
  let releasedAfterInvestigation = 0;
  let recoveryCountAfterSwitch = recoveryCount;

  if (policy.id === 'investigation-first' && policy.plannedSwitches > 0 && investigationCount > 0) {
    const phase1Rate = recoveryRate(recoveryCount, params);
    const phase1Work = investigationTicks * phase1Rate;
    recoveryCountAfterSwitch = recoveryCount + 1;
    const phase2Rate = recoveryRate(recoveryCountAfterSwitch, params);
    const remainingWork = Math.max(0, params.baseRecoveryWork - phase1Work);
    firstRecoveryTime = investigationTicks + remainingWork / phase2Rate;
    switchesPaid = policy.plannedSwitches;
    releasedAfterInvestigation = Math.max(0, investigationCount - 1);
  } else {
    firstRecoveryTime = recoveryTimeForCount(recoveryCount, params);
    if (investigationCount > 0) {
      releasedAfterInvestigation = investigationCount;
    }
  }

  const secondRecoveryTime = recurred ? recoveryTimeForCount(recoveryCountAfterSwitch, params) : 0;
  const totalDowntime = firstRecoveryTime + secondRecoveryTime;
  const postTicks = Math.max(0, params.horizonTicks - totalDowntime);
  const postValue = params.staffIds.length * params.normalWorkPerTick * postTicks;
  const unassignedTicks = Math.max(0, firstRecoveryTime - investigationTicks) + secondRecoveryTime;
  const unassignedValue = releasedAfterInvestigation * params.normalWorkPerTick * unassignedTicks;
  const rawShipped = params.alreadyShipped + postValue + unassignedValue;
  const shippedAfterTrust = rawShipped * (1 - effectiveTrustDrop);
  const downtimeCost = totalDowntime * params.downtimeCostPerTick;
  const switchCostPaid = switchesPaid * params.switchCost;

  return {
    seed: params.seed,
    conditionId: condition.id,
    policyId: policy.id,
    assignment,
    violations: assignment.violations,
    recoveryTime: firstRecoveryTime,
    secondRecoveryTime,
    totalDowntime,
    recurrenceChance: chance,
    recurred,
    incidentCount,
    trustDropPerIncident: dropPerIncident,
    effectiveTrustDrop,
    rawShipped,
    shippedAfterTrust,
    downtimeCost,
    switchCost: switchCostPaid,
    unassignedValue,
    netOutcome: shippedAfterTrust - downtimeCost - switchCostPaid,
    decisionMetric: params.decisionMetric,
  };
}

export function simulatePolicy(condition, policyId, params = PARAMS) {
  return simulate(params, condition, POLICIES[policyId]);
}

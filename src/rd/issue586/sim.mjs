/**
 * Issue #586 の隔離決定論 sim。RI-190 の計画 tick と迷走を最小複製する。
 * 本番へは接続しない。
 */

import { CONDITIONS, JOB_VALUE, PARAMS, POLICIES, wanderRate } from './params.mjs';
import { createRng } from './rng.mjs';

/**
 * seed から方針・条件より先に u ~ Uniform[0, 1) を 1 回引く。
 * 4 条件と 2 方針が同じ列を共有する。
 */
export function drawWanderUniforms(seed, count = PARAMS.drawsPerSeed) {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => rng());
}

export function wanderedFromDraw(draw, rate) {
  return draw < rate;
}

export function neededTicks(policyId, wandered) {
  const planTicks = POLICIES[policyId].paysPlanTicks ? PARAMS.planTicks : 0;
  const extra = wandered ? PARAMS.wanderExtra : 0;
  return planTicks + PARAMS.jobWork + extra;
}

export function shippedValueOf(kind, finished, wandered) {
  if (!finished) return 0;
  const value = JOB_VALUE[kind];
  return wandered ? value - PARAMS.wanderPenalty : value;
}

/** 1 tick に計画 1 か実装 1。迷走は最初の実装 tick で工数へ足す。 */
export function runJob(condition, policy, wandered, draws) {
  let planLeft = policy.paysPlanTicks ? PARAMS.planTicks : 0;
  let workLeft = PARAMS.jobWork;
  let appliedWander = false;
  let tick = 0;
  while (tick < condition.deadline) {
    tick += 1;
    if (planLeft > 0) {
      planLeft -= 1;
      continue;
    }
    if (!appliedWander) {
      appliedWander = true;
      if (wandered) workLeft += PARAMS.wanderExtra;
    }
    workLeft -= 1;
    if (workLeft <= 0) {
      return {
        policyId: policy.id,
        kind: condition.kind,
        slack: condition.slack,
        deadline: condition.deadline,
        wandered,
        draws: [...draws],
        finished: true,
        tick,
        needed: neededTicks(policy.id, wandered),
        shippedValue: shippedValueOf(condition.kind, true, wandered),
      };
    }
  }
  return {
    policyId: policy.id,
    kind: condition.kind,
    slack: condition.slack,
    deadline: condition.deadline,
    wandered,
    draws: [...draws],
    finished: false,
    tick,
    needed: neededTicks(policy.id, wandered),
    shippedValue: 0,
  };
}

export function winnerOf(planValue, rushValue) {
  if (planValue > rushValue) return 'plan';
  if (rushValue > planValue) return 'rush';
  return 'tie';
}

export function assertSameDraws(expected, actual, label) {
  const left = expected.join(',');
  const right = actual.join(',');
  if (left !== right) {
    throw new Error(`${label}: draw sequence mismatch: ${left} vs ${right}`);
  }
}

function resultFromDraws(condition, policy, draws) {
  const draw = draws[0];
  const wandered = wanderedFromDraw(draw, wanderRate(condition.kind, policy.id));
  return runJob(condition, policy, wandered, draws);
}

/**
 * 抽選列を方針の前に作り、同じ列で両方針を走らせる。
 * 生成列と両方針が記録した u が一致することを assert する。
 */
export function compareCell(seed, conditionId) {
  const condition = CONDITIONS[conditionId];
  const draws = drawWanderUniforms(seed);
  const plan = resultFromDraws(condition, POLICIES.plan, draws);
  const rush = resultFromDraws(condition, POLICIES.rush, draws);
  assertSameDraws(draws, plan.draws, `${seed}/${conditionId}/plan`);
  assertSameDraws(draws, rush.draws, `${seed}/${conditionId}/rush`);
  assertSameDraws(plan.draws, rush.draws, `${seed}/${conditionId}/shared-policies`);
  return {
    seed,
    conditionId,
    kind: condition.kind,
    slack: condition.slack,
    deadline: condition.deadline,
    draws,
    draw: draws[0],
    planWandered: plan.wandered,
    rushWandered: rush.wandered,
    planValue: plan.shippedValue,
    rushValue: rush.shippedValue,
    planFinished: plan.finished,
    rushFinished: rush.finished,
    planNeeded: plan.needed,
    rushNeeded: rush.needed,
    winner: winnerOf(plan.shippedValue, rush.shippedValue),
  };
}

export function runSequence(conditionId, u) {
  const draws = [u];
  const condition = CONDITIONS[conditionId];
  const plan = resultFromDraws(condition, POLICIES.plan, draws);
  const rush = resultFromDraws(condition, POLICIES.rush, draws);
  assertSameDraws(draws, plan.draws, `${conditionId}/sequence/plan`);
  assertSameDraws(draws, rush.draws, `${conditionId}/sequence/rush`);
  return {
    conditionId,
    u,
    planWandered: plan.wandered,
    rushWandered: rush.wandered,
    plan: plan.shippedValue,
    rush: rush.shippedValue,
    planNeeded: plan.needed,
    rushNeeded: rush.needed,
    planFinished: plan.finished,
    rushFinished: rush.finished,
    winner: winnerOf(plan.shippedValue, rush.shippedValue),
  };
}

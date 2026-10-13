/**
 * Issue #649 Phase 1: 隔離実験の smoke だけを走らせる。
 * 本実験（条件 A/B × 3 方針）は実行しない。
 */
import { SMOKE_CASE, SMOKE_DOUBLE_ASSIGN } from '../src/rd/issue649/params.mjs';
import { assignRoles, simulate } from '../src/rd/issue649/sim.mjs';

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function same(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label}: expected ${expected}, got ${actual}`);
    return false;
  }
  return true;
}

const args = process.argv.slice(2);
if (args.includes('--full') || args.includes('--compare')) {
  console.error('Phase 1 は smoke のみ。本実験の比較実行は拒否する。');
  process.exit(2);
}

const smokeParams = {
  ...SMOKE_CASE,
  staffIds: [...SMOKE_CASE.staffIds],
  decisionMetric: 'netOutcome',
};

const smoke = simulate(smokeParams, SMOKE_CASE.condition, SMOKE_CASE.policy);
const expected = SMOKE_CASE.expected;

console.log('issue649 smoke');
console.log(
  JSON.stringify(
    {
      id: SMOKE_CASE.id,
      violations: smoke.violations,
      recoveryTime: smoke.recoveryTime,
      totalDowntime: smoke.totalDowntime,
      recurred: smoke.recurred,
      shippedAfterTrust: smoke.shippedAfterTrust,
      netOutcome: smoke.netOutcome,
    },
    null,
    2,
  ),
);

same(smoke.violations, expected.violations, 'smoke.violations');
same(smoke.recoveryTime, expected.recoveryTime, 'smoke.recoveryTime');
same(smoke.totalDowntime, expected.totalDowntime, 'smoke.totalDowntime');
same(smoke.recurred, expected.recurred, 'smoke.recurred');
same(smoke.incidentCount, expected.incidentCount, 'smoke.incidentCount');
same(smoke.effectiveTrustDrop, expected.effectiveTrustDrop, 'smoke.effectiveTrustDrop');
same(smoke.shippedAfterTrust, expected.shippedAfterTrust, 'smoke.shippedAfterTrust');
same(smoke.netOutcome, expected.netOutcome, 'smoke.netOutcome');

const overlapping = assignRoles(
  [...SMOKE_DOUBLE_ASSIGN.staffIds],
  SMOKE_DOUBLE_ASSIGN.overlappingLists,
);
console.log(
  JSON.stringify(
    {
      id: SMOKE_DOUBLE_ASSIGN.id,
      violations: overlapping.violations,
      recovery: overlapping.roles.recovery,
      investigation: overlapping.roles.investigation,
    },
    null,
    2,
  ),
);
same(overlapping.violations, SMOKE_DOUBLE_ASSIGN.expectedViolations, 'double-assign.violations');
same(overlapping.roles.recovery.length, 1, 'double-assign.recovery-kept');
same(overlapping.roles.investigation.length, 0, 'double-assign.investigation-rejected');

if (!process.exitCode) {
  console.log('smoke ok');
}

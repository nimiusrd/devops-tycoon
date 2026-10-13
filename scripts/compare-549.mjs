/**
 * Issue #549: 隔離実験。Phase 1 は smoke のみ。比較結果は書かない。
 */
import {
  CONDITIONS,
  POLICIES,
  SMOKE_NO_DOUBLE_COUNT,
  SMOKE_RI153,
} from '../src/rd/issue549/params.mjs';
import { assertAccounting, createBoard, runPolicy, tickBoard } from '../src/rd/issue549/sim.mjs';

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function same(actual, expected, label) {
  const left = Array.isArray(actual) ? actual.join(',') : actual;
  const right = Array.isArray(expected) ? expected.join(',') : expected;
  if (left !== right) {
    fail(`${label}: expected ${right}, got ${left}`);
    return false;
  }
  return true;
}

function checkResult(actual, expected, prefix) {
  same(actual.individualValue, expected.individualValue, `${prefix}.individualValue`);
  same(actual.setReward, expected.setReward, `${prefix}.setReward`);
  same(actual.totalShippedValue, expected.totalShippedValue, `${prefix}.totalShippedValue`);
  same(actual.completedFeatureIds, expected.completedFeatureIds, `${prefix}.completedFeatureIds`);
  same(
    actual.individualShipEvents,
    expected.individualShipEvents,
    `${prefix}.individualShipEvents`,
  );
  same(actual.setCompletionEvents, expected.setCompletionEvents, `${prefix}.setCompletionEvents`);
}

function runSmoke() {
  const condition = CONDITIONS[SMOKE_RI153.conditionId];
  const initial = createBoard(SMOKE_RI153.seed, condition);
  const reworkFlags = Object.fromEntries(
    initial.tasks
      .filter((task) => task.role === 'migration')
      .map((task) => [task.id, task.reworkPending]),
  );

  console.log('issue549 smoke');
  console.log(
    JSON.stringify(
      {
        id: SMOKE_RI153.id,
        seed: SMOKE_RI153.seed,
        condition: condition.id,
        deadline: condition.deadline,
        reworkProbability: condition.reworkProbability,
        reworkPending: reworkFlags,
      },
      null,
      2,
    ),
  );

  same(reworkFlags[2], SMOKE_RI153.expectedReworkPending[2], 'ri153.task2.reworkPending');
  same(reworkFlags[5], SMOKE_RI153.expectedReworkPending[5], 'ri153.task5.reworkPending');

  const rows = [];
  for (const policy of Object.values(POLICIES)) {
    const result = runPolicy(SMOKE_RI153.seed, condition, policy);
    rows.push({
      policy: result.policyId,
      individualValue: result.individualValue,
      setReward: result.setReward,
      totalShippedValue: result.totalShippedValue,
      completedFeatureIds: result.completedFeatureIds,
      individualShipEvents: result.individualShipEvents,
      setCompletionEvents: result.setCompletionEvents,
    });
    checkResult(result, SMOKE_RI153.expected[policy.id], `ri153.${policy.id}`);
  }
  console.log(JSON.stringify({ ri153: rows }, null, 2));

  const noDouble = SMOKE_NO_DOUBLE_COUNT;
  let state = createBoard(noDouble.seed, {
    id: noDouble.id,
    deadline: noDouble.deadline,
    reworkProbability: noDouble.reworkProbability,
  });
  same(
    state.tasks.every((task) => task.reworkPending === false),
    true,
    'no-double.reworkOff',
  );
  for (const id of noDouble.order) {
    while (!state.tasks[id].done) state = tickBoard(state, id);
  }
  const accounting = assertAccounting(state);
  const completedFeatureIds = state.completions.map((feature) => feature.featureId);
  console.log(
    JSON.stringify(
      {
        id: noDouble.id,
        ...accounting,
        completedFeatureIds,
      },
      null,
      2,
    ),
  );
  checkResult({ ...accounting, completedFeatureIds }, noDouble.expected, 'no-double');

  const afterDone = tickBoard(state, 0);
  same(
    afterDone === state || afterDone.tick === state.tick,
    true,
    'no-double.done-noop-identity-or-tick',
  );
  same(afterDone.individualValue, state.individualValue, 'no-double.done-noop.individual');
  same(afterDone.setCompletionEvents, state.setCompletionEvents, 'no-double.done-noop.sets');
  same(afterDone.individualShipEvents, state.individualShipEvents, 'no-double.done-noop.ships');
  assertAccounting(afterDone);

  const afterDeadline = tickBoard({ ...state, tick: state.deadline }, 0);
  same(afterDeadline.individualValue, state.individualValue, 'no-double.deadline.individual');
  same(afterDeadline.setCompletionEvents, 2, 'no-double.deadline.sets');

  if (!process.exitCode) console.log('smoke ok');
}

const args = process.argv.slice(2);
if (args.includes('--full') || args.includes('--compare')) {
  console.log('Phase 1: comparison results are out of scope. Run without flags for smoke.');
} else {
  runSmoke();
}

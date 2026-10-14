/**
 * Issue #586: 隔離実験。Phase 1 は smoke のみ。比較結果は書かない。
 */
import {
  COMPARISON_SEEDS,
  CONDITIONS,
  PARAMS,
  POLICIES,
  SMOKE_SEQUENCES,
  wanderRate,
} from '../src/rd/issue586/params.mjs';
import {
  compareCell,
  drawWanderUniforms,
  runSequence,
  wanderedFromDraw,
} from '../src/rd/issue586/sim.mjs';

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

function runSmoke() {
  console.log('issue586 smoke');
  console.log(
    JSON.stringify(
      {
        frozen: {
          planTicks: PARAMS.planTicks,
          jobWork: PARAMS.jobWork,
          wanderExtra: PARAMS.wanderExtra,
          wanderPenalty: PARAMS.wanderPenalty,
          tightDeadline: PARAMS.tightDeadline,
          plentyDeadline: PARAMS.plentyDeadline,
          rushWanderRate: PARAMS.rushWanderRate,
          planWanderRate: PARAMS.planWanderRate,
          simpleWanderRate: PARAMS.simpleWanderRate,
          decisionMetric: PARAMS.decisionMetric,
          simpleExcludedFromVerdict: PARAMS.simpleExcludedFromVerdict,
          passLine: PARAMS.passLine,
          seeds: COMPARISON_SEEDS,
        },
      },
      null,
      2,
    ),
  );

  same(PARAMS.planTicks, 2, 'frozen.planTicks');
  same(PARAMS.jobWork, 6, 'frozen.jobWork');
  same(PARAMS.wanderExtra, 2, 'frozen.wanderExtra');
  same(PARAMS.wanderPenalty, 6, 'frozen.wanderPenalty');
  same(PARAMS.tightDeadline, 8, 'frozen.tightDeadline');
  same(PARAMS.plentyDeadline, 12, 'frozen.plentyDeadline');
  same(PARAMS.rushWanderRate, 0.5, 'frozen.rushWanderRate');
  same(PARAMS.planWanderRate, 0.25, 'frozen.planWanderRate');
  same(PARAMS.simpleWanderRate, 0.5, 'frozen.simpleWanderRate');
  same(PARAMS.decisionMetric, 'shippedValue', 'frozen.decisionMetric');
  same(PARAMS.simpleExcludedFromVerdict, true, 'frozen.excludeSimple');
  same(PARAMS.passLine.complexPlentyPlanWins, 4, 'frozen.pass.complexPlenty');
  same(PARAMS.passLine.tightRushWins, 4, 'frozen.pass.tightRush');
  same(COMPARISON_SEEDS.join(','), 'RI-586-a,RI-586-b,RI-586-c,RI-586-d,RI-586-e', 'frozen.seeds');

  const sharedSeed = COMPARISON_SEEDS[0];
  const sharedDraws = drawWanderUniforms(sharedSeed);
  same(sharedDraws.length, PARAMS.drawsPerSeed, 'shared.draws.length');
  for (const condition of Object.values(CONDITIONS)) {
    const cell = compareCell(sharedSeed, condition.id);
    same(cell.draws.join(','), sharedDraws.join(','), `${condition.id}.shared-draws`);
    same(cell.draw, sharedDraws[0], `${condition.id}.shared-u`);
    same(
      cell.planWandered,
      wanderedFromDraw(sharedDraws[0], wanderRate(condition.kind, POLICIES.plan.id)),
      `${condition.id}.plan.wander-from-shared-u`,
    );
    same(
      cell.rushWandered,
      wanderedFromDraw(sharedDraws[0], wanderRate(condition.kind, POLICIES.rush.id)),
      `${condition.id}.rush.wander-from-shared-u`,
    );
    if (condition.kind === 'complex' && cell.planWandered && !cell.rushWandered) {
      fail(`${condition.id}: plan wandered without rush; nested rates forbid this`);
    }
    if (condition.kind === 'simple' && cell.planWandered !== cell.rushWandered) {
      fail(`${condition.id}: simple policies must share wander`);
    }
  }

  const sequenceRows = [];
  for (const sequence of Object.values(SMOKE_SEQUENCES)) {
    const result = runSequence(sequence.conditionId, sequence.u);
    same(result.planWandered, sequence.expected.planWandered, `${sequence.id}.planWandered`);
    same(result.rushWandered, sequence.expected.rushWandered, `${sequence.id}.rushWandered`);
    same(result.plan, sequence.expected.plan, `${sequence.id}.plan`);
    same(result.rush, sequence.expected.rush, `${sequence.id}.rush`);
    same(result.winner, sequence.expected.winner, `${sequence.id}.winner`);
    sequenceRows.push({
      id: sequence.id,
      u: sequence.u,
      plan: result.plan,
      rush: result.rush,
      winner: result.winner,
      planWandered: result.planWandered,
      rushWandered: result.rushWandered,
    });
  }
  console.log(JSON.stringify({ sequences: sequenceRows }, null, 2));

  const planWins = {
    'complex-plenty': sequenceRows.some(
      (row) => row.id.startsWith('complex-plenty') && row.winner === 'plan',
    ),
    'complex-tight': sequenceRows.some(
      (row) => row.id.startsWith('complex-tight') && row.winner === 'plan',
    ),
    'simple-plenty': sequenceRows.some(
      (row) => row.id.startsWith('simple-plenty') && row.winner === 'plan',
    ),
    'simple-tight': sequenceRows.some(
      (row) => row.id.startsWith('simple-tight') && row.winner === 'plan',
    ),
  };
  const rushWins = {
    'complex-plenty': sequenceRows.some(
      (row) => row.id.startsWith('complex-plenty') && row.winner === 'rush',
    ),
    'complex-tight': sequenceRows.some(
      (row) => row.id.startsWith('complex-tight') && row.winner === 'rush',
    ),
    'simple-plenty': sequenceRows.some(
      (row) => row.id.startsWith('simple-plenty') && row.winner === 'rush',
    ),
    'simple-tight': sequenceRows.some(
      (row) => row.id.startsWith('simple-tight') && row.winner === 'rush',
    ),
  };
  same(planWins['complex-plenty'], true, 'feasibility.complex-plenty.plan');
  same(rushWins['complex-plenty'], false, 'feasibility.complex-plenty.rush-absent');
  same(planWins['complex-tight'], true, 'feasibility.complex-tight.plan');
  same(rushWins['complex-tight'], true, 'feasibility.complex-tight.rush');
  same(planWins['simple-plenty'], false, 'feasibility.simple-plenty.plan-absent');
  same(planWins['simple-tight'], false, 'feasibility.simple-tight.plan-absent');
  same(PARAMS.simpleExcludedFromVerdict, true, 'verdict.excludeSimple');

  if (!process.exitCode) console.log('smoke ok');
}

const args = process.argv.slice(2);
if (args.includes('--full') || args.includes('--compare')) {
  console.log('Phase 1: comparison results are out of scope. Run without flags for smoke.');
} else {
  runSmoke();
}

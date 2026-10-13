/**
 * Issue #602: 隔離実験。Phase 1 は smoke のみ。比較結果は書かない。
 */
import {
  COMPARISON_SEEDS,
  CONDITIONS,
  PARAMS,
  POLICIES,
  SMOKE_RI206,
  SMOKE_SEQUENCES,
} from '../src/rd/issue602/params.mjs';
import {
  drawPeriodUniforms,
  incidentsFromDraws,
  runIncidents,
  runPolicy,
  summarizePolicies,
  winnerOf,
} from '../src/rd/issue602/sim.mjs';

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

function checkDelivered(actual, expected, prefix) {
  same(actual.delivered, expected.delivered, `${prefix}.delivered`);
  if (expected.backlog !== undefined) same(actual.backlog, expected.backlog, `${prefix}.backlog`);
  if (expected.apprenticeReview !== undefined) {
    same(actual.apprenticeReview, expected.apprenticeReview, `${prefix}.apprenticeReview`);
  }
  same(
    actual.apprenticeGrowthWork,
    expected.apprenticeGrowthWork,
    `${prefix}.apprenticeGrowthWork`,
  );
  if (expected.lessons !== undefined) same(actual.lessons, expected.lessons, `${prefix}.lessons`);
}

function runSmoke() {
  console.log('issue602 smoke');
  console.log(
    JSON.stringify(
      {
        id: SMOKE_RI206.id,
        incidentRate: SMOKE_RI206.incidentRate,
        frozen: {
          periods: PARAMS.periods,
          demandPerPeriod: PARAMS.demandPerPeriod,
          mentorReview: PARAMS.mentorReview,
          apprenticeReview: PARAMS.apprenticeReview,
          stableIncidentRate: PARAMS.stableIncidentRate,
          crisisIncidentRate: PARAMS.crisisIncidentRate,
          crisisIncidentMultiplier: PARAMS.crisisIncidentMultiplier,
          seeds: COMPARISON_SEEDS,
        },
      },
      null,
      2,
    ),
  );

  const zeroIncident = { id: 'no-incident', incidentRate: 0 };
  const reproduced = [];
  for (const periods of [2, 8]) {
    const row = { periods };
    for (const policy of Object.values(POLICIES)) {
      const result = runPolicy(SMOKE_RI206.seed, zeroIncident, policy, periods);
      row[policy.id] = {
        delivered: result.delivered,
        backlog: result.backlog,
        apprenticeReview: result.apprenticeReview,
        apprenticeGrowthWork: result.apprenticeGrowthWork,
      };
      same(
        result.incidents.every((incident) => incident === false),
        true,
        `ri206.${periods}.calm`,
      );
      checkDelivered(
        result,
        SMOKE_RI206.expected[periods][policy.id],
        `ri206.${periods}.${policy.id}`,
      );
    }
    reproduced.push(row);
  }
  console.log(JSON.stringify({ ri206: reproduced }, null, 2));

  const sharedSeed = COMPARISON_SEEDS[0];
  const sharedDraws = drawPeriodUniforms(sharedSeed, PARAMS.periods);
  same(sharedDraws.length, PARAMS.periods, 'shared.draws.length');
  for (const condition of Object.values(CONDITIONS)) {
    const incidents = incidentsFromDraws(sharedDraws, condition.incidentRate);
    const rows = summarizePolicies(sharedSeed, condition.id);
    same(rows.length, 2, `${condition.id}.policyCount`);
    for (const row of rows) {
      same(row.draws.join(','), sharedDraws.join(','), `${condition.id}.${row.policyId}.draws`);
      same(
        row.incidents.join(','),
        incidents.join(','),
        `${condition.id}.${row.policyId}.incidents`,
      );
    }
    const crisisIncidents = incidentsFromDraws(sharedDraws, CONDITIONS.crisis.incidentRate);
    const stableIncidents = incidentsFromDraws(sharedDraws, CONDITIONS.stable.incidentRate);
    const subset = stableIncidents.every((flag, index) => !flag || crisisIncidents[index]);
    same(subset, true, 'crisis-superset-of-stable');
  }

  const sequenceRows = [];
  for (const sequence of Object.values(SMOKE_SEQUENCES)) {
    const results = {};
    for (const policy of Object.values(POLICIES)) {
      const result = runIncidents(sequence.incidents, policy);
      results[policy.id] = result;
      checkDelivered(result, sequence.expected[policy.id], `${sequence.id}.${policy.id}`);
    }
    const winner = winnerOf(results.concentrate.delivered, results.mentor.delivered);
    same(winner, sequence.expected.winner, `${sequence.id}.winner`);
    sequenceRows.push({
      id: sequence.id,
      concentrate: results.concentrate.delivered,
      mentor: results.mentor.delivered,
      winner,
      mentorLessons: results.mentor.lessons,
      mentorGrowthWork: results.mentor.apprenticeGrowthWork,
    });
  }
  console.log(JSON.stringify({ sequences: sequenceRows }, null, 2));

  if (!process.exitCode) console.log('smoke ok');
}

const args = process.argv.slice(2);
if (args.includes('--full') || args.includes('--compare')) {
  console.log('Phase 1: comparison results are out of scope. Run without flags for smoke.');
} else {
  runSmoke();
}

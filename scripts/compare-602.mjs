/**
 * Issue #602: 隔離実験。引数なしは smoke。`--full` で凍結値のまま 5 seed × 2 条件を書く。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COMPARISON_SEEDS,
  CONDITIONS,
  PARAMS,
  POLICIES,
  SMOKE_RI206,
  SMOKE_SEQUENCES,
} from '../src/rd/issue602/params.mjs';
import {
  compareAll,
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

function formatPeriods(periods) {
  return periods.length === 0 ? '-' : periods.join(',');
}

function winnerLabel(winner) {
  if (winner === 'mentor') return '育成';
  if (winner === 'concentrate') return '集中';
  return 'タイ';
}

function markdownTable(headers, rows) {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}

function writeFullResults(comparison) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = join(root, 'src/rd/issue602/results');
  mkdirSync(outDir, { recursive: true });

  const jsonPath = join(outDir, 'comparison.json');
  const mdPath = join(outDir, 'comparison.md');
  writeFileSync(jsonPath, `${JSON.stringify(comparison, null, 2)}\n`);

  const resultTable = markdownTable(
    [
      'seed',
      '条件',
      '集中 delivered',
      '育成 delivered',
      '勝者',
      '障害の期',
      '授業の期',
      '成長後の処理量',
    ],
    comparison.rows.map((row) => [
      row.seed,
      row.conditionId === 'stable' ? '安定' : '危機',
      String(row.concentrateDelivered),
      String(row.mentorDelivered),
      winnerLabel(row.winner),
      formatPeriods(row.incidentPeriods),
      formatPeriods(row.lessonPeriods),
      String(row.apprenticeGrowthWork),
    ]),
  );

  const { scores, verdict } = comparison;
  const scoreTable = markdownTable(
    ['条件', '勝ち数', '合格線', '判定'],
    [
      [
        '安定の育成',
        `${scores.stableMentorWins}/${scores.seedCount}`,
        `${scores.stableRequired}勝以上`,
        scores.stablePassed ? '到達' : '未達',
      ],
      [
        '危機の集中',
        `${scores.crisisConcentrateWins}/${scores.seedCount}`,
        `${scores.crisisRequired}勝以上`,
        scores.crisisPassed ? '到達' : '未達',
      ],
    ],
  );

  const markdown = [
    '# Issue #602 comparison',
    '',
    'Generated by `node scripts/compare-602.mjs --full`. 凍結値は Phase 1 のまま。',
    '',
    '## seed × 条件',
    '',
    resultTable,
    '',
    '## 合格線',
    '',
    scoreTable,
    '',
    `引き分けは勝ちに数えない（安定タイ ${scores.stableTies}、危機タイ ${scores.crisisTies}）。`,
    '',
    `機械的判定: **${verdict}**。安定の育成 ${scores.stableRequired} 勝以上かつ危機の集中 ${scores.crisisRequired} 勝以上なら Pass、それ以外は Kill。`,
    '',
  ].join('\n');
  writeFileSync(mdPath, markdown);
  return { jsonPath, mdPath, markdown };
}

function runFull() {
  same(PARAMS.stableIncidentRate, 0.25, 'frozen.stableIncidentRate');
  same(PARAMS.crisisIncidentRate, 0.5, 'frozen.crisisIncidentRate');
  same(PARAMS.crisisIncidentMultiplier, 2, 'frozen.crisisIncidentMultiplier');
  same(COMPARISON_SEEDS.join(','), 'RI-602-a,RI-602-b,RI-602-c,RI-602-d,RI-602-e', 'frozen.seeds');
  same(PARAMS.periods, 8, 'frozen.periods');
  same(PARAMS.mentorReview, 64, 'frozen.mentorReview');
  same(PARAMS.apprenticeReview, 32, 'frozen.apprenticeReview');
  same(PARAMS.demandPerPeriod, 12, 'frozen.demand');

  const comparison = compareAll();
  same(comparison.frozen.stableIncidentRate, 0.25, 'compare.frozen.stable');
  same(comparison.frozen.crisisIncidentRate, 0.5, 'compare.frozen.crisis');
  same(comparison.rows.length, 10, 'compare.rowCount');
  for (const row of comparison.rows) {
    same(
      row.incidents.join(','),
      incidentsFromDraws(row.draws, CONDITIONS[row.conditionId].incidentRate).join(','),
      `${row.seed}/${row.conditionId}.predrawn`,
    );
  }

  const paths = writeFullResults(comparison);
  console.log('issue602 comparison');
  console.log(paths.markdown);
  console.log(
    JSON.stringify(
      {
        wrote: { jsonPath: paths.jsonPath, mdPath: paths.mdPath },
        scores: comparison.scores,
        verdict: comparison.verdict,
      },
      null,
      2,
    ),
  );
  if (!process.exitCode) console.log('comparison ok');
}

const args = process.argv.slice(2);
if (args.includes('--full') || args.includes('--compare')) {
  runFull();
} else {
  runSmoke();
}

/**
 * Issue #660: 隔離実験。引数なしは smoke。`--full` で凍結値のまま全順序×3盤面を書く。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BOARD_ORDER_MATRIX,
  BOARDS,
  COPIED_FROM_732,
  DELTAS,
  PARAMS,
  REPRESENTATIVE_ORDERS,
  RESCUE_RULE,
  SMOKE_EXPECTED,
  UNATTENDED,
} from '../src/rd/issue660/params.mjs';
import {
  compareAll,
  enumerateOrders,
  layoutOf,
  representativeResult,
  sharedDrawsFor,
  summarizeComparison,
} from '../src/rd/issue660/sim.mjs';

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

function fingerprint(draws) {
  return draws.map((draw) => `${draw.incident ? 'I' : '-'}${draw.rework ? 'R' : '-'}`).join('');
}

function checkRow(actual, expected, prefix) {
  same(actual.rescued, expected.rescued, `${prefix}.rescued`);
  same(actual.delivered, expected.delivered, `${prefix}.delivered`);
  same(actual.spread, expected.spread, `${prefix}.spread`);
  same(actual.burning, expected.burning, `${prefix}.burning`);
  same(actual.seniorHp, expected.seniorHp, `${prefix}.seniorHp`);
}

function assertFrozen() {
  same(PARAMS.seniorHp, 60, 'frozen.seniorHp');
  same(PARAMS.limitTicks, 120, 'frozen.limitTicks');
  same(PARAMS.focusMax, 9, 'frozen.focusMax');
  same(PARAMS.maxSuccessfulInterventions, 3, 'frozen.maxInterventions');
  same(PARAMS.taskCount, 20, 'frozen.taskCount');
  same(PARAMS.seed, 'RI-264-review-crisis-1', 'frozen.seed');
  same(COPIED_FROM_732.recordedUnattended.delivered, 176, 'copied.unattended.delivered');
  same(UNATTENDED.baseline.delivered, 176, 'frozen.unattended.baseline.delivered');
  same(UNATTENDED['review-stall-x2'].delivered, 164, 'frozen.unattended.stall.delivered');
  same(UNATTENDED['inflow-x2'].delivered, 160, 'frozen.unattended.inflow.delivered');
  same(UNATTENDED.baseline.seniorHp, 7.6, 'frozen.unattended.baseline.hp');
  same(DELTAS.fireDelivered, 12, 'frozen.delta.fire');
  same(DELTAS.reviewDelivered, 16, 'frozen.delta.review');
  same(DELTAS.reviewDeliveredStall, 24, 'frozen.delta.reviewStall');
  same(DELTAS.andonThinDelivered, -8, 'frozen.delta.andonThin');
  same(DELTAS.andonCongestedDelivered, 8, 'frozen.delta.andonCongested');
  same(DELTAS.andonInflowRescueDelivered, 24, 'frozen.delta.inflowRescue');
  same(RESCUE_RULE.deliveredMin, 180, 'rescue.deliveredMin');
  same(RESCUE_RULE.spreadMax, 2, 'rescue.spreadMax');
  same(RESCUE_RULE.seniorHpMin, 10, 'rescue.seniorHpMin');
  same(RESCUE_RULE.burningMax, 0, 'rescue.burningMax');
}

function runSmoke() {
  console.log('issue660 smoke');
  console.log(
    JSON.stringify(
      {
        experimentId: PARAMS.experimentId,
        seed: PARAMS.seed,
        seniorHpStart: PARAMS.seniorHp,
        limitTicks: PARAMS.limitTicks,
        focusMax: PARAMS.focusMax,
        maxSuccessfulInterventions: PARAMS.maxSuccessfulInterventions,
        rescueRule: RESCUE_RULE,
        boards: Object.keys(BOARDS),
      },
      null,
      2,
    ),
  );

  assertFrozen();

  const baselineLayout = layoutOf('baseline');
  same(baselineLayout.reviewWaiting, 6, 'layout.baseline.review');
  same(baselineLayout.burning, 2, 'layout.baseline.burning');
  same(baselineLayout.backlog, 12, 'layout.baseline.backlog');
  same(baselineLayout.codingSlots, 6, 'layout.baseline.slots');

  const stallLayout = layoutOf('review-stall-x2');
  same(stallLayout.reviewWaiting, 12, 'layout.stall.review');
  same(stallLayout.burning, 2, 'layout.stall.burning');
  same(stallLayout.backlog, 6, 'layout.stall.backlog');

  const inflowLayout = layoutOf('inflow-x2');
  same(inflowLayout.reviewWaiting, 6, 'layout.inflow.review');
  same(inflowLayout.codingSlots, 12, 'layout.inflow.slots');
  same(inflowLayout.drawsFingerprint, baselineLayout.drawsFingerprint, 'shared.seed.draws');

  const bothSides = {};
  for (const boardId of Object.keys(BOARDS)) {
    const orderIds = BOARD_ORDER_MATRIX[boardId];
    const shared = fingerprint(sharedDrawsFor(boardId));
    const rows = [];
    let saved = 0;
    let failed = 0;
    for (const orderId of orderIds) {
      const result = representativeResult(boardId, orderId);
      if (result.drawsFingerprint !== shared) {
        fail(`${boardId}.${orderId}: draw sequence diverged from the shared board sequence`);
      }
      const expected = SMOKE_EXPECTED[boardId][orderId];
      checkRow(result, expected, `${boardId}.${orderId}`);
      rows.push({
        order: orderId,
        rescued: result.rescued,
        delivered: result.delivered,
        spread: result.spread,
        burning: result.burning,
        seniorHp: result.seniorHp,
        interventions: result.interventions,
        focusSpent: result.focusSpent,
      });
      if (result.rescued) saved += 1;
      else failed += 1;
    }
    bothSides[boardId] = {
      saved,
      failed,
      bothExist: saved > 0 && failed > 0,
      exclude: false,
      rows,
    };
    console.log(JSON.stringify({ boardId, ...bothSides[boardId] }, null, 2));
    if (!bothSides[boardId].bothExist) {
      fail(`${boardId}: 救える順序と救えない順序の両方が必要`);
    }
  }

  same(REPRESENTATIVE_ORDERS.unattended.length, 0, 'unattended.empty');

  if (!process.exitCode) console.log('smoke ok');
}

function boardLabel(boardId) {
  return BOARDS[boardId].label;
}

function metricCell(board) {
  return `${board.rescued ? '達成' : '未達'} ${board.delivered} / ${board.spread} / ${board.burning} / ${board.seniorHp}`;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Issue #660 Phase 2 比較結果');
  lines.push('');
  lines.push('凍結値は Phase 1 のまま。再現: `node scripts/compare-660.mjs --full`。');
  lines.push('');
  lines.push(
    `機械的判定: **${report.verdict}**。3 盤面すべてを救う順序が 1 つもなければ Pass、1 つ以上あれば Kill。`,
  );
  lines.push('');
  lines.push('## 盤面ごとの救えた数');
  lines.push('');
  lines.push('| 盤面 | 救えた順序 | 全順序 |');
  lines.push('| --- | ---: | ---: |');
  for (const boardId of Object.keys(BOARDS)) {
    const row = report.perBoard[boardId];
    lines.push(`| ${boardLabel(boardId)} | ${row.saved} | ${row.total} |`);
  }
  lines.push('');
  lines.push('## 停止10→レビュー20→鎮火40 は基準を救えるか');
  lines.push('');
  lines.push(
    report.spotlight.baselineRescued
      ? '**救える。** 基準は出荷 196 / 延焼 0 / 炎上 0 / 余力 10 で `rescued`。'
      : '**救えない。**',
  );
  lines.push('');
  lines.push('| 盤面 | 救済 | 出荷 | 延焼 | 炎上 | 余力 |');
  lines.push('| --- | --- | ---: | ---: | ---: | ---: |');
  for (const boardId of Object.keys(BOARDS)) {
    const board = report.spotlight.boards[boardId];
    lines.push(
      `| ${boardLabel(boardId)} | ${board.rescued ? '達成' : '未達'} | ${board.delivered} | ${board.spread} | ${board.burning} | ${board.seniorHp} |`,
    );
  }
  lines.push('');
  lines.push('## 3 盤面すべてを救う順序');
  lines.push('');
  lines.push(`${report.universalCount} 件。`);
  lines.push('');
  lines.push('| 順序 | 基準 | レビュー滞留×2 | 流入×2 |');
  lines.push('| --- | --- | --- | --- |');
  for (const order of report.universal) {
    lines.push(
      `| ${order.label} | ${metricCell(order.boards.baseline)} | ${metricCell(order.boards['review-stall-x2'])} | ${metricCell(order.boards['inflow-x2'])} |`,
    );
  }
  lines.push('');
  lines.push('## ちょうど 2 盤面を救う順序');
  lines.push('');
  lines.push('| 救う 2 盤面 | 未達の盤面 | 順序数 |');
  lines.push('| --- | --- | ---: |');
  for (const pair of report.pairs) {
    lines.push(
      `| ${boardLabel(pair.boards[0])} + ${boardLabel(pair.boards[1])} | ${boardLabel(pair.excluded)} | ${pair.count} |`,
    );
  }
  lines.push('');
  for (const pair of report.pairs) {
    lines.push(`### ${boardLabel(pair.boards[0])} + ${boardLabel(pair.boards[1])}`);
    lines.push('');
    if (pair.count === 0) {
      lines.push('なし。');
      lines.push('');
      continue;
    }
    lines.push('| 順序 | 基準 | レビュー滞留×2 | 流入×2 |');
    lines.push('| --- | --- | --- | --- |');
    for (const order of pair.orders) {
      lines.push(
        `| ${order.label} | ${metricCell(order.boards.baseline)} | ${metricCell(order.boards['review-stall-x2'])} | ${metricCell(order.boards['inflow-x2'])} |`,
      );
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function runFull() {
  assertFrozen();
  same(enumerateOrders().length, 376, 'full.orderCount');
  const comparison = compareAll();
  const report = summarizeComparison(comparison);
  same(report.orderCount, 376, 'report.orderCount');
  same(report.spotlight.id, 'A10-R20-F40', 'spotlight.id');
  same(report.spotlight.baselineRescued, true, 'spotlight.baselineRescued');
  same(report.verdict, report.universalCount === 0 ? 'Pass' : 'Kill', 'verdict.rule');

  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = join(root, 'src/rd/issue660/results');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'compare-660.json'),
    `${JSON.stringify({ report, comparison }, null, 2)}\n`,
  );
  writeFileSync(join(outDir, 'compare-660.md'), renderMarkdown(report));

  console.log(
    JSON.stringify(
      {
        verdict: report.verdict,
        orderCount: report.orderCount,
        perBoard: report.perBoard,
        universalCount: report.universalCount,
        spotlight: {
          label: report.spotlight.label,
          baselineRescued: report.spotlight.baselineRescued,
        },
        pairs: report.pairs.map((pair) => ({
          boards: pair.boards,
          count: pair.count,
        })),
        wrote: [
          'src/rd/issue660/results/compare-660.json',
          'src/rd/issue660/results/compare-660.md',
        ],
      },
      null,
      2,
    ),
  );
  if (!process.exitCode) console.log('full ok');
}

const args = process.argv.slice(2);
if (args.includes('--full') || args.includes('--compare')) {
  runFull();
} else {
  runSmoke();
}

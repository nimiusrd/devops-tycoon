/**
 * Issue #660: 隔離実験。Phase 1 は smoke のみ。全順序×全盤面の集計は書かない。
 */
import {
  BOARD_ORDER_MATRIX,
  BOARDS,
  COPIED_FROM_732,
  PARAMS,
  REPRESENTATIVE_ORDERS,
  RESCUE_RULE,
  SMOKE_EXPECTED,
} from '../src/rd/issue660/params.mjs';
import { layoutOf, representativeResult, sharedDrawsFor } from '../src/rd/issue660/sim.mjs';

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

  same(PARAMS.seniorHp, 60, 'frozen.seniorHp');
  same(PARAMS.limitTicks, 120, 'frozen.limitTicks');
  same(PARAMS.focusMax, 9, 'frozen.focusMax');
  same(PARAMS.maxSuccessfulInterventions, 3, 'frozen.maxInterventions');
  same(PARAMS.taskCount, 20, 'frozen.taskCount');
  same(COPIED_FROM_732.recordedUnattended.delivered, 176, 'copied.unattended.delivered');
  same(RESCUE_RULE.deliveredMin, 180, 'rescue.deliveredMin');

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

const args = process.argv.slice(2);
if (args.includes('--full') || args.includes('--compare')) {
  console.log('Phase 1: comparison results are out of scope. Run without flags for smoke.');
} else {
  runSmoke();
}

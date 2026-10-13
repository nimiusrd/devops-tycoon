#!/usr/bin/env node
/**
 * #573 Phase 1 comparison driver.
 * Default: seed × composition × FP rate × arm table + JSON.
 * --smoke: one trivial cell, shape check only.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  FROZEN,
  comparisonPayload,
  formatComparisonTable,
  runMatrix,
  runSmoke,
} from '../src/rd/issue573/reviewLane.mjs';

function parseArgs(argv) {
  const options = { smoke: false, jsonPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--smoke') {
      options.smoke = true;
      continue;
    }
    if (arg === '--json') {
      const path = argv[index + 1];
      if (!path || path.startsWith('--')) {
        throw new Error('--json には出力パスが必要です');
      }
      options.jsonPath = path;
      index += 1;
      continue;
    }
    throw new Error(`未知の引数: ${arg}`);
  }
  return options;
}

function assertSmokeShape(row) {
  const required = [
    'seed',
    'composition',
    'fpRate',
    'arm',
    'shippedCount',
    'medianReviewWaitTicks',
  ];
  for (const key of required) {
    if (!(key in row)) {
      throw new Error(`smoke: 欠けているキー ${key}`);
    }
  }
  if (typeof row.shippedCount !== 'number' || !Number.isFinite(row.shippedCount)) {
    throw new Error('smoke: shippedCount が有限数ではない');
  }
  const wait = row.medianReviewWaitTicks;
  if (wait !== null && (typeof wait !== 'number' || !Number.isFinite(wait))) {
    throw new Error('smoke: medianReviewWaitTicks が有限数または null ではない');
  }
}

function writeJson(path, payload) {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(payload, null, 2)}\n`);
  return absolute;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.smoke) {
    const row = runSmoke();
    assertSmokeShape(row);
    const payload = comparisonPayload([row]);
    if (options.jsonPath) writeJson(options.jsonPath, payload);
    console.log('smoke ok');
    console.log(
      `cells=1 seeds=${FROZEN.seeds.length} matrix=${FROZEN.seeds.length * FROZEN.compositions.length * 2 * FROZEN.arms.length}`,
    );
    return;
  }

  const rows = runMatrix();
  const payload = comparisonPayload(rows);
  console.log(formatComparisonTable(rows));
  console.log('');
  console.log(JSON.stringify(payload, null, 2));
  if (options.jsonPath) {
    const path = writeJson(options.jsonPath, payload);
    console.error(`wrote ${path}`);
  }
}

main();

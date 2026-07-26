/**
 * プレイテスト実行エントリ（`npm run playtest`）。
 *
 * `npm test`（`vitest.config.ts` の include）の対象外。専用 config で明示実行する。
 * 環境変数:
 * - `PT_DIFFS`   難易度（既定 `easy,normal,hard,nightmare`）
 * - `PT_POLICIES` 方針（既定は全方針。`tests/playtest/harness.ts` の `POLICY_DEFS`）
 * - `PT_SEEDS`   seed（既定 `pt-1`..`pt-10`）
 * - `PT_OUT`     出力先 JSON（既定 `playtest-out/runs.json`）
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { POLICY_DEFS, runMatrix } from './harness';

const DIFFS = (process.env.PT_DIFFS ?? 'easy,normal,hard,nightmare').split(',');
const POLICIES = (process.env.PT_POLICIES ?? Object.keys(POLICY_DEFS).join(',')).split(',');
const SEEDS = (
  process.env.PT_SEEDS ?? Array.from({ length: 10 }, (_, i) => `pt-${i + 1}`).join(',')
).split(',');
const OUT = process.env.PT_OUT ?? 'playtest-out/runs.json';

describe('playtest matrix', () => {
  it('難易度 × 方針 × seed を回して結果を書き出す', { timeout: 3_600_000 }, () => {
    const runs = runMatrix(DIFFS, POLICIES, SEEDS);
    expect(runs.length).toBe(DIFFS.length * POLICIES.length * SEEDS.length);
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(runs), 'utf8');
    console.log(`runs=${runs.length} -> ${OUT}`);
  });
});

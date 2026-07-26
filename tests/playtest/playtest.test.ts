/**
 * プレイテスト実行エントリ（`npm run playtest`）。
 *
 * `npm test`（`vitest.config.ts` の include）の対象外。専用 config で明示実行する。
 * 環境変数:
 * - `PT_DIFFS`   難易度（既定 `easy,normal,hard,nightmare`）
 * - `PT_POLICIES` 方針（既定は全方針。`tests/playtest/harness.ts` の `POLICY_DEFS`）
 * - `PT_SEEDS`   seed（既定 `pt-1`..`pt-10`）
 * - `PT_META`    メタ進行の解放状態（`fresh`=初見相当・既定 / `full`=全解放）
 * - `PT_OUT`     出力先 JSON（既定 `playtest-out/runs.json`）
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DIFFICULTY_DEFS } from '../../src/data/difficulties';
import { POLICY_DEFS, runMatrix, type MetaProfile } from './harness';

const VALID_DIFFS = new Set(Object.keys(DIFFICULTY_DEFS));
const VALID_META = new Set<MetaProfile>(['fresh', 'full']);

/** 未知の難易度は `getDifficulty` が normal へフォールバックし、別難易度として誤記録される。 */
function parseDiffs(raw: string): string[] {
  const list = raw.split(',').map((x) => x.trim());
  const unknown = list.filter((d) => !VALID_DIFFS.has(d));
  if (unknown.length > 0) {
    throw new Error(
      `PT_DIFFS に未知の難易度: ${unknown.join(', ')}（有効: ${[...VALID_DIFFS].join(', ')}）`,
    );
  }
  return list;
}

function parsePolicies(raw: string): string[] {
  const list = raw.split(',').map((x) => x.trim());
  const unknown = list.filter((p) => !POLICY_DEFS[p]);
  if (unknown.length > 0) {
    throw new Error(`PT_POLICIES に未知の方針: ${unknown.join(', ')}`);
  }
  return list;
}

function parseMeta(raw: string): MetaProfile {
  if (!VALID_META.has(raw as MetaProfile)) {
    throw new Error(`PT_META は fresh / full のいずれか（受領: ${raw}）`);
  }
  return raw as MetaProfile;
}

const DIFFS = parseDiffs(process.env.PT_DIFFS ?? 'easy,normal,hard,nightmare');
const POLICIES = parsePolicies(process.env.PT_POLICIES ?? Object.keys(POLICY_DEFS).join(','));
/** seed も trim する。空白付きの `pt-2 ` は別 seed 扱いになり再現・結合を壊す。 */
function parseSeeds(raw: string): string[] {
  const list = raw
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
  if (list.length === 0) throw new Error('PT_SEEDS が空');
  const dup = list.filter((x, i) => list.indexOf(x) !== i);
  if (dup.length > 0) throw new Error(`PT_SEEDS に重複: ${[...new Set(dup)].join(', ')}`);
  return list;
}

const SEEDS = parseSeeds(
  process.env.PT_SEEDS ?? Array.from({ length: 10 }, (_, i) => `pt-${i + 1}`).join(','),
);
const META = parseMeta(process.env.PT_META ?? 'fresh');
const OUT = process.env.PT_OUT ?? 'playtest-out/runs.json';

describe('playtest matrix', () => {
  it('難易度 × 方針 × seed を回して結果を書き出す', { timeout: 3_600_000 }, () => {
    const runs = runMatrix(DIFFS, POLICIES, SEEDS, META);
    expect(runs.length).toBe(DIFFS.length * POLICIES.length * SEEDS.length);

    // ガード上限や未対応フェーズで止まったランは status が playing のまま残る。
    // レポートはこれを「勝っていない＝敗北」として数えてしまうため、書き出す前に弾く。
    const stuck = runs.filter((r) => r.status !== 'won' && r.status !== 'lost');
    expect(
      stuck.map((r) => `${r.difficulty}/${r.policy}/${r.seed}=${r.status}`),
      '終端（won / lost）に到達しなかったランがある',
    ).toEqual([]);

    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(runs), 'utf8');
    console.log(`runs=${runs.length} meta=${META} -> ${OUT}`);
  });
});

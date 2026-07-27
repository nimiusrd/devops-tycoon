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

/**
 * 方針の重複は拒否する。件数だけを見て既定コホートを判定していたため、
 * 31件のうち1つを落として別の1つを重複させると `isDefault=true` が通り、
 * 落ちた方針は `playtest:check` の集計に現れないまま「一致」と表示されうる。
 */
function parsePolicies(raw: string): string[] {
  const list = raw
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
  if (list.length === 0) throw new Error('PT_POLICIES が空');
  const unknown = list.filter((p) => !POLICY_DEFS[p]);
  if (unknown.length > 0) {
    throw new Error(`PT_POLICIES に未知の方針: ${unknown.join(', ')}`);
  }
  const dup = list.filter((x, i) => list.indexOf(x) !== i);
  if (dup.length > 0) throw new Error(`PT_POLICIES に重複: ${[...new Set(dup)].join(', ')}`);
  return list;
}

function parseMeta(raw: string): MetaProfile {
  if (!VALID_META.has(raw as MetaProfile)) {
    throw new Error(`PT_META は fresh / full のいずれか（受領: ${raw}）`);
  }
  return raw as MetaProfile;
}

/**
 * 出力先。**旧出力の削除はここではやらない。**
 *
 * 静的 import はこのモジュール本体より先に評価されるので、ここへ置いても `harness.ts` の
 * 変換・初期化エラーには間に合わない。削除は `tests/playtest/globalSetup.ts`
 *（テストモジュールの読み込み前に走る）と `scripts/invalidate-playtest-out.mjs`
 *（npm スクリプトで型検査より前に走る）が担う。
 */
const OUT = process.env.PT_OUT ?? 'playtest-out/runs.json';

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

/** 既定コホート（所見ドキュメントが前提にしている条件）。 */
const DEFAULT_DIFFS = ['easy', 'normal', 'hard', 'nightmare'];
const DEFAULT_SEEDS = Array.from({ length: 10 }, (_, i) => `pt-${i + 1}`);

/** 2つの文字列リストが集合として一致するか（重複や欠落を件数で誤魔化させない）。 */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && sa.size === a.length && [...sa].every((x) => sb.has(x));
}

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
    // **どのコホートを回したかを一緒に書き出す。** 絞り込み実行（`PT_DIFFS=easy` など）の
    // 出力を、全難易度×全 seed を前提にした所見の数値と突き合わせると偽陽性が出る。
    // 読む側（`playtest:check`）が条件を確認できるようにしておく。
    const payload = {
      generatedAt: new Date().toISOString(),
      cohort: {
        difficulties: DIFFS,
        policies: POLICIES,
        seeds: SEEDS,
        meta: META,
        /**
         * 所見ドキュメントが前提にしている既定コホートか。
         *
         * **件数ではなく集合の一致で見る。** 件数だけだと、1方針を落として別の方針を
         * 重複指定した入力が既定として通ってしまう（`parsePolicies` でも重複を弾いているが、
         * 判定側でも取りこぼさないようにする）。
         */
        isDefault:
          sameSet(DIFFS, DEFAULT_DIFFS) &&
          sameSet(SEEDS, DEFAULT_SEEDS) &&
          sameSet(POLICIES, Object.keys(POLICY_DEFS)) &&
          META === 'fresh',
      },
      runs,
    };
    writeFileSync(OUT, JSON.stringify(payload), 'utf8');
    console.log(`runs=${runs.length} meta=${META} default=${payload.cohort.isDefault} -> ${OUT}`);
  });
});

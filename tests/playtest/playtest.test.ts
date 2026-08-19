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
 * - `PT_COUNTERFACTUAL=1`  危険域 last-non-empty の反実仮想評価を記録（RI-101。既定オフ）
 *
 * `PT_COUNTERFACTUAL=1` の既定コホートは数時間かかりうる（RI-132）。
 * 難易度ごとにチェックポイントし、同じ世代の `partial` 出力から再開する。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DIFFICULTY_DEFS } from '../../src/data/difficulties';
import { POLICY_DEFS, runOnce, type MetaProfile, type RunLog } from './harness';
import { currentGeneration } from '../../scripts/playtest-generation.mjs';
import { readPlaytestOut } from '../../scripts/playtest-out.mjs';

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
/** `PT_COUNTERFACTUAL=1` の既定コホートが数時間〜半日を超えるため。 */
const PLAYTEST_TIMEOUT_MS = 86_400_000;

/** 2つの文字列リストが集合として一致するか（重複や欠落を件数で誤魔化させない）。 */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && sa.size === a.length && [...sa].every((x) => sb.has(x));
}

function runKey(run: { difficulty: string; policy: string; seed: string; meta?: string }): string {
  return `${run.meta ?? 'fresh'}|${run.difficulty}|${run.policy}|${run.seed}`;
}

function isDefaultCohort(): boolean {
  return (
    sameSet(DIFFS, DEFAULT_DIFFS) &&
    sameSet(SEEDS, DEFAULT_SEEDS) &&
    sameSet(POLICIES, Object.keys(POLICY_DEFS)) &&
    META === 'fresh'
  );
}

function writePayload(runs: RunLog[], generation: string, partial: boolean): void {
  mkdirSync(dirname(OUT), { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    /**
     * 測定に使ったソースの世代（`src/` と `tests/playtest/` の内容ハッシュ）。
     *
     * 時刻とコホートだけでは、**測定に成功した後でコードを変えて再計測せずに
     * `playtest:report` / `playtest:check` だけを流す**経路を検出できない。
     * 旧出力の削除（`globalSetup`）は実行が落ちた場合しか守らないので別物である。
     */
    generation,
    partial: partial ? true : undefined,
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
      isDefault: isDefaultCohort(),
    },
    runs,
  };
  writeFileSync(OUT, JSON.stringify(payload), 'utf8');
}

function resumableRuns(generation: string): RunLog[] {
  const existing = readPlaytestOut(OUT) as {
    generation?: string;
    partial?: boolean;
    cohort?: {
      difficulties: string[];
      policies: string[];
      seeds: string[];
      meta: string;
    };
    runs?: RunLog[];
  } | null;
  if (!existing?.partial || existing.generation !== generation) return [];
  const cohort = existing.cohort;
  if (
    !cohort ||
    !sameSet(cohort.difficulties, DIFFS) ||
    !sameSet(cohort.policies, POLICIES) ||
    !sameSet(cohort.seeds, SEEDS) ||
    cohort.meta !== META
  ) {
    return [];
  }
  return Array.isArray(existing.runs) ? existing.runs : [];
}

describe('playtest matrix', () => {
  it('難易度 × 方針 × seed を回して結果を書き出す', { timeout: PLAYTEST_TIMEOUT_MS }, () => {
    // **実行前の世代を控える。** 下で書き出す世代を完了後にだけ計算すると、
    // 実行中に `src/` や `tests/playtest/` を編集した場合、ランは既に読み込まれた
    // 変更前のモジュールで進むのに、出力へは変更後の世代が付く。その出力は
    // `playtest:report` / `playtest:check` を世代一致として通ってしまう。
    const generationBefore = currentGeneration();
    const expected = DIFFS.length * POLICIES.length * SEEDS.length;
    const runs = [...resumableRuns(generationBefore)];
    const done = new Set(runs.map(runKey));
    if (runs.length > 0) {
      console.log(`resume ${runs.length}/${expected} from ${OUT}`);
    }

    for (const d of DIFFS) {
      let wrote = false;
      for (const p of POLICIES) {
        for (const seed of SEEDS) {
          const key = runKey({ difficulty: d, policy: p, seed, meta: META });
          if (done.has(key)) continue;
          runs.push(runOnce(seed, d, p, META));
          done.add(key);
          wrote = true;
        }
      }
      if (wrote) {
        expect(
          currentGeneration(),
          '実行中に src/ または tests/playtest/ が変更された。測定結果と世代が対応しないため書き出さない',
        ).toBe(generationBefore);
        writePayload(runs, generationBefore, runs.length < expected);
        console.log(`checkpoint ${runs.length}/${expected} (${d}) -> ${OUT}`);
      }
    }

    expect(runs.length).toBe(expected);

    // ガード上限や未対応フェーズで止まったランは status が playing のまま残る。
    // レポートはこれを「勝っていない＝敗北」として数えてしまうため、書き出す前に弾く。
    const stuck = runs.filter((r) => r.status !== 'won' && r.status !== 'lost');
    expect(
      stuck.map((r) => `${r.difficulty}/${r.policy}/${r.seed}=${r.status}`),
      '終端（won / lost）に到達しなかったランがある',
    ).toEqual([]);

    // 実行中にソースが変わっていたら、この測定はどちらの世代の結果とも言えない。書き出さない。
    expect(
      currentGeneration(),
      '実行中に src/ または tests/playtest/ が変更された。測定結果と世代が対応しないため書き出さない',
    ).toBe(generationBefore);

    writePayload(runs, generationBefore, false);
    console.log(`runs=${runs.length} meta=${META} default=${isDefaultCohort()} -> ${OUT}`);
  });
});

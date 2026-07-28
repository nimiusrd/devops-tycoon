/**
 * プレイテスト出力の「世代」を求める。
 *
 * 出力に時刻とコホートしか無いと、**測定に成功した後でゲームやハーネスを変えて
 * `playtest` を回し直さないまま `playtest:report` / `playtest:check` だけを実行する**経路で、
 * 旧コードの結果が現行の結果として受理される。旧出力の削除（`globalSetup`）は
 * 「実行が途中で落ちた」場合しか守らないので、この経路には効かない。
 *
 * とくにレポートは `src/ui/sprintTempo.ts` や `src/data/evolution.ts` の定数を
 * **実行時に読み直す**ため、旧ランと新定数を混ぜて集計してしまう。
 *
 * 結果に影響しうる入力（`src/` と `tests/playtest/`）の内容ハッシュを世代とし、
 * 書き出し時に記録して読み取り時に突き合わせる。
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 世代に含めるディレクトリ。
 *
 * - `src`: シミュレーション本体・データ定義・レポートが読む定数
 * - `tests/playtest`: 方針定義と自動プレイ手順（ここが変われば同じ seed でも結果が変わる）
 *
 * `scripts/` は入れない。レポートの集計方法を変えても**ランの結果自体は変わらない**ので、
 * 出力を無効化する必要が無い。入れると整形の修正だけで再計測を要求することになる。
 */
const ROOTS = ['src', 'tests/playtest'];

/** 拡張子で絞る（スナップショットや一時ファイルを世代へ混ぜない）。 */
const EXT = /\.(ts|tsx)$/;

function walk(dir, out) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXT.test(name)) out.push(p);
  }
  return out;
}

/**
 * 現在のソース世代（短縮ハッシュ）。
 *
 * パスと内容の両方を混ぜるので、ファイルの追加・削除・改名でも変わる。
 */
export function currentGeneration() {
  const h = createHash('sha256');
  for (const root of ROOTS) {
    for (const file of walk(root, [])) {
      h.update(file);
      h.update('\0');
      h.update(readFileSync(file));
      h.update('\0');
    }
  }
  return h.digest('hex').slice(0, 16);
}

/**
 * 読み取り側の共通チェック。世代が食い違っていれば理由つきの文字列を返す（一致なら null）。
 *
 * 世代を持たない旧出力は「確認できない」として警告に留める。拒否すると、
 * 手元に残った過去の出力を読む用途がすべて落ちるため。
 */
export function generationMismatch(loaded) {
  const recorded = Array.isArray(loaded) ? undefined : loaded.generation;
  if (!recorded) {
    return '出力に世代情報が無い（この measurement 以降のコード変更を検出できない）。`npm run playtest` で再生成すること。';
  }
  const now = currentGeneration();
  if (recorded === now) return null;
  return (
    `出力の世代（${recorded}）が現在のソース（${now}）と違う。` +
    '測定後に `src/` か `tests/playtest/` が変わっている。`npm run playtest` で再計測すること。'
  );
}

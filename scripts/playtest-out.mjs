/**
 * プレイテスト出力（`playtest-out/runs.json`）の無効化と部分再開。
 *
 * 完了済みの出力は毎回消す（旧測定を最新として集計させない）。
 * 同じ世代の `partial: true` だけ残し、長時間の `PT_COUNTERFACTUAL=1` 実行が
 * 中断しても難易度単位のチェックポイントから再開できるようにする。
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { currentGeneration } from './playtest-generation.mjs';

export function playtestOutPath() {
  return process.env.PT_OUT ?? 'playtest-out/runs.json';
}

export function readPlaytestOut(path = playtestOutPath()) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 同じソース世代の未完了チェックポイントなら残す。
 * 世代が違う・完了済み・壊れている出力は消す。
 */
export function invalidatePlaytestOut(path = playtestOutPath()) {
  const loaded = readPlaytestOut(path);
  if (
    loaded &&
    loaded.partial === true &&
    typeof loaded.generation === 'string' &&
    loaded.generation === currentGeneration()
  ) {
    return 'keep-partial';
  }
  rmSync(path, { force: true });
  return 'deleted';
}

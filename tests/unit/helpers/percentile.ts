/**
 * 分位統計ヘルパ（RI-66 ペーシング検証など）。
 *
 * 配列をコピーして昇順ソートし、nearest-rank（`ceil(n * p)` 番目、0 始まりでは `ceil(n * p) - 1`）で分位を取る。
 * 空配列は 0 を返す。
 */

/** 昇順ソート済みコピーを返す。 */
export function sortedCopy(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

/**
 * 分位（0〜1）を nearest-rank で求める。
 * 例: length=10, p=0.5 → 5 番目（index 4）、p=0.9 → 9 番目（index 8）。
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = sortedCopy(values);
  const rank = Math.ceil(sorted.length * p);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[idx]!;
}

/** 中央値（p50）。 */
export function p50(values: readonly number[]): number {
  return percentile(values, 0.5);
}

/** 90 パーセンタイル。 */
export function p90(values: readonly number[]): number {
  return percentile(values, 0.9);
}

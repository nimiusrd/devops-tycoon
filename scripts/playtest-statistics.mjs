/**
 * プレイテストで共有する基本統計。
 *
 * `playtest-report` と多数seed差分レポートで同じ分位点定義を使うため、
 * レポート固有の合否判定はここへ置かない。
 */

/** 既存プレイテストレポートと同じ分位点位置（nearest rank 相当）。 */
export function quantile(values, probability) {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => {
    if (left === right) return 0;
    if (!Number.isFinite(left)) return 1;
    if (!Number.isFinite(right)) return -1;
    return left - right;
  });
  return sorted[Math.round((sorted.length - 1) * probability)];
}

/** 空配列の平均は0とする（既存レポートの表示契約）。 */
export function mean(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** 分布レポートで使う数値の共通要約。空標本の値はJSONでnullにする。 */
export function summarizeNumeric(values) {
  if (values.length === 0) {
    return { n: 0, mean: null, p10: null, p50: null, p90: null };
  }
  return {
    n: values.length,
    mean: mean(values),
    p10: quantile(values, 0.1),
    p50: quantile(values, 0.5),
    p90: quantile(values, 0.9),
  };
}

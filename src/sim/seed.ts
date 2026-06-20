/**
 * seed の一元管理（SPEC 第22.3）。
 *
 * `?seed=` クエリパラメータからの解決を純関数として実装し、
 * テストから検証できるようにする。ブラウザ依存の読み取りは
 * `resolveSeedFromLocation` に閉じ込める。
 */

/** seed 未指定時の既定値。 */
export const DEFAULT_SEED = 'devops-tycoon';

/**
 * クエリ文字列（例: "?seed=abc"）から seed を解決する。純関数。
 * seed が無い／空の場合は fallback を返す。
 */
export function resolveSeed(search: string, fallback: string = DEFAULT_SEED): string {
  const params = new URLSearchParams(search);
  const seed = params.get('seed');
  return seed && seed.length > 0 ? seed : fallback;
}

/**
 * 現在のブラウザ URL（`window.location.search`）から seed を解決する。
 * 非ブラウザ環境では fallback を返す。
 */
export function resolveSeedFromLocation(fallback: string = DEFAULT_SEED): string {
  if (typeof window === 'undefined') {
    return fallback;
  }
  return resolveSeed(window.location.search, fallback);
}

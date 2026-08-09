/**
 * 数値を範囲内へ収めるヘルパー。
 *
 * sim 配下13ファイルに同一実装のローカルコピーが散らばっていたため集約した。
 * `src/sim/**` は Stryker のミューテーション対象なので、コピーが増えるほど
 * 同じミューテントを別々に kill する必要が生じる。正本はここ1箇所に保つこと。
 */
export const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

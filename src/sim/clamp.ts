/**
 * 数値を範囲内へ収めるヘルパー。
 *
 * sim 配下13ファイルに同一実装のローカルコピーが散らばっていたため集約した。
 * 正本はここ1箇所に保つこと。
 */
export const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

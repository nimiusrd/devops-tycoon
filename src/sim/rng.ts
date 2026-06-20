/**
 * seed付き決定論PRNG（mulberry32）。
 *
 * SPEC 第22.3 に基づき、シミュレーションの乱数はこの実装に一本化する。
 * 同一 seed からは常に同一の数列が得られる（決定論）ため、
 * デイリーラン・リプレイ・不具合再現・テストが成立する。
 */

/** [0, 1) の擬似乱数を返す関数。 */
export type Rng = () => number;

/**
 * mulberry32: 32bit seed から [0, 1) の擬似乱数列を生成する。
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * seed（文字列または数値）を 32bit 符号なし整数へ変換する。
 * 文字列は FNV-1a でハッシュし、数値はそのまま 32bit へ丸める。
 */
export function hashSeed(seed: string | number): number {
  if (typeof seed === 'number') {
    return seed >>> 0;
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * seed（文字列または数値）から PRNG を生成する。
 */
export function createRng(seed: string | number): Rng {
  return mulberry32(hashSeed(seed));
}

/** [min, max) の浮動小数を返す。 */
export function randRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** [min, max]（両端含む）の整数を返す。 */
export function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(randRange(rng, min, max + 1));
}

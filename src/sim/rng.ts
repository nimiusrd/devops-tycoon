/**
 * seed付き決定論PRNG（mulberry32）。
 *
 * SPEC 第22.3 に基づき、シミュレーションの乱数はこの実装に一本化する。
 * 同一 seed からは常に同一の数列が得られる（決定論）ため、
 * デイリーラン・リプレイ・不具合再現・テストが成立する。
 */

/** [0, 1) の擬似乱数を返す関数。 */
export type Rng = () => number;

const RNG_STATE = Symbol('rngState');

type StatefulRng = Rng & {
  [RNG_STATE]: () => number;
};

/**
 * mulberry32: 32bit seed から [0, 1) の擬似乱数列を生成する。
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  (next as StatefulRng)[RNG_STATE] = () => a >>> 0;
  return next;
}

/** 消費位置を含む内部状態。`createRngFromState` で同じ続きを復元する。 */
export function getRngState(rng: Rng): number {
  const getter = (rng as StatefulRng)[RNG_STATE];
  if (typeof getter !== 'function') {
    throw new Error('rng is not a stateful mulberry32 instance');
  }
  return getter();
}

/**
 * 保存した内部状態から PRNG を復元する。
 * 次の `rng()` は、状態取得時点の元 PRNG と同じ値を返す。
 */
export function createRngFromState(state: number): Rng {
  return mulberry32(state);
}

/** 消費位置を共有する独立した PRNG を返す。 */
export function cloneRng(rng: Rng): Rng {
  return createRngFromState(getRngState(rng));
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

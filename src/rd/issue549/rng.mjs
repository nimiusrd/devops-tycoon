/**
 * ライブ `src/sim/rng.ts` の FNV-1a + mulberry32 を複製しただけ。import しない。
 * 手戻り抽選用の小さな決定論ストリーム。
 */

export function hashSeed(seed) {
  if (typeof seed === 'number') return seed >>> 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed) {
  let a = hashSeed(seed) >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

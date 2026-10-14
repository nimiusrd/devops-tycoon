/**
 * Issue #660 隔離 PRNG。
 * `src/sim/rng.ts` の FNV-1a + mulberry32 を複製しただけ。ライブ import しない。
 */

const RNG_STATE = Symbol('rngState');

export function mulberry32(seed) {
  let a = seed >>> 0;
  const next = function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next[RNG_STATE] = () => a >>> 0;
  return next;
}

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
  return mulberry32(hashSeed(seed));
}

export function getRngState(rng) {
  return rng[RNG_STATE]();
}

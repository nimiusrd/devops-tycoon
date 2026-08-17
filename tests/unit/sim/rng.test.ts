import { describe, expect, it } from 'vitest';
import {
  cloneRng,
  createRng,
  createRngFromState,
  getRngState,
  hashSeed,
  mulberry32,
  randInt,
  randRange,
} from '../../../src/sim/rng';

describe('mulberry32', () => {
  it('同一 seed からは同一の数列を返す（決定論）', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 16 }, () => a());
    const seqB = Array.from({ length: 16 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('異なる seed では異なる数列になる', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 16 }, () => a());
    const seqB = Array.from({ length: 16 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('返す値は [0, 1) の範囲に収まる', () => {
    const r = mulberry32(99);
    for (let i = 0; i < 1000; i += 1) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('hashSeed', () => {
  it('同一文字列からは同一ハッシュを返す', () => {
    expect(hashSeed('devops')).toBe(hashSeed('devops'));
  });

  it('数値 seed は 32bit 符号なし整数へ丸める', () => {
    expect(hashSeed(42)).toBe(42);
  });

  it('文字列 seed 経由でも決定論が保たれる', () => {
    const a = createRng('daily-2026-06-20');
    const b = createRng('daily-2026-06-20');
    expect(Array.from({ length: 8 }, () => a())).toEqual(Array.from({ length: 8 }, () => b()));
  });
});

describe('getRngState / createRngFromState / cloneRng', () => {
  it('消費後の状態から復元すると次の値が元と同じになる', () => {
    const source = mulberry32(12345);
    source();
    source();
    const restored = createRngFromState(getRngState(source));
    const expected = Array.from({ length: 8 }, () => source());
    expect(Array.from({ length: 8 }, () => restored())).toEqual(expected);
  });

  it('cloneRng は元と独立に同じ続きを返す', () => {
    const source = createRng('ri-101-rng');
    source();
    const cloned = cloneRng(source);
    const fromClone = [cloned(), cloned(), cloned()];
    source();
    source();
    source();
    source();
    source();
    const control = createRng('ri-101-rng');
    control();
    expect(fromClone).toEqual([control(), control(), control()]);
    expect([cloned(), cloned()]).toEqual([control(), control()]);
  });

  it('未消費の状態復元は同じ seed の新規 PRNG と一致する', () => {
    const fresh = mulberry32(99);
    const restored = createRngFromState(getRngState(mulberry32(99)));
    expect(Array.from({ length: 8 }, () => restored())).toEqual(
      Array.from({ length: 8 }, () => fresh()),
    );
  });

  it('状態を持たない関数は getRngState を拒否する', () => {
    expect(() => getRngState(() => 0.5)).toThrow('stateful mulberry32');
  });
});

describe('randRange / randInt', () => {
  it('randRange は [min, max) を返す', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i += 1) {
      const v = randRange(r, -2, 5);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThan(5);
    }
  });

  it('randInt は [min, max]（両端含む）の整数を返す', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i += 1) {
      const v = randInt(r, 3, 6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(6);
    }
  });
});

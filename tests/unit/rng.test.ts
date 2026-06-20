import { describe, expect, it } from 'vitest';
import { createRng, hashSeed, mulberry32, randInt, randRange } from '../../src/sim/rng';

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

import { describe, expect, it } from 'vitest';
import { createRng, normalizeSeed } from '../../src/sim/rng';

describe('createRng', () => {
  it('同一 seed で同一の乱数列を返す', () => {
    const first = createRng('same-seed');
    const second = createRng('same-seed');

    const firstSequence = Array.from({ length: 8 }, () => first.next());
    const secondSequence = Array.from({ length: 8 }, () => second.next());

    expect(firstSequence).toEqual(secondSequence);
  });

  it('異なる seed では異なる乱数列になりやすい', () => {
    const first = createRng('seed-a');
    const second = createRng('seed-b');

    const firstSequence = Array.from({ length: 8 }, () => first.next());
    const secondSequence = Array.from({ length: 8 }, () => second.next());

    expect(firstSequence).not.toEqual(secondSequence);
  });

  it('next は 0 以上 1 未満の値を返す', () => {
    const rng = createRng('range-check');

    for (let index = 0; index < 100; index += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('int は指定した整数範囲内の値を返す', () => {
    const rng = createRng('int-check');

    for (let index = 0; index < 100; index += 1) {
      const value = rng.int(2, 5);
      expect(value).toBeGreaterThanOrEqual(2);
      expect(value).toBeLessThanOrEqual(5);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('pick は空配列を明示的に拒否する', () => {
    const rng = createRng('pick-empty');

    expect(() => rng.pick([])).toThrow('empty collection');
  });

  it('文字列 seed を安定した unsigned 32bit 値に正規化する', () => {
    expect(normalizeSeed('stable')).toBe(normalizeSeed('stable'));
    expect(normalizeSeed('stable')).toBeGreaterThanOrEqual(0);
    expect(normalizeSeed('stable')).toBeLessThanOrEqual(0xffffffff);
  });
});

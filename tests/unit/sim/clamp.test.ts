import { describe, expect, it } from 'vitest';
import { clamp } from '../../../src/sim/clamp';

describe('clamp', () => {
  it('範囲内はそのまま返す', () => {
    expect(clamp(50, 0, 100)).toBe(50);
    expect(clamp(-5, -10, 10)).toBe(-5);
  });

  it('下限未満は下限へ、上限超過は上限へ収める', () => {
    expect(clamp(-1, 0, 100)).toBe(0);
    expect(clamp(101, 0, 100)).toBe(100);
  });

  it('境界値はそのまま返す', () => {
    expect(clamp(0, 0, 100)).toBe(0);
    expect(clamp(100, 0, 100)).toBe(100);
  });

  it('min と max が同値なら常にその値になる', () => {
    expect(clamp(7, 3, 3)).toBe(3);
    expect(clamp(-7, 3, 3)).toBe(3);
  });

  it('小数を丸めない', () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
});

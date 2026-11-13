import { describe, expect, it } from 'vitest';
import { pointPopMaxRise, reducedPointPopCapacity } from '../../../src/render/pointPopLayout';
import { VISUAL_TOKENS } from '../../../src/render/visualTokens';

describe('静止した得点ポップの可視段数', () => {
  it.each([
    [119.2, 2],
    [151.9, 3],
    [389.4, 6],
    [0, 0],
  ])('盤面高さ %f px は %i 段に制限する', (height, expected) => {
    const topInset = 36;
    expect(reducedPointPopCapacity(height, topInset)).toBe(expected);
    const { bottomRatio, reducedLineHeight, rowGap } = VISUAL_TOKENS.dimensions.pointPops;
    if (expected > 0) {
      expect(
        height * (1 - bottomRatio) - (expected - 1) * rowGap - reducedLineHeight,
      ).toBeGreaterThanOrEqual(topInset);
    }
  });
});

describe('通常モーション得点ポップの上昇量', () => {
  it('工程要約の下に収まるよう上昇量を抑える', () => {
    const rise = pointPopMaxRise(200, 48);
    expect(rise).toBeGreaterThan(0);
    expect(Math.min(42, rise)).toBe(42);
    expect(pointPopMaxRise(120, 80)).toBe(0);
  });
});

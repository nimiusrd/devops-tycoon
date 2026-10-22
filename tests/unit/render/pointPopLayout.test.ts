import { describe, expect, it } from 'vitest';
import { reducedPointPopCapacity } from '../../../src/render/pointPopLayout';
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

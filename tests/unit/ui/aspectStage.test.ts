import { describe, expect, it } from 'vitest';
import { calculateAspectStageSize } from '../../../src/ui/aspectStageLayout';

const BOARD_RATIO = 1404 / 573;

describe('calculateAspectStageSize', () => {
  it('幅が制約されるスロットでは比率を維持して幅を使い切る', () => {
    const size = calculateAspectStageSize(800, 900, BOARD_RATIO);

    expect(size.width).toBe(800);
    expect(size.height).toBeCloseTo(573 * (800 / 1404), 8);
    expect(size.width / size.height).toBeCloseTo(BOARD_RATIO, 8);
  });

  it('高さが制約されるスロットでは比率を維持して高さを使い切る', () => {
    const size = calculateAspectStageSize(1400, 300, BOARD_RATIO);

    expect(size.height).toBe(300);
    expect(size.width).toBeCloseTo(300 * BOARD_RATIO, 8);
    expect(size.width / size.height).toBeCloseTo(BOARD_RATIO, 8);
  });

  it.each([
    [0, 300, BOARD_RATIO],
    [300, 0, BOARD_RATIO],
    [-1, 300, BOARD_RATIO],
    [300, 300, 0],
    [300, 300, Number.NaN],
    [Number.POSITIVE_INFINITY, 300, BOARD_RATIO],
  ])('ゼロ・不正な入力は0×0を返す（%s, %s, %s）', (width, height, ratio) => {
    expect(calculateAspectStageSize(width, height, ratio)).toEqual({ width: 0, height: 0 });
  });
});

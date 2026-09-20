import { describe, expect, it } from 'vitest';
import { RESPONSIVE_BREAKPOINTS, resolveResponsiveMode } from '../../../src/ui/responsiveMode';

describe('resolveResponsiveMode', () => {
  it.each([
    [860, 'narrow'],
    [861, 'narrow'],
    [900, 'narrow'],
    [901, 'wide'],
  ] as const)('幅%spxを%sとして判定する', (width, expected) => {
    expect(resolveResponsiveMode(width, RESPONSIVE_BREAKPOINTS.shortMaxHeight + 1).width).toBe(
      expected,
    );
  });

  it.each([
    [720, 'short'],
    [721, 'normal'],
  ] as const)('高さ%spxを%sとして判定する', (height, expected) => {
    expect(resolveResponsiveMode(RESPONSIVE_BREAKPOINTS.narrowMaxWidth + 1, height).height).toBe(
      expected,
    );
  });

  it('幅と高さのモードを独立して組み合わせる', () => {
    expect(resolveResponsiveMode(900, 720)).toEqual({ width: 'narrow', height: 'short' });
    expect(resolveResponsiveMode(901, 720)).toEqual({ width: 'wide', height: 'short' });
    expect(resolveResponsiveMode(900, 721)).toEqual({ width: 'narrow', height: 'normal' });
  });

  it('タイトル縦積み境界は幅モードと別の局所値である', () => {
    expect(RESPONSIVE_BREAKPOINTS.stackMaxWidth).toBe(560);
    expect(RESPONSIVE_BREAKPOINTS.stackMaxWidth).toBeLessThan(
      RESPONSIVE_BREAKPOINTS.narrowMaxWidth,
    );
  });
});

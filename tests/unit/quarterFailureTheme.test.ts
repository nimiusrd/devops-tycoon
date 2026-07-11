import { describe, expect, it } from 'vitest';
import { quarterFailureTheme } from '../../src/render/quarterFailureTheme';
import type { QuarterOutcome } from '../../src/sim/run/types';

const TERMINAL_OUTCOMES: QuarterOutcome[] = ['missed_crisis', 'reorg_required', 'shutdown'];
const NON_TERMINAL_OUTCOMES: QuarterOutcome[] = ['exceeded', 'met', 'missed_adjustable'];

describe('継続不能種別ごとの終了演出（RI-22）', () => {
  it.each(TERMINAL_OUTCOMES)('%s に固有の終了演出がある', (outcome) => {
    const theme = quarterFailureTheme(outcome);

    expect(theme).not.toBeNull();
    expect(theme?.toneClass).toMatch(/^quarter-failure-/);
    expect(theme?.icon).not.toHaveLength(0);
    expect(theme?.eyebrow).not.toHaveLength(0);
    expect(theme?.label).not.toHaveLength(0);
    expect(theme?.description).not.toHaveLength(0);
  });

  it('3種をそれぞれ異なる終了トーンへ割り当てる', () => {
    const toneClasses = TERMINAL_OUTCOMES.map((outcome) => quarterFailureTheme(outcome)?.toneClass);

    expect(new Set(toneClasses).size).toBe(TERMINAL_OUTCOMES.length);
  });

  it.each(NON_TERMINAL_OUTCOMES)('%s は終了演出を持たない', (outcome) => {
    expect(quarterFailureTheme(outcome)).toBeNull();
  });
});

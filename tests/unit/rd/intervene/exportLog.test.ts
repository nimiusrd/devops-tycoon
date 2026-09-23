import { describe, expect, it } from 'vitest';
import { exportJson, exportTsv } from '../../../../src/rd/intervene/exportLog';
import { createInitialState, runRemaining } from '../../../../src/rd/intervene/sim';

describe('rd/intervene export', () => {
  it('JSON に H1–H4 用の期間指標と公式を出す', () => {
    const state = runRemaining(createInitialState('crisis', 'situation'));
    const parsed = JSON.parse(exportJson(state)) as {
      experiment: string;
      notForProduction: boolean;
      periods: Array<{
        outputSum: number;
        fatigueSum: number;
        crisisSum: number;
        nextCapabilitySum: number;
        companyScore: number;
        judgmentCount: number;
      }>;
      totals: { companyScoreSum: number; judgmentCount: number };
      formulas: { companyScore: string };
    };
    expect(parsed.experiment).toBe('rd-intervene');
    expect(parsed.notForProduction).toBe(true);
    expect(parsed.periods).toHaveLength(4);
    expect(parsed.periods[0]).toEqual(
      expect.objectContaining({
        outputSum: expect.any(Number),
        fatigueSum: expect.any(Number),
        crisisSum: expect.any(Number),
        nextCapabilitySum: expect.any(Number),
        companyScore: expect.any(Number),
        judgmentCount: expect.any(Number),
      }),
    );
    expect(parsed.formulas.companyScore).toContain('sum(output)');
    expect(parsed.totals.judgmentCount).toBe(state.judgmentCount);
  });

  it('TSV は期間×チームと会社合計行を持つ', () => {
    const state = runRemaining(createInitialState('stable', 'full-delegate'));
    const lines = exportTsv(state).trim().split('\n');
    expect(lines[0]).toContain('output');
    expect(lines[0]).toContain('fatigue');
    expect(lines[0]).toContain('crisis');
    expect(lines[0]).toContain('nextCapability');
    expect(lines[0]).toContain('companyScore');
    expect(lines[0]).toContain('judgmentCount');
    expect(lines).toHaveLength(1 + 4 * 3 + 1);
    expect(lines.at(-1)).toContain('company');
  });
});

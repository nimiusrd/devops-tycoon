import { describe, expect, it } from 'vitest';
import {
  displayedQuarterSprintIndex,
  nextSprintIndexInQuarter,
} from '../../../src/render/sprintProgressView';

describe('sprintProgressView', () => {
  it('次スプリント番号は未開始を 1、最終枠で打ち止める', () => {
    expect(nextSprintIndexInQuarter(0, 6)).toBe(1);
    expect(nextSprintIndexInQuarter(1, 6)).toBe(2);
    expect(nextSprintIndexInQuarter(5, 6)).toBe(6);
    expect(nextSprintIndexInQuarter(6, 6)).toBe(6);
  });

  it('ドラフトでは次スプリント、スプリント中は進行中の番号を出す', () => {
    expect(
      displayedQuarterSprintIndex({
        phase: 'draft',
        sprintIndexInQuarter: 1,
        sprintsPerQuarter: 6,
      }),
    ).toBe(2);
    expect(
      displayedQuarterSprintIndex({
        phase: 'sprint',
        sprintIndexInQuarter: 1,
        sprintsPerQuarter: 6,
      }),
    ).toBe(1);
  });

  it('第2四半期のドラフトでも HUD と同じ四半期内番号になり、通算完了数とは揃えない', () => {
    const sprintsPlayed = 7;
    const state = {
      phase: 'draft' as const,
      sprintIndexInQuarter: 1,
      sprintsPerQuarter: 6,
    };
    expect(displayedQuarterSprintIndex(state)).toBe(2);
    expect(sprintsPlayed + 1).toBe(8);
    expect(displayedQuarterSprintIndex(state)).not.toBe(sprintsPlayed + 1);
  });

  it('setup の HUD は従来どおり直近開始番号のまま（#385 の範囲外）', () => {
    expect(
      displayedQuarterSprintIndex({
        phase: 'setup',
        sprintIndexInQuarter: 1,
        sprintsPerQuarter: 6,
      }),
    ).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { SPRINT_BALANCE } from '../../../src/data/balance';
import { evaluateSprintGrade } from '../../../src/sim/sprintGrade';

describe('スプリント評価 S の炎上ゲート (#476)', () => {
  it('健全比が S 境界以上でも炎上があれば A にする', () => {
    const score = evaluateSprintGrade({
      delivered: 895,
      reworkCount: 2,
      incidentCount: 1,
      spread: 0,
      hpLoss: 36.52,
      stabilizingGrants: 0,
    });

    expect(score.ratio).toBeGreaterThanOrEqual(SPRINT_BALANCE.gradeThresholdS.value);
    expect(score.grade).toBe('A');
  });

  it('健全比が S 境界以上でも延焼があれば A にする', () => {
    const score = evaluateSprintGrade({
      delivered: 900,
      reworkCount: 0,
      incidentCount: 0,
      spread: 1,
      hpLoss: 0,
      stabilizingGrants: 0,
    });

    expect(score.ratio).toBeGreaterThanOrEqual(SPRINT_BALANCE.gradeThresholdS.value);
    expect(score.grade).toBe('A');
  });

  it('炎上も延焼もなければ健全比だけで S を付ける', () => {
    const score = evaluateSprintGrade({
      delivered: 895,
      reworkCount: 0,
      incidentCount: 0,
      spread: 0,
      hpLoss: 10,
      stabilizingGrants: 0,
    });

    expect(score.ratio).toBeGreaterThanOrEqual(SPRINT_BALANCE.gradeThresholdS.value);
    expect(score.grade).toBe('S');
  });
});

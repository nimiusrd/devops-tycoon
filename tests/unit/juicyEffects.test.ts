import { describe, expect, it } from 'vitest';
import { isSpecialGrade, planBossSlowMotion } from '../../src/render/juicyEffects';
import type { SprintResult, Task } from '../../src/sim/types';

const task = (id: number, incident: boolean): Task => ({
  id,
  kind: 'normal',
  highValue: false,
  aiAssisted: false,
  lane: incident ? 'rework' : 'done',
  progress: 0,
  reworkAttempts: 0,
  wasReworked: incident,
  incident,
  debt: false,
});

describe('juicyEffects（RI-10）', () => {
  it('ボスの最後の Incident が消えたときだけスローモーを計画する', () => {
    expect(planBossSlowMotion(true, [task(1, true)], [task(1, false)])).toEqual({
      active: true,
      clearedIncidentCount: 1,
    });
    expect(planBossSlowMotion(false, [task(1, true)], [task(1, false)]).active).toBe(false);
    expect(
      planBossSlowMotion(true, [task(1, true), task(2, true)], [task(1, false), task(2, true)])
        .active,
    ).toBe(false);
  });

  it('評価 S だけを特別グレードとして扱う', () => {
    expect(isSpecialGrade('S' as SprintResult['grade'])).toBe(true);
    expect(isSpecialGrade('A' as SprintResult['grade'])).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  FAILURE_DIAGNOSIS_TYPES,
  FAILURE_ENCYCLOPEDIA_DEFS,
  diagnosisView,
  isFailureDiagnosis,
} from '../../../src/sim/diagnosis';
import type { DiagnosisType } from '../../../src/sim/run/types';

const ALL_TYPES: DiagnosisType[] = [
  'healthyAcceleration',
  'reviewHell',
  'aiOverproduction',
  'reworkSpiral',
  'seniorSacrifice',
  'documentationKingdom',
];

describe('AI導入失敗図鑑（RI-34″）', () => {
  it('失敗 4 種だけを図鑑対象にする', () => {
    expect(FAILURE_DIAGNOSIS_TYPES).toEqual([
      'reviewHell',
      'aiOverproduction',
      'reworkSpiral',
      'seniorSacrifice',
    ]);
    expect(FAILURE_ENCYCLOPEDIA_DEFS).toHaveLength(4);
    for (const type of ALL_TYPES) {
      expect(isFailureDiagnosis(type)).toBe(
        (FAILURE_DIAGNOSIS_TYPES as readonly DiagnosisType[]).includes(type),
      );
    }
  });

  it('図鑑エントリは診断表示と教訓・ヒントを持つ', () => {
    for (const def of FAILURE_ENCYCLOPEDIA_DEFS) {
      const view = diagnosisView(def.type);
      expect(def.label).toBe(view.label);
      expect(def.description).toBe(view.description);
      expect(def.lesson.length).toBeGreaterThan(0);
      expect(def.hint.length).toBeGreaterThan(0);
    }
  });
});

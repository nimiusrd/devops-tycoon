import { describe, expect, it } from 'vitest';
import { OUTCOME_BALANCE } from '../../../src/data/balance';
import {
  FAILURE_DIAGNOSIS_TYPES,
  FAILURE_ENCYCLOPEDIA_DEFS,
  diagnosisView,
  diagnose,
  isFailureDiagnosis,
} from '../../../src/sim/diagnosis';
import type { DiagnosisType } from '../../../src/sim/run/types';
import { org, totals } from '../helpers/orgFixtures';

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

  it('診断の主要境界は安定値の直前・境界値で分類が切り替わる', () => {
    expect(
      diagnose(
        org({ seniorHp: OUTCOME_BALANCE.diagnosisSeniorHpMax.value - 1 }),
        totals({ reviewQueuePeak: OUTCOME_BALANCE.diagnosisReviewQueueMin.value }),
      ),
    ).toBe('seniorSacrifice');
    expect(
      diagnose(
        org({ seniorHp: OUTCOME_BALANCE.diagnosisSeniorHpMax.value }),
        totals({ reviewQueuePeak: OUTCOME_BALANCE.diagnosisReviewQueueMin.value }),
      ),
    ).toBe('healthyAcceleration');

    expect(
      diagnose(
        org(),
        totals({
          done: 10,
          rework: OUTCOME_BALANCE.diagnosisReworkSpiralReworkRatioMin.value * 10,
        }),
      ),
    ).toBe('reworkSpiral');
    expect(
      diagnose(
        org(),
        totals({
          completed: 2,
          aiAssisted: 1,
          reviewQueuePeak: OUTCOME_BALANCE.diagnosisReviewQueueMin.value,
        }),
      ),
    ).toBe('aiOverproduction');

    expect(
      diagnose(
        org({ testCoverage: OUTCOME_BALANCE.diagnosisDocumentationTestCoverageMin.value }),
        totals({
          done: 10,
          rework: 1,
        }),
      ),
    ).toBe('healthyAcceleration');
    expect(
      diagnose(
        org({
          testCoverage: OUTCOME_BALANCE.diagnosisDocumentationTestCoverageMin.value,
          documentation: OUTCOME_BALANCE.diagnosisDocumentationMin.value,
        }),
        totals({ done: 10, rework: 1 }),
      ),
    ).toBe('documentationKingdom');
  });
});

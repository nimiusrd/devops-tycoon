import { describe, expect, it } from 'vitest';
import { diagnosisTheme } from '../../src/render/diagnosisTheme';
import type { DiagnosisType } from '../../src/sim/run/types';

const DIAGNOSIS_TYPES: DiagnosisType[] = [
  'healthyAcceleration',
  'reviewHell',
  'aiOverproduction',
  'reworkSpiral',
  'seniorSacrifice',
  'documentationKingdom',
];

describe('診断別の画面演出（RI-21）', () => {
  it.each(DIAGNOSIS_TYPES)('%s に固有のトーン・アイコン・状態文がある', (type) => {
    const theme = diagnosisTheme(type);

    expect(theme.toneClass).toMatch(/^tone-/);
    expect(theme.icon).not.toHaveLength(0);
    expect(theme.warning).not.toHaveLength(0);
  });

  it('6タイプをそれぞれ異なる画面トーンへ割り当てる', () => {
    const toneClasses = DIAGNOSIS_TYPES.map((type) => diagnosisTheme(type).toneClass);

    expect(new Set(toneClasses).size).toBe(DIAGNOSIS_TYPES.length);
  });
});

/**
 * render 配下のテーマ写像（診断別の画面演出・継続不能種別の終了演出）の単体テスト。
 * いずれも「種別ごとに固有のトーン／アイコン／文言を返す」ことを固定する。
 */
import { describe, expect, it } from 'vitest';
import { diagnosisTheme } from '../../src/render/diagnosisTheme';
import type { DiagnosisType, QuarterOutcome } from '../../src/sim/run/types';
import { quarterFailureTheme } from '../../src/render/quarterFailureTheme';

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

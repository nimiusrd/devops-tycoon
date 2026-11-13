import { describe, expect, it } from 'vitest';
import { planQuarterGoalProgressLine } from '../../../src/render/quarterGoalProgressCopy';
import type { GoalKpiProgress } from '../../../src/sim/run/types';

describe('quarterGoalProgressCopy（#1014）', () => {
  const progress: GoalKpiProgress[] = [
    {
      id: 'delivery',
      label: 'Delivery（四半期累計）',
      target: 5265,
      actual: 4515,
      status: 'missed',
    },
    {
      id: 'quality',
      label: 'Quality',
      target: 45,
      actual: 50,
      status: 'met',
    },
    {
      id: 'techDebt',
      label: 'Tech Debt',
      target: 55,
      actual: 40,
      status: 'met',
    },
    {
      id: 'morale',
      label: 'Morale',
      target: 40,
      actual: 45,
      status: 'met',
    },
    {
      id: 'incident',
      label: 'Incident',
      target: 6,
      actual: 30,
      status: 'missed',
    },
  ];

  it('四半期1〜5の結果では KPI 進捗を1行で出す', () => {
    const line = planQuarterGoalProgressLine({
      quarterNumber: 1,
      sprintIndexInQuarter: 5,
      sprintsPerQuarter: 6,
      progress,
    });
    expect(line.show).toBe(true);
    if (!line.show) return;
    expect(line.text).toContain('Q1');
    expect(line.text).toContain('出荷 4515 / 5265');
    expect(line.text).toContain('インシデント 30 / 上限 6');
    expect(line.text).toContain('（残り1スプリント）');
  });

  it('未達 KPI があると危険トーンになる', () => {
    const line = planQuarterGoalProgressLine({
      quarterNumber: 1,
      sprintIndexInQuarter: 5,
      sprintsPerQuarter: 6,
      progress,
    });
    expect(line.show).toBe(true);
    if (!line.show) return;
    expect(line.tone).toBe('danger');
    expect(line.severity).toBeGreaterThan(100);
  });

  it('ボス結果では行を出さない', () => {
    expect(
      planQuarterGoalProgressLine({
        quarterNumber: 1,
        sprintIndexInQuarter: 6,
        sprintsPerQuarter: 6,
        progress,
      }),
    ).toEqual({ show: false });
  });
});

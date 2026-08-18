/**
 * 診断・KPI時系列の表示導出（RI-128）。
 */
import { describe, expect, it } from 'vitest';
import { planTrendHistory } from '../../../src/render/trendHistoryView';
import type { GoalKpiProgress, QuarterTrendSnapshot } from '../../../src/sim/run/types';

function kpis(quarterNumber: number): GoalKpiProgress[] {
  return [
    {
      id: 'delivery',
      label: '出荷',
      target: 90,
      actual: 100 * quarterNumber,
      status: quarterNumber > 1 ? 'exceeded' : 'met',
    },
    { id: 'quality', label: '品質', target: 50, actual: 40 + quarterNumber, status: 'met' },
    { id: 'techDebt', label: '負債', target: 55, actual: 20 + quarterNumber * 5, status: 'met' },
    { id: 'morale', label: '士気', target: 40, actual: 70 - quarterNumber, status: 'met' },
    { id: 'incident', label: '炎上', target: 6, actual: quarterNumber, status: 'met' },
  ];
}

function snap(
  quarterNumber: number,
  overrides: Partial<QuarterTrendSnapshot> = {},
): QuarterTrendSnapshot {
  return {
    quarterNumber,
    diagnosis: 'healthyAcceleration',
    kpis: kpis(quarterNumber),
    company: {
      shipping: 9999,
      aiDependency: 40 + quarterNumber,
      techDebt: 20 + quarterNumber * 5,
      morale: 70 - quarterNumber,
      onFire: 0,
      healthRank: 'A',
      selfRank: 5,
      selfRanks: { overall: 5, healthy: 4, ai: 6, growth: 3 },
    },
    departments: [
      {
        deptId: 'product',
        aiDependency: 30 + quarterNumber,
        techDebt: 10,
        morale: 80,
        health: 'healthy',
      },
    ],
    ...overrides,
  };
}

describe('planTrendHistory (RI-128)', () => {
  it('空履歴は記録なしとして扱い、系列を出さない', () => {
    expect(planTrendHistory([])).toMatchObject({
      empty: true,
      quarters: [],
      series: [],
      departments: [],
    });
  });

  it('1四半期でも診断ラベルと保存KPIのスパークラインを出す', () => {
    const view = planTrendHistory([snap(1, { diagnosis: 'reviewHell' })]);
    expect(view.empty).toBe(false);
    expect(view.quarters).toEqual([
      { quarterNumber: 1, diagnosis: 'reviewHell', label: 'Review Hell 型' },
    ]);
    expect(view.series.map((s) => s.key)).toEqual([
      'delivery',
      'quality',
      'techDebt',
      'morale',
      'incident',
    ]);
    const delivery = view.series.find((s) => s.key === 'delivery')!;
    expect(delivery.last).toBe(100);
    expect(delivery.lastStatus).toBe('met');
    expect(delivery.lastStatusLabel).toBe('達成');
    for (const series of view.series) {
      expect(series.d).toMatch(/^M /);
      expect(series.d).toMatch(/ L /);
      expect(series.last).toBeGreaterThanOrEqual(0);
    }
    expect(view.departments).toHaveLength(1);
    expect(view.departments[0]!.deptId).toBe('product');
    expect(view.departments[0]!.name).toBe('プロダクト事業部');
  });

  it('出荷系列は company.shipping ではなく kpis の Delivery 実績を使う', () => {
    const view = planTrendHistory([
      snap(1, {
        kpis: [
          { id: 'delivery', label: '出荷', target: 90, actual: 80, status: 'missed' },
          { id: 'quality', label: '品質', target: 50, actual: 60, status: 'exceeded' },
          { id: 'techDebt', label: '負債', target: 55, actual: 40, status: 'met' },
          { id: 'morale', label: '士気', target: 40, actual: 50, status: 'met' },
          { id: 'incident', label: '炎上', target: 6, actual: 2, status: 'met' },
        ],
        company: {
          shipping: 9999,
          aiDependency: 40,
          techDebt: 20,
          morale: 70,
          onFire: 0,
          healthRank: 'A',
          selfRank: 5,
        },
      }),
    ]);
    expect(view.series.find((s) => s.key === 'delivery')?.last).toBe(80);
    expect(view.series.find((s) => s.key === 'quality')?.last).toBe(60);
    expect(view.series.find((s) => s.key === 'delivery')?.lastStatusLabel).toBe('未達');
  });

  it('複数四半期の値から折れ線を作り、部門名は引数を優先する', () => {
    const view = planTrendHistory([snap(1), snap(2, { diagnosis: 'reworkSpiral' })], {
      departmentNames: { product: '特命事業部' },
    });
    expect(view.quarters.map((q) => q.diagnosis)).toEqual(['healthyAcceleration', 'reworkSpiral']);
    const delivery = view.series.find((s) => s.key === 'delivery')!;
    expect(delivery.last).toBe(200);
    expect(delivery.lastStatus).toBe('exceeded');
    expect(delivery.d.split(' L ')).toHaveLength(2);
    expect(view.departments[0]!.name).toBe('特命事業部');
  });

  it('途中から現れる部門も系列に含め、欠落四半期は0で埋める', () => {
    const view = planTrendHistory([
      snap(1, { departments: [] }),
      snap(2, {
        departments: [
          {
            deptId: 'platform',
            aiDependency: 55,
            techDebt: 12,
            morale: 60,
            health: 'congested',
          },
        ],
      }),
    ]);
    expect(view.departments.map((d) => d.deptId)).toEqual(['platform']);
    const ai = view.departments[0]!.series.find((s) => s.key === 'aiDependency')!;
    expect(ai.last).toBe(55);
    expect(ai.d.split(' L ')).toHaveLength(2);
  });

  it('AI Adoption がある四半期だけ系列を足す', () => {
    const without = planTrendHistory([snap(1)]);
    expect(without.series.some((s) => s.key === 'aiAdoption')).toBe(false);
    const withAi = planTrendHistory([
      snap(1, {
        kpis: [
          ...kpis(1),
          { id: 'aiAdoption', label: 'AI導入', target: 40, actual: 55, status: 'exceeded' },
        ],
      }),
    ]);
    const series = withAi.series.find((s) => s.key === 'aiAdoption')!;
    expect(series.last).toBe(55);
    expect(series.lastStatus).toBe('exceeded');
  });

  it('途中から現れた AI Adoption を欠落四半期の 0 で埋めない', () => {
    const view = planTrendHistory([
      snap(1),
      snap(2, {
        kpis: [
          ...kpis(2),
          { id: 'aiAdoption', label: 'AI導入', target: 40, actual: 55, status: 'exceeded' },
        ],
      }),
    ]);
    const series = view.series.find((s) => s.key === 'aiAdoption')!;
    expect(series.last).toBe(55);
    const ys = [...series.d.matchAll(/,([\d.]+)/g)].map((match) => match[1]);
    expect(new Set(ys).size).toBe(1);
  });
});

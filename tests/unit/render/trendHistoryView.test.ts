/**
 * 診断・KPI時系列の表示導出（RI-128）。
 */
import { describe, expect, it } from 'vitest';
import { planTrendHistory } from '../../../src/render/trendHistoryView';
import type { QuarterTrendSnapshot } from '../../../src/sim/run/types';

function snap(
  quarterNumber: number,
  overrides: Partial<QuarterTrendSnapshot> = {},
): QuarterTrendSnapshot {
  return {
    quarterNumber,
    diagnosis: 'healthyAcceleration',
    kpis: [{ id: 'delivery', label: '出荷', target: 90, actual: 100, status: 'met' }],
    company: {
      shipping: 100 * quarterNumber,
      aiDependency: 40 + quarterNumber,
      techDebt: 20 + quarterNumber * 5,
      morale: 70 - quarterNumber,
      onFire: 0,
      healthRank: 'A',
      selfRank: 5,
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

  it('1四半期でも診断ラベルとスパークラインを出す', () => {
    const view = planTrendHistory([snap(1, { diagnosis: 'reviewHell' })]);
    expect(view.empty).toBe(false);
    expect(view.quarters).toEqual([
      { quarterNumber: 1, diagnosis: 'reviewHell', label: 'Review Hell 型' },
    ]);
    expect(view.series.map((s) => s.key)).toEqual([
      'shipping',
      'aiDependency',
      'techDebt',
      'morale',
    ]);
    for (const series of view.series) {
      expect(series.d).toMatch(/^M /);
      expect(series.last).toBeGreaterThanOrEqual(0);
    }
    expect(view.departments).toHaveLength(1);
    expect(view.departments[0]!.deptId).toBe('product');
    expect(view.departments[0]!.name).toBe('プロダクト事業部');
  });

  it('複数四半期の値から折れ線を作り、部門名は引数を優先する', () => {
    const view = planTrendHistory([snap(1), snap(2, { diagnosis: 'reworkSpiral' })], {
      departmentNames: { product: '特命事業部' },
    });
    expect(view.quarters.map((q) => q.diagnosis)).toEqual(['healthyAcceleration', 'reworkSpiral']);
    const shipping = view.series.find((s) => s.key === 'shipping')!;
    expect(shipping.last).toBe(200);
    expect(shipping.d.split(' L ')).toHaveLength(2);
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
});

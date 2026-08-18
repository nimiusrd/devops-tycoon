/**
 * 四半期トレンドスナップショットの純関数（RI-128）。
 */
import { describe, expect, it } from 'vitest';
import { generateOrgScale } from '../../../src/sim/orgscale';
import type { OrgScaleInput } from '../../../src/sim/orgscale';
import { buildQuarterTrendSnapshot, cloneTrendHistory } from '../../../src/sim/run/trendHistory';
import type { GoalKpiProgress, QuarterTrendSnapshot, RunTotals } from '../../../src/sim/run/types';
import type { OrgState } from '../../../src/sim/types';

function org(overrides: Partial<OrgState> = {}): OrgState {
  return {
    aiEnabled: true,
    aiDependency: 50,
    aiLiteracy: 50,
    testCoverage: 60,
    documentation: 55,
    quality: 60,
    securityLevel: 55,
    morale: 70,
    seniorHp: 80,
    techDebt: 40,
    deliveryScore: 800,
    ...overrides,
  };
}

function totals(): RunTotals {
  return {
    delivered: 800,
    done: 80,
    rework: 10,
    incidents: 2,
    contained: 2,
    spread: 0,
    aiAssisted: 30,
    completed: 80,
    reviewQueuePeak: 3,
    maxCombo: 8,
  };
}

function scale(seed = 'trend-snap') {
  const input: OrgScaleInput = {
    seed,
    org: org(),
    totals: totals(),
    diagnosis: 'healthyAcceleration',
    budget: 100,
  };
  return generateOrgScale(input);
}

function kpi(overrides: Partial<GoalKpiProgress> = {}): GoalKpiProgress {
  return {
    id: 'delivery',
    label: '出荷',
    target: 90,
    actual: 100,
    status: 'met',
    ...overrides,
  };
}

describe('buildQuarterTrendSnapshot (RI-128)', () => {
  it('全社KPIと部門指標を記録し、診断は渡した値のまま残す', () => {
    const orgScale = scale();
    const snap = buildQuarterTrendSnapshot({
      quarterNumber: 2,
      diagnosis: 'reviewHell',
      kpis: [kpi(), kpi({ id: 'morale', label: '士気', actual: 40, status: 'missed' })],
      orgScale,
    });

    expect(snap.quarterNumber).toBe(2);
    expect(snap.diagnosis).toBe('reviewHell');
    expect(snap.kpis).toEqual([
      kpi(),
      kpi({ id: 'morale', label: '士気', actual: 40, status: 'missed' }),
    ]);
    expect(snap.company.shipping).toBe(orgScale.shipping);
    expect(snap.company.aiDependency).toBe(orgScale.aiDependency);
    expect(snap.company.techDebt).toBe(orgScale.techDebt);
    expect(snap.company.morale).toBe(orgScale.morale);
    expect(snap.company.onFire).toBe(orgScale.onFire);
    expect(snap.company.healthRank).toBe(orgScale.healthRank);
    expect(snap.company.selfRank).toBeGreaterThanOrEqual(1);
    expect(snap.departments.map((d) => d.deptId)).toEqual(
      orgScale.departments.map((d) => d.def.id),
    );
    expect(snap.kpis).not.toBe(orgScale as unknown);
  });

  it('KPI配列を複製し、入力を共有しない', () => {
    const kpis = [kpi()];
    const snap = buildQuarterTrendSnapshot({
      quarterNumber: 1,
      diagnosis: 'healthyAcceleration',
      kpis,
      orgScale: scale(),
    });
    kpis[0]!.actual = 1;
    expect(snap.kpis[0]!.actual).toBe(100);
  });
});

describe('cloneTrendHistory', () => {
  it('欠落・非配列は空配列にする', () => {
    expect(cloneTrendHistory(undefined)).toEqual([]);
    expect(cloneTrendHistory(null as unknown as QuarterTrendSnapshot[])).toEqual([]);
  });

  it('ネストを複製して共有参照を切る', () => {
    const original = [
      buildQuarterTrendSnapshot({
        quarterNumber: 1,
        diagnosis: 'healthyAcceleration',
        kpis: [kpi()],
        orgScale: scale(),
      }),
    ];
    const cloned = cloneTrendHistory(original);
    cloned[0]!.company.shipping = 0;
    cloned[0]!.kpis[0]!.actual = 0;
    expect(original[0]!.company.shipping).not.toBe(0);
    expect(original[0]!.kpis[0]!.actual).toBe(100);
  });
});

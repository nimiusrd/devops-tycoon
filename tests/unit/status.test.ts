import { describe, expect, it } from 'vitest';
import { createEngine } from '../../src/sim/engine';
import {
  deriveStatus,
  deriveHudStatusParts,
  diffHudMetricSnapshots,
  hudMetricSnapshot,
  riskLevel,
  type HudMetricSnapshot,
} from '../../src/render/status';
import type { OrgScaleState } from '../../src/sim/orgscale/types';
import type { OrgState, SimState } from '../../src/sim/types';

/** 既定スナップショットに org を上書きした SimState を作る。 */
function withOrg(org: Partial<OrgState>): SimState {
  const base = createEngine({ seed: 'status', aiEnabled: true }).snapshot();
  return { ...base, aiEnabled: org.aiEnabled ?? base.aiEnabled, org: { ...base.org, ...org } };
}

describe('deriveStatus（状態→ステータス表示）', () => {
  it('AI 導入時は開発速度 S、未導入時は B', () => {
    expect(deriveStatus(withOrg({ aiEnabled: true })).devSpeed).toBe('S');
    expect(deriveStatus(withOrg({ aiEnabled: false })).devSpeed).toBe('B');
  });

  it('シニア体力が高いほどレビュー耐性のグレードが上がる', () => {
    const high = deriveStatus(withOrg({ seniorHp: 95 })).reviewCapacity;
    const low = deriveStatus(withOrg({ seniorHp: 15 })).reviewCapacity;
    expect(high).toBe('S');
    expect(low).toBe('E');
  });

  it('AI依存度・技術的負債・士気をそのまま数値で出す', () => {
    const s = deriveStatus(withOrg({ aiDependency: 72, techDebt: 41, morale: 66 }));
    expect(s.aiDependencyPct).toBe(72);
    expect(s.techDebt).toBe(41);
    expect(s.morale).toBe(66);
  });

  it('全社俯瞰中はHUD数値に組織スケール集約値を使う', () => {
    const state = withOrg({
      deliveryScore: 50,
      aiDependency: 72,
      techDebt: 41,
      morale: 66,
      seniorHp: 80,
    });
    const orgScale: OrgScaleState = {
      seed: 'status',
      departments: [],
      shipping: 180,
      teamCount: 4,
      deptCount: 1,
      engineers: 16,
      aiDependency: 44,
      techDebt: 12,
      morale: 91,
      onFire: 0,
      diagnosis: state.diagnosis,
      infra: { ci: 0, docs: 0, aiGuideline: 0 },
      budget: 20,
      score: 160,
      healthRank: 'A',
    };

    expect(
      hudMetricSnapshot(deriveHudStatusParts(state.org, state.sprint.tasks, orgScale)),
    ).toEqual({
      deliveryScore: 180,
      seniorHpPct: 80,
      aiDependencyPct: 44,
      techDebt: 12,
      morale: 91,
    });
  });
});

describe('riskLevel（炎上リスク）', () => {
  it('渋滞が大きい/体力が低いほどリスクが上がる', () => {
    expect(riskLevel(0, 100)).toBe('LOW');
    expect(riskLevel(7, 80)).toBe('MED');
    expect(riskLevel(13, 80)).toBe('HIGH');
    expect(riskLevel(0, 20)).toBe('HIGH');
  });
});

describe('HUD 指標差分', () => {
  const baseSnapshot: HudMetricSnapshot = {
    deliveryScore: 100,
    seniorHpPct: 80,
    aiDependencyPct: 30,
    techDebt: 10,
    morale: 60,
  };

  it('StatusView から差分検出用スナップショットを作る', () => {
    const status = deriveStatus(withOrg({ aiDependency: 72, techDebt: 41, morale: 66 }));
    expect(hudMetricSnapshot(status)).toEqual({
      deliveryScore: status.deliveryScore,
      seniorHpPct: status.seniorHpPct,
      aiDependencyPct: 72,
      techDebt: 41,
      morale: 66,
    });
  });

  it('良い指標の増加は positive、減少は negative にする', () => {
    expect(
      diffHudMetricSnapshots(baseSnapshot, {
        ...baseSnapshot,
        deliveryScore: 112,
        seniorHpPct: 75,
        morale: 68,
      }),
    ).toEqual([
      { key: 'deliveryScore', label: '出荷ポイント', delta: 12, tone: 'positive' },
      { key: 'seniorHpPct', label: 'シニア体力', delta: -5, tone: 'negative' },
      { key: 'morale', label: '士気', delta: 8, tone: 'positive' },
    ]);
  });

  it('AI依存度/技術的負債は増加を negative、減少を positive にする', () => {
    expect(
      diffHudMetricSnapshots(baseSnapshot, {
        ...baseSnapshot,
        aiDependencyPct: 38,
        techDebt: 7,
      }),
    ).toEqual([
      { key: 'aiDependencyPct', label: 'AI依存度', delta: 8, tone: 'negative' },
      { key: 'techDebt', label: '技術的負債', delta: -3, tone: 'positive' },
    ]);
  });

  it('変化がない指標は差分に含めない', () => {
    expect(diffHudMetricSnapshots(baseSnapshot, { ...baseSnapshot })).toEqual([]);
  });
});

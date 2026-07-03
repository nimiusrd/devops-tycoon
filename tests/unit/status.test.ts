import { describe, expect, it } from 'vitest';
import { createEngine } from '../../src/sim/engine';
import { deriveHudMetrics, deriveStatus, riskLevel } from '../../src/render/status';
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
});

describe('riskLevel（炎上リスク）', () => {
  it('渋滞が大きい/体力が低いほどリスクが上がる', () => {
    expect(riskLevel(0, 100)).toBe('LOW');
    expect(riskLevel(7, 80)).toBe('MED');
    expect(riskLevel(13, 80)).toBe('HIGH');
    expect(riskLevel(0, 20)).toBe('HIGH');
  });
});

describe('deriveHudMetrics（HUD情報設計）', () => {
  it('8指標それぞれにアイコン・方向・説明を付与する', () => {
    const state = withOrg({ aiDependency: 20, techDebt: 10, morale: 80 });
    const metrics = deriveHudMetrics(state.org, state.sprint.tasks);

    expect(metrics).toHaveLength(8);
    expect(metrics.map((m) => m.id)).toEqual([
      'delivery',
      'devSpeed',
      'reviewCapacity',
      'quality',
      'seniorHp',
      'aiDependency',
      'techDebt',
      'morale',
    ]);
    for (const metric of metrics) {
      expect(metric.icon.length).toBeGreaterThan(0);
      expect(metric.directionLabel.length).toBeGreaterThan(0);
      expect(metric.help.length).toBeGreaterThan(0);
    }
  });

  it('低いほど安全な指標は高値で危険域になる', () => {
    const state = withOrg({ aiDependency: 82, techDebt: 90 });
    const metrics = deriveHudMetrics(state.org, state.sprint.tasks);

    expect(metrics.find((m) => m.id === 'aiDependency')).toMatchObject({
      direction: 'lower-better',
      tone: 'danger',
    });
    expect(metrics.find((m) => m.id === 'techDebt')).toMatchObject({
      direction: 'lower-better',
      tone: 'danger',
    });
  });

  it('シニア体力と士気は低下すると危険域として表示する', () => {
    const state = withOrg({ seniorHp: 20, morale: 30 });
    const metrics = deriveHudMetrics(state.org, state.sprint.tasks);

    expect(metrics.find((m) => m.id === 'seniorHp')).toMatchObject({
      direction: 'higher-better',
      tone: 'danger',
      barPct: 20,
    });
    expect(metrics.find((m) => m.id === 'morale')).toMatchObject({
      direction: 'higher-better',
      tone: 'danger',
      risk: 'HIGH',
    });
  });
});

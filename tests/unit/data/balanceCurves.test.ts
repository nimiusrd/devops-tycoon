import { describe, expect, it } from 'vitest';
import {
  BALANCE_CURVE_MARKER_INPUTS,
  BALANCE_CURVE_REPRESENTATIVE,
  chooseProbabilityAxis,
  representativeIncidentProbability,
  representativeReworkProbability,
  renderBalanceCurvesSvg,
  sampleRepresentativeCurves,
} from '../../../src/data/balance/curves';
import { incidentProbability, reworkProbability } from '../../../src/sim/model';
import type { OrgState, Task } from '../../../src/sim/types';

function org(overrides: Partial<OrgState> = {}): OrgState {
  return {
    aiEnabled: true,
    aiDependency: 0,
    aiLiteracy: BALANCE_CURVE_REPRESENTATIVE.aiLiteracy,
    testCoverage: 0,
    documentation: 0,
    quality: BALANCE_CURVE_REPRESENTATIVE.quality,
    securityLevel: BALANCE_CURVE_REPRESENTATIVE.securityLevel,
    morale: 0,
    seniorHp: 100,
    techDebt: 0,
    deliveryScore: 0,
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 0,
    kind: 'normal',
    highValue: false,
    aiAssisted: false,
    lane: 'review',
    progress: 0,
    reworkAttempts: BALANCE_CURVE_REPRESENTATIVE.reworkAttempts,
    wasReworked: false,
    incident: false,
    debt: false,
    ...overrides,
  };
}

describe('代表確率曲線の生成', () => {
  it('同じ定義から常に同じ SVG を返す', () => {
    expect(renderBalanceCurvesSvg()).toBe(renderBalanceCurvesSvg());
  });

  it('サンプル点がゲームの Rework / Incident 純関数と一致する', () => {
    for (const point of sampleRepresentativeCurves()) {
      expect(point.reworkAi).toBe(
        reworkProbability(org({ aiDependency: point.input }), task({ aiAssisted: true })),
      );
      expect(point.reworkNoAi).toBe(
        reworkProbability(org({ aiDependency: point.input }), task({ aiAssisted: false })),
      );
      expect(point.incidentAi).toBe(
        incidentProbability(org({ testCoverage: point.input }), task({ aiAssisted: true })),
      );
      expect(point.incidentNoAi).toBe(
        incidentProbability(org({ testCoverage: point.input }), task({ aiAssisted: false })),
      );
    }
  });

  it('probability-model.md の現行端点表と一致する', () => {
    expect(representativeReworkProbability(true, 0) * 100).toBeCloseTo(2.0, 10);
    expect(representativeReworkProbability(true, 100) * 100).toBeCloseTo(25.5, 10);
    expect(representativeReworkProbability(false, 0) * 100).toBeCloseTo(2.0, 10);
    expect(representativeReworkProbability(false, 100) * 100).toBeCloseTo(20.5, 10);
    expect(representativeIncidentProbability(true, 0) * 100).toBeCloseTo(14.75, 10);
    expect(representativeIncidentProbability(true, 100) * 100).toBeCloseTo(4.75, 10);
    expect(representativeIncidentProbability(false, 0) * 100).toBeCloseTo(12.0, 10);
    expect(representativeIncidentProbability(false, 100) * 100).toBeCloseTo(2.0, 10);
  });

  it('生成 SVG は現行モデルの注記を含み、候補曲線の文言を混ぜない', () => {
    const svg = renderBalanceCurvesSvg();

    expect(
      svg.startsWith(
        '<!-- このファイルは `npm run balance:docs` で生成されます。手動編集しないでください。 -->',
      ),
    ).toBe(true);
    expect(svg).toContain('現行モデルのRework確率とIncident確率の代表曲線');
    expect(svg).toContain(
      `AI Literacy ${BALANCE_CURVE_REPRESENTATIVE.aiLiteracy} / Quality ${BALANCE_CURVE_REPRESENTATIVE.quality} / 初回Review / 補正なし`,
    );
    expect(svg).toContain('線は現行モデル式から算出した条件付き確率');
    expect(svg).not.toContain('候補');
    expect(svg).not.toContain('交差');
    expect(svg).not.toContain('manualCapability');
    expect(svg).toContain('35%');
    expect(svg).toContain('16%');
    expect(svg.match(/<polyline class="ai"/g)).toHaveLength(2);
    expect(svg.match(/<polyline class="no-ai"/g)).toHaveLength(2);
    expect(BALANCE_CURVE_MARKER_INPUTS).toEqual([0, 25, 50, 75, 100]);
  });

  it('現行値では既定のY軸上限を保ち、超過時は目盛りを広げる', () => {
    const preferredIncident = [0, 0.04, 0.08, 0.12, 0.16];
    const current = chooseProbabilityAxis(0.1475, preferredIncident);
    expect(current.max).toBe(0.16);
    expect(current.ticks).toEqual(preferredIncident);

    const overflow = chooseProbabilityAxis(0.2275, preferredIncident);
    expect(overflow.max).toBeGreaterThanOrEqual(0.2275);
    expect(overflow.max).toBeGreaterThan(0.16);
    expect(overflow.ticks[0]).toBe(0);
    expect(overflow.ticks[overflow.ticks.length - 1]).toBe(overflow.max);
  });
});

/**
 * 業界ランキング等角スカイラインのシーン計画検証（RI-03 / SPEC 第22.5）。
 */
import { describe, expect, it } from 'vitest';
import {
  generateIndustry,
  generateOrgScale,
  RANKING_KINDS,
  type OrgScaleInput,
} from '../../../src/sim/orgscale';
import type { RunTotals } from '../../../src/sim/run/types';
import type { OrgState } from '../../../src/sim/types';
import {
  INDUSTRY_SKYLINE_LIMIT,
  INDUSTRY_VIEW,
  isInIndustryView,
  planIndustryBoardScene,
} from '../../../src/render/industryBoardScene';

function org(overrides: Partial<OrgState> = {}): OrgState {
  return {
    aiEnabled: true,
    aiDependency: 50,
    aiLiteracy: 50,
    testCoverage: 60,
    documentation: 55,
    quality: 60,
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

function industry(seed = 'ri03-industry', kind: (typeof RANKING_KINDS)[number] = 'overall') {
  const input: OrgScaleInput = {
    seed,
    org: org(),
    totals: totals(),
    diagnosis: 'healthyAcceleration',
    budget: 100,
  };
  return generateIndustry(generateOrgScale(input), kind);
}

describe('planIndustryBoardScene (RI-03)', () => {
  it('上位枠と自社を含む 8 社ぶんの等角ビルを生成する', () => {
    const ind = industry();
    const scene = planIndustryBoardScene(ind);
    expect(scene.buildings).toHaveLength(INDUSTRY_SKYLINE_LIMIT);
    expect(scene.buildings[0].id).toBe(ind.entries[0].org.id);
    expect(scene.buildings.some((b) => b.isSelf)).toBe(true);
  });

  it('全ビルとラベルが INDUSTRY_VIEW 内に収まる', () => {
    const scene = planIndustryBoardScene(industry());
    for (const b of scene.buildings) {
      expect(isInIndustryView(b.x, b.baseY)).toBe(true);
      expect(isInIndustryView(b.x - b.width / 2, b.baseY - b.height - b.depth)).toBe(true);
      expect(isInIndustryView(b.x + b.width / 2 + b.depth, b.baseY)).toBe(true);
      expect(isInIndustryView(b.label.x, b.label.y)).toBe(true);
    }
    expect(INDUSTRY_VIEW).toEqual({ w: 740, h: 360 });
  });

  it('表示中ランキング種別のスコアに応じて高さが単調非増加になる', () => {
    for (const kind of RANKING_KINDS) {
      const scene = planIndustryBoardScene(industry(`ri03-height-${kind}`, kind));
      const rankedBuildings = scene.buildings.filter(
        (b) => !b.isSelf || b.rank <= INDUSTRY_SKYLINE_LIMIT,
      );
      for (let i = 1; i < rankedBuildings.length; i += 1) {
        expect(rankedBuildings[i - 1].score).toBeGreaterThanOrEqual(rankedBuildings[i].score);
        expect(rankedBuildings[i - 1].height).toBeGreaterThanOrEqual(rankedBuildings[i].height);
      }
    }
  });

  it('1位には王冠、自社には self tone を付ける', () => {
    const scene = planIndustryBoardScene(industry('ri03-flags'));
    const leader = scene.buildings.find((b) => b.rank === 1);
    expect(leader?.hasCrown).toBe(true);
    expect(leader?.tone).toMatch(/leader|self/);

    const self = scene.buildings.find((b) => b.isSelf);
    if (self) {
      expect(self.tone).toBe('self');
      expect(self.label.title).toContain('自社');
    }
  });

  it('ランキング種別を切り替えるとビル高さが再計算される', () => {
    const overall = planIndustryBoardScene(industry('ri03-kind-switch', 'overall'));
    const healthy = planIndustryBoardScene(industry('ri03-kind-switch', 'healthy'));
    expect(overall.buildings.map((b) => b.score)).not.toEqual(
      healthy.buildings.map((b) => b.score),
    );
  });
});

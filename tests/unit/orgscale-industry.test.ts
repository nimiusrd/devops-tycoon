/**
 * 業界ランキング生成の決定論検証（SPEC 第4.10）。
 */
import { describe, expect, it } from 'vitest';
import {
  computeScores,
  generateIndustry,
  generateOrgScale,
  RANKING_KINDS,
  type OrgScaleInput,
} from '../../src/sim/orgscale';
import type { OrgState } from '../../src/sim/types';
import type { RunTotals } from '../../src/sim/run/types';

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

function company(seed = 'industry-seed', overrides: Partial<OrgState> = {}) {
  const input: OrgScaleInput = {
    seed,
    org: org(overrides),
    totals: totals(),
    diagnosis: 'healthyAcceleration',
    budget: 100,
  };
  return generateOrgScale(input);
}

describe('computeScores', () => {
  it('見かけの出荷だけ高い組織は健全経営で沈む', () => {
    const flashy = computeScores({
      shipping: 2000,
      morale: 20,
      techDebt: 200,
      aiDependency: 95,
      aiGuideline: 10,
      onFire: 3,
    });
    const solid = computeScores({
      shipping: 1000,
      morale: 90,
      techDebt: 10,
      aiDependency: 40,
      aiGuideline: 80,
      onFire: 0,
    });
    expect(flashy.overall).toBeGreaterThan(solid.overall); // 総合は派手な方が上
    expect(solid.healthy).toBeGreaterThan(flashy.healthy); // 健全経営は堅実な方が上
  });
});

describe('generateIndustry', () => {
  it('同じ会社・種別からは同一ランキングを生成する（決定論）', () => {
    const c = company();
    expect(generateIndustry(c, 'overall')).toEqual(generateIndustry(c, 'overall'));
  });

  it('自社を 1 つだけ含み、順位は連番で並ぶ', () => {
    const ind = generateIndustry(company(), 'overall');
    const selves = ind.entries.filter((e) => e.org.isSelf);
    expect(selves).toHaveLength(1);
    expect(ind.entries.map((e) => e.rank)).toEqual(
      Array.from({ length: ind.total }, (_, i) => i + 1),
    );
    expect(ind.selfRank).toBe(selves[0].rank);
  });

  it('指定種別で降順ソートされている', () => {
    for (const kind of RANKING_KINDS) {
      const ind = generateIndustry(company(), kind);
      const scores = ind.entries.map((e) => e.org.scores[kind]);
      const sorted = [...scores].sort((a, b) => b - a);
      expect(scores).toEqual(sorted);
    }
  });

  it('強い会社ほど上位（順位が小さい）になる', () => {
    const weak = generateIndustry(
      company('rank-seed', { deliveryScore: 50, morale: 20 }),
      'overall',
    );
    const strong = generateIndustry(
      company('rank-seed', { deliveryScore: 5000, morale: 95 }),
      'overall',
    );
    expect(strong.selfRank).toBeLessThan(weak.selfRank);
  });

  it('シーズンとリーグが決定論で付与される', () => {
    const ind = generateIndustry(company(), 'overall');
    expect(ind.season).toBeGreaterThanOrEqual(1);
    expect(ind.season).toBeLessThanOrEqual(4);
    expect(ind.league).toMatch(/リーグ$/);
  });
});

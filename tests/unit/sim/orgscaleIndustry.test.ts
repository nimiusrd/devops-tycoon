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
  type OrgScaleState,
} from '../../../src/sim/orgscale';
import type { OrgState } from '../../../src/sim/types';
import type { RunTotals } from '../../../src/sim/run/types';

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

function minimalCompany(overrides: Partial<OrgScaleState> = {}): OrgScaleState {
  const base: OrgScaleState = {
    seed: 'industry-seed',
    departments: [],
    shipping: 1000,
    teamCount: 1,
    deptCount: 1,
    engineers: 1,
    aiDependency: 50,
    techDebt: 0,
    morale: 70,
    onFire: 0,
    diagnosis: 'healthyAcceleration',
    infra: { ci: 60, docs: 55, aiGuideline: 50 },
    budget: 100,
    score: 1000,
    healthRank: 'A',
    securityLevel: 60,
  };
  return { ...base, ...overrides, infra: { ...base.infra, ...(overrides.infra ?? {}) } };
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

  it('代表入力から各ランキング種別のスコアを固定値で計算する', () => {
    expect(
      computeScores({
        shipping: 1000,
        morale: 70,
        techDebt: 80,
        aiDependency: 65,
        aiGuideline: 40,
        onFire: 2,
      }),
    ).toEqual({ overall: 880, healthy: 296, ai: 605, growth: 540 });
  });

  it('各入力の係数を1変数ずつ反映する', () => {
    const base = {
      shipping: 1000,
      morale: 70,
      techDebt: 100,
      aiDependency: 70,
      aiGuideline: 40,
      onFire: 1,
    };

    expect(computeScores(base)).toEqual({ overall: 910, healthy: 280, ai: 590, growth: 540 });
    expect(computeScores({ ...base, shipping: 1010 })).toEqual({
      overall: 920,
      healthy: 280,
      ai: 595,
      growth: 544,
    });
    expect(computeScores({ ...base, morale: 71 })).toEqual({
      overall: 910,
      healthy: 285,
      ai: 590,
      growth: 542,
    });
    expect(computeScores({ ...base, techDebt: 110 })).toEqual({
      overall: 905,
      healthy: 277,
      ai: 590,
      growth: 540,
    });
    expect(computeScores({ ...base, aiDependency: 71 })).toEqual({
      overall: 910,
      healthy: 278,
      ai: 587,
      growth: 540,
    });
    expect(computeScores({ ...base, aiGuideline: 41 })).toEqual({
      overall: 910,
      healthy: 280,
      ai: 593,
      growth: 540,
    });
    expect(computeScores({ ...base, onFire: 2 })).toEqual({
      overall: 870,
      healthy: 280,
      ai: 590,
      growth: 540,
    });
  });

  it('技術的負債とAI依存度の境界を丸め込み込みで扱う', () => {
    const base = {
      shipping: 1000,
      morale: 70,
      techDebt: 0,
      aiDependency: 70,
      aiGuideline: 40,
      onFire: 1,
    };

    expect(computeScores({ ...base, techDebt: 299 }).overall).toBe(811);
    expect(computeScores({ ...base, techDebt: 300 }).overall).toBe(810);
    expect(computeScores({ ...base, techDebt: 301 }).overall).toBe(810);

    expect(computeScores({ ...base, techDebt: 198 }).healthy).toBe(251);
    expect(computeScores({ ...base, techDebt: 199 }).healthy).toBe(250);
    expect(computeScores({ ...base, techDebt: 200 }).healthy).toBe(250);
    expect(computeScores({ ...base, techDebt: 201 }).healthy).toBe(250);

    expect(computeScores({ ...base, aiDependency: 50 }).healthy).toBe(350);
    expect(computeScores({ ...base, aiDependency: 51 }).healthy).toBe(348);
    expect(computeScores({ ...base, aiDependency: 60 }).ai).toBe(620);
    expect(computeScores({ ...base, aiDependency: 61 }).ai).toBe(617);
  });

  it('各スコアの下限を0に丸める', () => {
    expect(
      computeScores({
        shipping: -100,
        morale: -10,
        techDebt: 999,
        aiDependency: 100,
        aiGuideline: -20,
        onFire: 10,
      }),
    ).toEqual({ overall: 0, healthy: 0, ai: 0, growth: 0 });
  });
});

describe('generateIndustry', () => {
  it('種別未指定では総合出荷ランキングを生成する', () => {
    const c = company();
    expect(generateIndustry(c)).toEqual(generateIndustry(c, 'overall'));
    expect(generateIndustry(c).kind).toBe('overall');
  });

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

  it('固定seedからシーズン番号を決定する', () => {
    expect(
      ['a', 'b', 'c', 'd'].map(
        (seed) => generateIndustry(minimalCompany({ seed }), 'overall').season,
      ),
    ).toEqual([2, 3, 4, 1]);
  });

  it('自社順位の百分位境界からリーグを決定する', () => {
    const cases = [
      { shipping: 1590, selfRank: 2, league: 'プラチナリーグ' },
      { shipping: 1580, selfRank: 3, league: 'ゴールドリーグ' },
      { shipping: 1270, selfRank: 5, league: 'ゴールドリーグ' },
      { shipping: 1070, selfRank: 6, league: 'シルバーリーグ' },
      { shipping: 182, selfRank: 9, league: 'シルバーリーグ' },
      { shipping: 181, selfRank: 10, league: 'ブロンズリーグ' },
    ];

    for (const expected of cases) {
      const ind = generateIndustry(minimalCompany({ shipping: expected.shipping }), 'overall');
      expect(ind.total).toBe(12);
      expect(ind.selfRank).toBe(expected.selfRank);
      expect(ind.league).toBe(expected.league);
    }
  });

  it('固定seedから11件のライバルをスナップショット生成する', () => {
    const ind = generateIndustry(minimalCompany({ shipping: 0 }), 'overall');
    const rivals = ind.entries
      .filter((e) => !e.org.isSelf)
      .map((e) => ({
        id: e.org.id,
        name: e.org.name,
        orgType: e.org.orgType,
        healthRank: e.org.healthRank,
        trend: e.org.trend,
        scores: e.org.scores,
      }));

    expect(rivals).toEqual([
      {
        id: 'rival-1',
        name: 'ノヴァソフト',
        orgType: 'AI Overproduction 型',
        healthRank: 'C',
        trend: -1,
        scores: { overall: 1594, healthy: 344, ai: 1000, growth: 879 },
      },
      {
        id: 'rival-10',
        name: 'つばさデータ',
        orgType: 'Documentation Kingdom 型',
        healthRank: 'C',
        trend: -1,
        scores: { overall: 1588, healthy: 279, ai: 1008, growth: 828 },
      },
      {
        id: 'rival-3',
        name: 'クラウドワークス社',
        orgType: 'AI Overproduction 型',
        healthRank: 'A',
        trend: 0,
        scores: { overall: 1566, healthy: 410, ai: 918, growth: 790 },
      },
      {
        id: 'rival-7',
        name: 'すばるテック',
        orgType: 'Rework Spiral 型',
        healthRank: 'B',
        trend: 1,
        scores: { overall: 1275, healthy: 312, ai: 674, growth: 643 },
      },
      {
        id: 'rival-2',
        name: 'みどりデジタル',
        orgType: 'Healthy Acceleration 型',
        healthRank: 'D',
        trend: -1,
        scores: { overall: 1071, healthy: 109, ai: 581, growth: 558 },
      },
      {
        id: 'rival-8',
        name: 'やまびこ工房',
        orgType: 'Rework Spiral 型',
        healthRank: 'D',
        trend: 1,
        scores: { overall: 342, healthy: 205, ai: 536, growth: 326 },
      },
      {
        id: 'rival-4',
        name: 'ハヤテ開発',
        orgType: 'Documentation Kingdom 型',
        healthRank: 'C',
        trend: 1,
        scores: { overall: 239, healthy: 284, ai: 423, growth: 263 },
      },
      {
        id: 'rival-9',
        name: 'あおぞらAI',
        orgType: 'Healthy Acceleration 型',
        healthRank: 'D',
        trend: -1,
        scores: { overall: 210, healthy: 185, ai: 326, growth: 236 },
      },
      {
        id: 'rival-6',
        name: 'こだまシステムズ',
        orgType: 'Senior Sacrifice 型',
        healthRank: 'D',
        trend: 1,
        scores: { overall: 182, healthy: 117, ai: 150, growth: 164 },
      },
      {
        id: 'rival-0',
        name: 'アサヒ技研',
        orgType: 'Healthy Acceleration 型',
        healthRank: 'D',
        trend: 1,
        scores: { overall: 172, healthy: 124, ai: 304, growth: 202 },
      },
      {
        id: 'rival-5',
        name: 'うみねこラボ',
        orgType: 'Rework Spiral 型',
        healthRank: 'D',
        trend: 0,
        scores: { overall: 8, healthy: 270, ai: 218, growth: 242 },
      },
    ]);

    expect(new Set(rivals.map((r) => r.id)).size).toBe(11);
    for (const rival of rivals) {
      expect(rival.trend).toBeGreaterThanOrEqual(-1);
      expect(rival.trend).toBeLessThanOrEqual(1);
      expect(rival.scores.overall).toBeGreaterThanOrEqual(0);
      expect(rival.scores.overall).toBeLessThanOrEqual(1800);
      expect(rival.scores.healthy).toBeGreaterThanOrEqual(0);
      expect(rival.scores.healthy).toBeLessThanOrEqual(450);
      expect(rival.scores.ai).toBeGreaterThanOrEqual(0);
      expect(rival.scores.ai).toBeLessThanOrEqual(1200);
      expect(rival.scores.growth).toBeGreaterThanOrEqual(0);
      expect(rival.scores.growth).toBeLessThanOrEqual(900);
    }
  });

  it('同点では自社を先に置き、ライバル同士はid昇順にする', () => {
    const ind = generateIndustry(minimalCompany({ seed: 'tie-10', shipping: 966 }), 'overall');

    expect(ind.selfRank).toBe(7);
    expect(
      ind.entries.slice(6, 9).map((e) => ({
        id: e.org.id,
        overall: e.org.scores.overall,
        isSelf: e.org.isSelf,
      })),
    ).toEqual([
      { id: 'self', overall: 966, isSelf: true },
      { id: 'rival-10', overall: 966, isSelf: false },
      { id: 'rival-6', overall: 966, isSelf: false },
    ]);
  });
});

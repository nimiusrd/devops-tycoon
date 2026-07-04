/**
 * 組織スケール集約・生成・レバーの決定論検証（SPEC 第4.7〜4.9 / 第22.3）。
 */
import { describe, expect, it } from 'vitest';
import { DEPARTMENT_DEFS } from '../../src/data/departments';
import { COMPANY_LEVERS, DEPARTMENT_LEVERS, LEVER_DEFS } from '../../src/data/levers';
import {
  aggregateDepartment,
  aggregateHealth,
  applyLever,
  companyScore,
  emptyAdjustState,
  generateOrgScale,
  healthRank,
  isOnFire,
  teamHealth,
  type OrgScaleInput,
  type Team,
} from '../../src/sim/orgscale';
import type { OrgState } from '../../src/sim/types';
import type { RunTotals } from '../../src/sim/run/types';
import {
  applyLeverOnBaseline,
  assertAllLeverImpactRanges,
  assertDepartmentLeverIsolated,
  assertLeverDefInRange,
  assertOrgScaleHealthy,
} from './helpers/leverRanges';

const RI16_SEEDS = ['ri16-a', 'ri16-b', 'ri16-c'] as const;

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
    deliveryScore: 600,
    ...overrides,
  };
}

function totals(overrides: Partial<RunTotals> = {}): RunTotals {
  return {
    delivered: 600,
    done: 60,
    rework: 10,
    incidents: 3,
    contained: 2,
    spread: 1,
    aiAssisted: 20,
    completed: 60,
    reviewQueuePeak: 4,
    maxCombo: 6,
    ...overrides,
  };
}

function input(overrides: Partial<OrgScaleInput> = {}): OrgScaleInput {
  return {
    seed: 'org-test',
    org: org(),
    totals: totals(),
    diagnosis: 'healthyAcceleration',
    budget: 100,
    ...overrides,
  };
}

describe('teamHealth', () => {
  it('炎上 or 長い行列は reviewHell', () => {
    expect(teamHealth({ reviewQueue: 0, incidents: 2, aiDependency: 10 })).toBe('reviewHell');
    expect(teamHealth({ reviewQueue: 12, incidents: 0, aiDependency: 10 })).toBe('reviewHell');
  });
  it('中程度の行列 or AI過依存は congested', () => {
    expect(teamHealth({ reviewQueue: 6, incidents: 0, aiDependency: 10 })).toBe('congested');
    expect(teamHealth({ reviewQueue: 0, incidents: 0, aiDependency: 70 })).toBe('congested');
  });
  it('それ以外は healthy', () => {
    expect(teamHealth({ reviewQueue: 1, incidents: 0, aiDependency: 30 })).toBe('healthy');
  });
});

describe('isOnFire', () => {
  it('Review Hell でなくても未鎮火インシデントを抱えるチームは炎上と数える', () => {
    expect(isOnFire({ health: 'healthy', incidents: 1 })).toBe(true);
    expect(isOnFire({ health: 'congested', incidents: 0 })).toBe(false);
    expect(isOnFire({ health: 'reviewHell', incidents: 0 })).toBe(true);
  });

  it('集約の炎上数は health ラベルだけでなくインシデント保有チームも含む', () => {
    const teams: Team[] = [
      makeTeam({ id: 'a', health: 'healthy', incidents: 1 }),
      makeTeam({ id: 'b', health: 'congested', incidents: 0 }),
    ];
    expect(aggregateDepartment(DEPARTMENT_DEFS[0], teams).onFire).toBe(1);
  });
});

describe('aggregateHealth', () => {
  it('炎上チームが 1/3 以上なら全体を reviewHell に見せる', () => {
    const teams = [{ health: 'reviewHell' }, { health: 'healthy' }, { health: 'healthy' }] as const;
    expect(aggregateHealth([...teams])).toBe('reviewHell');
  });
  it('空なら healthy', () => {
    expect(aggregateHealth([])).toBe('healthy');
  });
});

describe('healthRank / companyScore', () => {
  it('健全（高士気・低負債・低AI依存）ほど良いランク', () => {
    expect(healthRank({ morale: 95, techDebt: 0, aiDependency: 20 })).toBe('S');
    expect(healthRank({ morale: 10, techDebt: 200, aiDependency: 95 })).toBe('D');
  });
  it('炎上・負債で出荷スコアが下がる', () => {
    const clean = companyScore({ shipping: 1000, onFire: 0, techDebt: 0 });
    const messy = companyScore({ shipping: 1000, onFire: 3, techDebt: 200 });
    expect(messy).toBeLessThan(clean);
    expect(companyScore({ shipping: 0, onFire: 5, techDebt: 500 })).toBe(0);
  });
});

describe('aggregateDepartment', () => {
  it('出荷を合算し、行列からレビュー耐性を導出する', () => {
    const teams: Team[] = [
      makeTeam({ shipping: 100, reviewQueue: 0, health: 'healthy' }),
      makeTeam({ shipping: 200, reviewQueue: 0, health: 'reviewHell' }),
    ];
    const dept = aggregateDepartment(DEPARTMENT_DEFS[0], teams);
    expect(dept.shipping).toBe(300);
    expect(dept.onFire).toBe(1);
    expect(dept.reviewResilience).toBe(100); // 行列 0 → 耐性最大
  });
});

describe('generateOrgScale', () => {
  it('同じ入力からは同一の全社状態を生成する（決定論）', () => {
    const a = generateOrgScale(input());
    const b = generateOrgScale(input());
    expect(a).toEqual(b);
  });

  it('プレイヤーチームが実ランの現場を映す', () => {
    const state = generateOrgScale(input({ org: org({ deliveryScore: 1234, morale: 42 }) }));
    const player = state.departments.flatMap((d) => d.teams).find((t) => t.isPlayer)!;
    expect(player).toBeDefined();
    expect(player.shipping).toBe(1234);
    expect(player.morale).toBe(42);
  });

  it('部門は定義どおりに構成され、全社HUDが集約される', () => {
    const state = generateOrgScale(input());
    expect(state.deptCount).toBe(DEPARTMENT_DEFS.length);
    const teamSum = state.departments.reduce((a, d) => a + d.teams.length, 0);
    expect(state.teamCount).toBe(teamSum);
    expect(state.engineers).toBeGreaterThan(0);
  });

  it('基盤ブーストは共通基盤と全社へ波及する', () => {
    const base = generateOrgScale(input());
    const boosted = generateOrgScale(
      input({
        adjust: {
          company: { ...emptyAdjustState().company, aiDependencyDelta: -20, infraBoost: 20 },
          byDept: {},
        },
      }),
    );
    expect(boosted.infra.aiGuideline).toBeGreaterThan(base.infra.aiGuideline);
    expect(boosted.aiDependency).toBeLessThan(base.aiDependency);
  });

  it('スプリント中の現在行列(liveReviewQueue)を畳み込み、累積ピークより優先する', () => {
    const base = generateOrgScale(input({ totals: totals({ reviewQueuePeak: 0 }) }));
    const live = generateOrgScale(
      input({ totals: totals({ reviewQueuePeak: 0 }), liveReviewQueue: 14 }),
    );
    const playerOf = (s: ReturnType<typeof generateOrgScale>) =>
      s.departments.flatMap((d) => d.teams).find((t) => t.isPlayer)!;
    expect(playerOf(base).reviewQueue).toBe(0);
    expect(playerOf(live).reviewQueue).toBe(14);
    // 行列 14 → Review Hell（炎上）として現場が映る。
    expect(playerOf(live).health).toBe('reviewHell');
  });

  it('採用ドラフト(extraTeams)で先頭部門のチームが増える', () => {
    const base = generateOrgScale(input());
    const more = generateOrgScale(
      input({
        adjust: { company: { ...emptyAdjustState().company, extraTeams: 2 }, byDept: {} },
      }),
    );
    expect(more.teamCount).toBe(base.teamCount + 2);
  });
});

describe('applyLever', () => {
  it('全社レバーは予算を引いて全社調整を積む', () => {
    const res = applyLever(emptyAdjustState(), 100, 'aiGuideline');
    expect(res.changed).toBe(true);
    expect(res.budget).toBe(75); // cost 25
    expect(res.adjust.company.aiDependencyDelta).toBe(-10);
  });

  it('予算不足は変化なし', () => {
    const res = applyLever(emptyAdjustState(), 5, 'aiGuideline');
    expect(res.changed).toBe(false);
    expect(res.budget).toBe(5);
  });

  it('部門レバーは deptId 必須で、部門スコープに積む', () => {
    const noDept = applyLever(emptyAdjustState(), 100, 'reviewReinforce');
    expect(noDept.changed).toBe(false);
    const ok = applyLever(emptyAdjustState(), 100, 'reviewReinforce', 'product');
    expect(ok.changed).toBe(true);
    expect(ok.adjust.byDept.product.reviewQueueDelta).toBe(-4);
  });

  it('全社レバーに deptId を渡すと拒否（スコープ不一致）', () => {
    const res = applyLever(emptyAdjustState(), 100, 'aiGuideline', 'product');
    expect(res.changed).toBe(false);
  });

  it('未知のレバーは変化なし', () => {
    const res = applyLever(emptyAdjustState(), 100, 'nope');
    expect(res.changed).toBe(false);
  });
});

describe('レバー係数の許容レンジ（RI-16）', () => {
  const baselineFactory = (seed: string) =>
    input({
      seed,
      budget: 120,
      org: org({ aiDependency: 55, morale: 65, techDebt: 45 }),
      totals: totals({ reviewQueuePeak: 6, incidents: 2, contained: 1 }),
    });

  it('全レバーの cost / 効果量が定義レンジ内', () => {
    for (const lever of LEVER_DEFS) {
      expect(() => assertLeverDefInRange(lever)).not.toThrow();
    }
  });

  it('全社レバー適用後も集約指標が健全範囲内', () => {
    for (const lever of COMPANY_LEVERS) {
      for (const seed of RI16_SEEDS) {
        expect(() => applyLeverOnBaseline(lever, baselineFactory(seed))).not.toThrow();
      }
    }
  });

  it('部門レバー適用後も集約指標が健全範囲内', () => {
    for (const lever of DEPARTMENT_LEVERS) {
      for (const seed of RI16_SEEDS) {
        expect(() =>
          applyLeverOnBaseline(lever, baselineFactory(seed), DEPARTMENT_DEFS[0].id),
        ).not.toThrow();
      }
    }
  });

  it('部門レバーは対象部門以外へ波及しない', () => {
    for (const lever of DEPARTMENT_LEVERS) {
      expect(() =>
        assertDepartmentLeverIsolated(
          lever,
          baselineFactory('ri16-isolation'),
          DEPARTMENT_DEFS[0].id,
          DEPARTMENT_DEFS[1].id,
        ),
      ).not.toThrow();
    }
  });

  it('代表 seed 群で全 12 レバーの主効果が許容レンジ内', () => {
    expect(() => assertAllLeverImpactRanges(RI16_SEEDS, baselineFactory)).not.toThrow();
  });

  it('stress baseline でも全社レバー適用後に指標が破綻しない', () => {
    const stressed = input({
      seed: 'ri16-stress',
      budget: 120,
      org: org({ aiDependency: 78, morale: 35, techDebt: 90 }),
      totals: totals({ reviewQueuePeak: 14, incidents: 4, contained: 1 }),
      liveReviewQueue: 14,
      liveIncidents: 2,
    });
    const baseState = generateOrgScale(stressed);
    assertOrgScaleHealthy(baseState, 'stress-baseline');

    for (const lever of COMPANY_LEVERS) {
      const { state } = applyLeverOnBaseline(lever, stressed);
      assertOrgScaleHealthy(state, `stress/${lever.id}`);
    }
  });
});

function makeTeam(overrides: Partial<Team>): Team {
  return {
    id: 't',
    deptId: 'product',
    name: 'チームA',
    gridX: 0,
    gridY: 0,
    shipping: 100,
    aiDependency: 50,
    reviewQueue: 2,
    incidents: 0,
    morale: 70,
    techDebt: 10,
    engineers: 5,
    health: 'healthy',
    isPlayer: false,
    ...overrides,
  };
}

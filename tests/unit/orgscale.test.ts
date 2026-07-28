/**
 * 組織スケール集約・生成・レバーの決定論検証（SPEC 第4.7〜4.9 / 第22.3）。
 */
import { describe, expect, it } from 'vitest';
import { DEPARTMENT_DEFS } from '../../src/data/departments';
import { COMPANY_LEVERS, DEPARTMENT_LEVERS, LEVER_DEFS } from '../../src/data/levers';
import {
  aggregateDepartment,
  aggregateHealth,
  appendTeamsToDept,
  applyLever,
  companyScore,
  emptyAdjustState,
  estimateRivalAiAssigned,
  estimateRosterCoderCount,
  generateOrgScale,
  healthRank,
  HOME_TEAM_ID,
  initTeamRunStates,
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

  it('playerEngineers / playerAiAssigned をプレイヤー島へ載せる（RI-27）', () => {
    const state = generateOrgScale(input({ playerEngineers: 4, playerAiAssigned: 2 }));
    const player = state.departments.flatMap((d) => d.teams).find((t) => t.isPlayer)!;
    expect(player.engineers).toBe(4);
    expect(player.aiAssignedCount).toBe(2);
    // 全社 engineers は各チーム合算で、プレイヤー分も含まれる。
    expect(state.engineers).toBeGreaterThanOrEqual(4);
  });

  it('ライバルの aiAssignedCount はコーダー数×aiDependency から推定する（RI-27 / RI-64）', () => {
    expect(estimateRivalAiAssigned(5, 60)).toBe(3);
    expect(estimateRivalAiAssigned(3, 10)).toBe(0);
    expect(estimateRosterCoderCount(6)).toBe(3);
    const state = generateOrgScale(input({ playerEngineers: 5, playerAiAssigned: 0 }));
    const rivals = state.departments.flatMap((d) => d.teams).filter((t) => !t.isPlayer);
    for (const t of rivals) {
      expect(t.aiAssignedCount).toBe(
        estimateRivalAiAssigned(estimateRosterCoderCount(t.engineers), t.aiDependency),
      );
    }
  });

  it('ライバル生成の乱数消費順を維持し、固定 seed の既存指標を変えない（RI-27）', () => {
    // engineers draw を shipping より前に移すと、以下の全指標がずれる。
    const state = generateOrgScale(input({ seed: 'org-rng-order' }));
    const rival = state.departments.flatMap((d) => d.teams).find((t) => t.id === 'product-t1')!;
    expect(rival).toMatchObject({
      aiDependency: 30,
      reviewQueue: 1,
      incidents: 1,
      morale: 50,
      techDebt: 68,
      shipping: 496,
      engineers: 8,
    });
    // ロスター上限6・コーダー3 × 依存度30% → 1
    expect(rival.aiAssignedCount).toBe(estimateRivalAiAssigned(estimateRosterCoderCount(8), 30));
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

  it('累積インシデントから未鎮火分だけをホームチームへ初期反映する', () => {
    const state = generateOrgScale(input({ totals: totals({ incidents: 7, contained: 4 }) }));
    const player = state.departments.flatMap((d) => d.teams).find((t) => t.isPlayer)!;

    expect(player.incidents).toBe(3);
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

  it('採用ドラフト(extraTeams)は product 部門の既存数に続く ID で追加する', () => {
    const state = generateOrgScale(
      input({
        seed: 'ri72-e1-extra-ids',
        adjust: { company: { ...emptyAdjustState().company, extraTeams: 2 }, byDept: {} },
      }),
    );
    const productIds = state.departments
      .find((d) => d.def.id === 'product')!
      .teams.map((t) => t.id);

    expect(productIds).toEqual([
      'product-t0',
      'product-t1',
      'product-t2',
      'product-t3',
      'product-t4',
      'product-t5',
    ]);
  });

  it('採用ドラフト(extraTeams)は homeTeamId の既存チームをテンプレートにする', () => {
    const seed = 'ri72-e1-extra-template';
    const orgState = org({ deliveryScore: 950, morale: 63, techDebt: 45, aiDependency: 38 });
    const runTotals = totals({ reviewQueuePeak: 5, incidents: 4, contained: 1 });
    const baseTeams = initTeamRunStates({
      seed,
      org: orgState,
      homeEngineers: 5,
      homeReviewQueue: runTotals.reviewQueuePeak,
      homeIncidents: runTotals.incidents - runTotals.contained,
    });
    const template = baseTeams.find((t) => t.id === 'platform-t1')!;
    const expectedAdded = appendTeamsToDept(baseTeams, {
      seed,
      deptId: 'product',
      count: 1,
      template,
      nextIndexStart: baseTeams.filter((t) => t.deptId === 'product').length,
    }).find((t) => t.id === 'product-t4')!;

    const state = generateOrgScale(
      input({
        seed,
        org: orgState,
        totals: runTotals,
        homeTeamId: 'platform-t1',
        adjust: { company: { ...emptyAdjustState().company, extraTeams: 1 }, byDept: {} },
      }),
    );
    const added = state.departments
      .find((d) => d.def.id === 'product')!
      .teams.find((t) => t.id === 'product-t4')!;

    expect(added).toMatchObject({
      aiDependency: expectedAdded.aiDependency,
      reviewQueue: expectedAdded.reviewQueue,
      incidents: expectedAdded.incidents,
      morale: expectedAdded.morale,
      techDebt: expectedAdded.techDebt,
      shipping: expectedAdded.shipping,
      engineers: expectedAdded.engineers,
    });
  });

  it('teams 指定時は homeTeamId を既定のアクティブチームとして投影する', () => {
    const teams = initTeamRunStates({
      seed: 'ri72-e1-teams',
      org: org({ deliveryScore: 900, morale: 60 }),
      homeEngineers: 5,
    });

    const state = generateOrgScale(
      input({
        teams,
        homeTeamId: 'platform-t1',
        org: org({ deliveryScore: 1350, morale: 48, techDebt: 77, aiDependency: 34 }),
        playerEngineers: 7,
        playerAiAssigned: 3,
      }),
    );
    const flattened = state.departments.flatMap((d) => d.teams);
    const defaultHome = flattened.find((t) => t.id === HOME_TEAM_ID)!;
    const activeHome = flattened.find((t) => t.id === 'platform-t1')!;

    expect(state.teamCount).toBe(teams.length);
    expect(defaultHome.isActive).toBe(false);
    expect(defaultHome.isPlayer).toBe(false);
    expect(activeHome).toMatchObject({
      isActive: true,
      isPlayer: true,
      shipping: 1350,
      morale: 48,
      techDebt: 77,
      aiDependency: 34,
      engineers: 7,
      aiAssignedCount: 3,
    });
  });

  it('teams 指定時は activeTeamId が homeTeamId より優先され、extraTeams を追加しない', () => {
    const teams = initTeamRunStates({
      seed: 'ri72-e1-active',
      org: org({ deliveryScore: 800, morale: 55 }),
      homeEngineers: 4,
      homeReviewQueue: 2,
      homeIncidents: 1,
    }).map((team) => (team.id === 'newbiz-t2' ? { ...team, reviewQueue: 11, incidents: 4 } : team));
    const state = generateOrgScale(
      input({
        teams,
        homeTeamId: 'platform-t1',
        activeTeamId: 'newbiz-t2',
        adjust: { company: { ...emptyAdjustState().company, extraTeams: 3 }, byDept: {} },
        org: org({ deliveryScore: 2222, morale: 39 }),
        playerEngineers: 6,
        playerAiAssigned: 2,
      }),
    );
    const flattened = state.departments.flatMap((d) => d.teams);
    const home = flattened.find((t) => t.id === 'platform-t1')!;
    const active = flattened.find((t) => t.id === 'newbiz-t2')!;

    expect(state.teamCount).toBe(teams.length);
    expect(state.departments.find((d) => d.def.id === 'product')!.teams).toHaveLength(
      teams.filter((t) => t.deptId === 'product').length,
    );
    expect(home.isActive).toBe(false);
    expect(home.isPlayer).toBe(false);
    expect(active).toMatchObject({
      isActive: true,
      isPlayer: true,
      shipping: 2222,
      morale: 39,
      reviewQueue: 11,
      incidents: 4,
      engineers: 6,
      aiAssignedCount: 2,
    });
  });

  it('teams 指定時に activeTeamId が存在しなくても投影できる', () => {
    const teams = initTeamRunStates({
      seed: 'ri72-e1-missing-active',
      org: org(),
      homeEngineers: 5,
    });

    const state = generateOrgScale(input({ teams, activeTeamId: 'missing-team' }));

    expect(state.teamCount).toBe(teams.length);
    expect(state.departments.flatMap((d) => d.teams).filter((t) => t.isActive)).toHaveLength(0);
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
        for (const dept of DEPARTMENT_DEFS) {
          expect(() => applyLeverOnBaseline(lever, baselineFactory(seed), dept.id)).not.toThrow();
        }
      }
    }
  });

  it('部門レバーは対象部門以外へ波及しない', () => {
    for (const lever of DEPARTMENT_LEVERS) {
      for (const target of DEPARTMENT_DEFS) {
        expect(() =>
          assertDepartmentLeverIsolated(lever, baselineFactory('ri16-isolation'), target.id),
        ).not.toThrow();
      }
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
    aiAssignedCount: 0,
    health: 'healthy',
    isPlayer: false,
    isActive: false,
    ...overrides,
  };
}

/**
 * RI-91-C1: src/sim/orgscale/aggregate.ts / levers.ts の Survived / 境界 mutation を潰す。
 * 共有の orgscale テストは触らず、単位専用ファイルで exact 断言する。
 */
import { describe, expect, it } from 'vitest';
import { DEPARTMENT_DEFS } from '../../src/data/departments';
import {
  aggregateCompany,
  aggregateDepartment,
  aggregateHealth,
  applyLever,
  companyScore,
  emptyAdjust,
  healthRank,
  mergeAdjust,
  teamHealth,
  type OrgAdjust,
  type Team,
} from '../../src/sim/orgscale';

const makeTeam = (overrides: Partial<Team> = {}): Team => ({
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
});

describe('RI-91-C1 orgscale aggregate/levers survived mutants', () => {
  describe('teamHealth queue / incident 境界', () => {
    it('reviewHell は incidents>=2 または reviewQueue>=12（直前は別ランク）', () => {
      expect(teamHealth({ reviewQueue: 0, incidents: 2, aiDependency: 10 })).toBe('reviewHell');
      expect(teamHealth({ reviewQueue: 12, incidents: 0, aiDependency: 10 })).toBe('reviewHell');
      // 直前: incidents=1 かつ queue<6 → healthy（>=2 / >=12 の Equality を殺す）
      expect(teamHealth({ reviewQueue: 0, incidents: 1, aiDependency: 10 })).toBe('healthy');
      expect(teamHealth({ reviewQueue: 11, incidents: 0, aiDependency: 10 })).toBe('congested');
    });

    it('congested は reviewQueue>=6 または aiDependency>=70（直前は healthy）', () => {
      expect(teamHealth({ reviewQueue: 6, incidents: 0, aiDependency: 10 })).toBe('congested');
      expect(teamHealth({ reviewQueue: 0, incidents: 0, aiDependency: 70 })).toBe('congested');
      expect(teamHealth({ reviewQueue: 5, incidents: 0, aiDependency: 10 })).toBe('healthy');
      expect(teamHealth({ reviewQueue: 0, incidents: 0, aiDependency: 69 })).toBe('healthy');
    });
  });

  describe('healthRank index 境界', () => {
    // techDebt 係数 0.25 で整数境界を作り、morale/0.6 の浮動小数点誤差を避ける
    it.each([
      { morale: 100, techDebt: 20, expected: 'S', note: 'index=55 ちょうど' },
      { morale: 100, techDebt: 21, expected: 'A', note: 'index=54.75 → A' },
      { morale: 100, techDebt: 80, expected: 'A', note: 'index=40 ちょうど' },
      { morale: 100, techDebt: 81, expected: 'B', note: 'index=39.75 → B' },
      { morale: 50, techDebt: 20, expected: 'B', note: 'index=25 ちょうど' },
      { morale: 50, techDebt: 21, expected: 'C', note: 'index=24.75 → C' },
      { morale: 50, techDebt: 80, expected: 'C', note: 'index=10 ちょうど' },
      { morale: 50, techDebt: 81, expected: 'D', note: 'index=9.75 → D' },
    ] as const)('$note → $expected', ({ morale, techDebt, expected }) => {
      expect(healthRank({ morale, techDebt, aiDependency: 50 })).toBe(expected);
    });
  });

  describe('aggregateHealth worst>=2', () => {
    it('炎上比率が 1/3 未満でも worst が reviewHell なら congested', () => {
      // fireRatio = 1/4 < 1/3、worst = 2 → congested（>=2 を >2 にすると落ちる）
      const teams = [
        { health: 'reviewHell' as const },
        { health: 'healthy' as const },
        { health: 'healthy' as const },
        { health: 'healthy' as const },
      ];
      expect(aggregateHealth(teams)).toBe('congested');
    });

    it('worst が congested(1) のみなら congested（配列 index 経路）', () => {
      expect(aggregateHealth([{ health: 'congested' }, { health: 'healthy' }])).toBe('congested');
    });
  });

  describe('reviewResilience / companyScore exact', () => {
    it('行列平均から reviewResilience = clamp(round(100 - queue*6), 0, 100) を固定する', () => {
      // queue avg = 10 → 100 - 60 = 40（+ や / 置換を殺す）
      const dept = aggregateDepartment(DEPARTMENT_DEFS[0], [
        makeTeam({ id: 'a', reviewQueue: 10, health: 'congested' }),
      ]);
      expect(dept.reviewResilience).toBe(40);

      // 2 チーム平均 queue=5 → 100 - 30 = 70
      // aiDependency / morale もチーム値を読む（map Arrow→undefined を殺す）
      const avgDept = aggregateDepartment(DEPARTMENT_DEFS[0], [
        makeTeam({ id: 'a', reviewQueue: 8, aiDependency: 20, morale: 40 }),
        makeTeam({ id: 'b', reviewQueue: 2, aiDependency: 80, morale: 80 }),
      ]);
      expect(avgDept.reviewResilience).toBe(70);
      expect(avgDept.aiDependency).toBe(50);
      expect(avgDept.morale).toBe(60);
    });

    it('companyScore の炎上・負債係数を exact で固定する', () => {
      // 1000 - 3*40 - min(300,200)*0.5 = 1000 - 120 - 100 = 780
      expect(companyScore({ shipping: 1000, onFire: 3, techDebt: 200 })).toBe(780);
      // techDebt は 300 で頭打ち: 1000 - 0 - 150 = 850
      expect(companyScore({ shipping: 1000, onFire: 0, techDebt: 400 })).toBe(850);
      // 負値は 0 に床
      expect(companyScore({ shipping: 10, onFire: 5, techDebt: 0 })).toBe(0);
    });

    it('aggregateCompany は集約指標から healthRank / score を載せる', () => {
      const dept = aggregateDepartment(DEPARTMENT_DEFS[0], [
        makeTeam({
          id: 'a',
          shipping: 500,
          morale: 95,
          techDebt: 0,
          aiDependency: 50,
          health: 'healthy',
        }),
      ]);
      const company = aggregateCompany([dept], {
        seed: 'c1',
        budget: 100,
        diagnosis: 'healthyAcceleration',
        infra: { ci: 0, docs: 0, aiGuideline: 0 },
      });
      expect(company.score).toBe(companyScore({ shipping: 500, onFire: 0, techDebt: 0 }));
      expect(company.healthRank).toBe(healthRank({ morale: 95, techDebt: 0, aiDependency: 50 }));
      expect(company.healthRank).toBe('S');
    });
  });

  describe('mergeAdjust 全フィールド加算', () => {
    it('7 フィールドすべてを加算合成する', () => {
      const a: OrgAdjust = {
        aiDependencyDelta: 1,
        reviewQueueDelta: 2,
        incidentDelta: 3,
        moraleDelta: 4,
        techDebtDelta: 5,
        extraTeams: 6,
        infraBoost: 7,
      };
      const b: OrgAdjust = {
        aiDependencyDelta: 10,
        reviewQueueDelta: 20,
        incidentDelta: 30,
        moraleDelta: 40,
        techDebtDelta: 50,
        extraTeams: 60,
        infraBoost: 70,
      };
      expect(mergeAdjust(a, b)).toEqual({
        aiDependencyDelta: 11,
        reviewQueueDelta: 22,
        incidentDelta: 33,
        moraleDelta: 44,
        techDebtDelta: 55,
        extraTeams: 66,
        infraBoost: 77,
      });
      // 片方ゼロでも相手側が残る（減算置換の再発防止）
      expect(mergeAdjust(a, emptyAdjust())).toEqual(a);
      expect(mergeAdjust(emptyAdjust(), b)).toEqual(b);
    });
  });

  describe('applyLever team scope', () => {
    const seededAdjust = {
      company: emptyAdjust(),
      byDept: {
        product: { ...emptyAdjust(), reviewQueueDelta: -3 },
      },
      byTeam: {
        'keep-me': { ...emptyAdjust(), moraleDelta: 9 },
      },
    };

    it('team レバー成功時は予算だけ減らし byTeam に効果を積まない', () => {
      const res = applyLever(seededAdjust, 100, 'teamAiThrottle', undefined, 'product-t0');
      expect(res.changed).toBe(true);
      expect(res.cost).toBe(5);
      expect(res.budget).toBe(95);
      expect(res.extraTeamsAdded).toBe(0);
      expect(res.teamId).toBe('product-t0');
      // 呼び出し側が TeamRunState へ直接適用するため、byTeam に効果キーを増やさない
      expect(res.adjust.byTeam).toEqual(seededAdjust.byTeam);
      expect(Object.keys(res.adjust.byTeam!)).toEqual(['keep-me']);
      expect(res.adjust.byDept).toEqual(seededAdjust.byDept);
      expect(res.adjust.company).toEqual(seededAdjust.company);
    });

    it('teamId 無し / team+deptId / department+teamId は変化なし', () => {
      const noTeam = applyLever(seededAdjust, 100, 'teamAiThrottle');
      expect(noTeam).toEqual({
        adjust: seededAdjust,
        budget: 100,
        changed: false,
        cost: 0,
        extraTeamsAdded: 0,
      });

      const teamWithDept = applyLever(seededAdjust, 100, 'teamAiThrottle', 'product', 'product-t0');
      expect(teamWithDept.changed).toBe(false);
      expect(teamWithDept.budget).toBe(100);
      expect(teamWithDept.adjust).toBe(seededAdjust);

      const deptWithTeam = applyLever(
        seededAdjust,
        100,
        'reviewReinforce',
        'product',
        'product-t0',
      );
      expect(deptWithTeam.changed).toBe(false);
      expect(deptWithTeam.budget).toBe(100);
      expect(deptWithTeam.adjust).toBe(seededAdjust);
    });

    it('department レバー成功時は予算 exact 減算と byDept 蓄積、byTeam 保持', () => {
      const res = applyLever(seededAdjust, 100, 'reviewReinforce', 'product');
      expect(res.changed).toBe(true);
      expect(res.budget).toBe(100 - 12);
      expect(res.adjust.byTeam).toEqual(seededAdjust.byTeam);
      expect(res.adjust.byDept.product.reviewQueueDelta).toBe(-3 + -4);
    });

    it('company レバー成功時は既存 byDept / byTeam を保持する', () => {
      const res = applyLever(seededAdjust, 100, 'aiGuideline');
      expect(res.changed).toBe(true);
      expect(res.budget).toBe(75);
      expect(res.adjust.company.aiDependencyDelta).toBe(-10);
      expect(res.adjust.company.infraBoost).toBe(6);
      // byDept: {} 置換を殺す
      expect(res.adjust.byDept).toEqual(seededAdjust.byDept);
      expect(res.adjust.byTeam).toEqual(seededAdjust.byTeam);
    });
  });
});

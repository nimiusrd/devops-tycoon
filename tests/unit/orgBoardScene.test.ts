/**
 * 全社マップ等角盤面のシーン計画検証（RI-01 / SPEC 第22.5）。
 */
import { describe, expect, it } from 'vitest';
import { emptyAdjustState } from '../../src/sim/orgscale/levers';
import { generateOrgScale } from '../../src/sim/orgscale';
import type { OrgScaleInput } from '../../src/sim/orgscale/generate';
import type { OrgState } from '../../src/sim/types';
import type { RunTotals } from '../../src/sim/run/types';
import {
  ISLAND_ACTOR_HALF_H,
  ISLAND_MARGIN,
  MIN_ISLAND_SPACING_X,
  MIN_ISLAND_SPACING_Y,
  ORG_VIEW,
  isInOrgView,
  islandDepth,
  islandMood,
  planOrgBoardScene,
  teamDesignPosition,
} from '../../src/render/orgBoardScene';

function orgScaleInput(seed: string, overrides: Partial<OrgScaleInput> = {}): OrgScaleInput {
  const org: OrgState = {
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
  };
  const totals: RunTotals = {
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
  };
  return { seed, org, totals, diagnosis: 'healthyAcceleration', budget: 100, ...overrides };
}

describe('planOrgBoardScene (RI-01)', () => {
  it('部門数ぶんの zone と zoneLabel を生成する', () => {
    const org = generateOrgScale(orgScaleInput('ri01-zones'));
    const scene = planOrgBoardScene(org);
    expect(scene.zones).toHaveLength(org.deptCount);
    expect(scene.zoneLabels).toHaveLength(org.deptCount);
    expect(scene.zones.map((z) => z.deptId)).toEqual(org.departments.map((d) => d.def.id));
  });

  it('全チームぶんの island を生成する', () => {
    const org = generateOrgScale(orgScaleInput('ri01-islands'));
    const scene = planOrgBoardScene(org);
    expect(scene.islands).toHaveLength(org.teamCount);
    expect(new Set(scene.islands.map((i) => i.teamId)).size).toBe(org.teamCount);
  });

  it('島の設計座標が ORG_VIEW 範囲内', () => {
    const org = generateOrgScale(orgScaleInput('ri01-bounds'));
    const scene = planOrgBoardScene(org);
    const maxY = ORG_VIEW.h - ISLAND_ACTOR_HALF_H - ISLAND_MARGIN;
    for (const island of scene.islands) {
      expect(isInOrgView(island.x, island.y)).toBe(true);
      expect(island.y).toBeLessThanOrEqual(maxY);
      expect(isInOrgView(island.badge.x, island.badge.y)).toBe(true);
    }
    expect(isInOrgView(scene.hub.x, scene.hub.y)).toBe(true);
  });

  it('platform 部門の島も盤面下端で切れない', () => {
    const org = generateOrgScale(orgScaleInput('ri01-platform'));
    const scene = planOrgBoardScene(org);
    const platformIslands = scene.islands.filter((i) => i.team.deptId === 'platform');
    expect(platformIslands.length).toBe(3);
    const maxY = ORG_VIEW.h - ISLAND_ACTOR_HALF_H - ISLAND_MARGIN;
    for (const island of platformIslands) {
      expect(island.y).toBeLessThanOrEqual(maxY);
    }
  });

  it('画家順 depth は 1..99 の帯に収まり y で単調非減少', () => {
    const org = generateOrgScale(orgScaleInput('ri01-depth'));
    const scene = planOrgBoardScene(org);
    for (const island of scene.islands) {
      expect(island.depth).toBeGreaterThanOrEqual(1);
      expect(island.depth).toBeLessThanOrEqual(99);
    }
    for (let i = 1; i < scene.islands.length; i += 1) {
      expect(scene.islands[i].depth).toBeGreaterThanOrEqual(scene.islands[i - 1].depth);
    }
  });

  it('炎上・Review Hell で flow が hot になり island mood が panic', () => {
    const org = generateOrgScale(
      orgScaleInput('ri01-hot', {
        org: {
          aiEnabled: true,
          aiDependency: 95,
          aiLiteracy: 30,
          testCoverage: 20,
          documentation: 20,
          quality: 30,
          morale: 20,
          seniorHp: 30,
          techDebt: 200,
          deliveryScore: 100,
        },
        totals: {
          delivered: 100,
          done: 20,
          rework: 30,
          incidents: 8,
          contained: 1,
          spread: 7,
          aiAssisted: 15,
          completed: 20,
          reviewQueuePeak: 20,
          maxCombo: 2,
        },
        liveReviewQueue: 25,
        liveIncidents: 5,
      }),
    );
    const scene = planOrgBoardScene(org);
    expect(scene.flows.some((f) => f.hot)).toBe(true);
    const hotIsland = scene.islands.find((i) => i.team.health === 'reviewHell');
    if (hotIsland) {
      expect(islandMood(hotIsland.team)).toBe('panic');
    }
  });

  it('hub と flows を常に含む', () => {
    const org = generateOrgScale(orgScaleInput('ri01-hub'));
    const scene = planOrgBoardScene(org);
    expect(scene.hub.ci).toBeGreaterThanOrEqual(0);
    expect(scene.flows.length).toBeGreaterThan(0);
    expect(scene.hub.x).toBe(700);
    expect(scene.hub.y).toBe(288);
  });

  it('teamDesignPosition はチーム数に応じてゾーン内に配置する', () => {
    const pos0 = teamDesignPosition(0, 0, 4);
    const pos1 = teamDesignPosition(0, 3, 4);
    expect(pos0.x).toBeLessThan(pos1.x + 200);
    expect(isInOrgView(pos0.x, pos0.y)).toBe(true);
    expect(isInOrgView(pos1.x, pos1.y)).toBe(true);
  });

  it('ORG_VIEW は mockup viewBox と一致', () => {
    expect(ORG_VIEW.w).toBe(1404);
    expect(ORG_VIEW.h).toBe(573);
  });

  it('部門 glow は実際の健全度から導出する（静的 mockup 既定値に依存しない）', () => {
    const org = generateOrgScale(orgScaleInput('ri01-glow'));

    const healthyProduct = {
      ...org,
      departments: org.departments.map((d) =>
        d.def.id === 'product' ? { ...d, health: 'healthy' as const, onFire: 0 } : d,
      ),
    };
    expect(
      planOrgBoardScene(healthyProduct).zones.find((z) => z.deptId === 'product')?.glow?.kind,
    ).toBe('ok');

    const hellProduct = {
      ...org,
      departments: org.departments.map((d) =>
        d.def.id === 'product'
          ? {
              ...d,
              health: 'reviewHell' as const,
              onFire: 3,
              teams: d.teams.map((t) => ({ ...t, health: 'reviewHell' as const })),
            }
          : d,
      ),
    };
    expect(
      planOrgBoardScene(hellProduct).zones.find((z) => z.deptId === 'product')?.glow?.kind,
    ).toBe('hell');

    const recoveredNewbiz = {
      ...org,
      departments: org.departments.map((d) =>
        d.def.id === 'newbiz' ? { ...d, health: 'healthy' as const, onFire: 0 } : d,
      ),
    };
    expect(
      planOrgBoardScene(recoveredNewbiz).zones.find((z) => z.deptId === 'newbiz')?.glow?.kind,
    ).toBe('ok');
    expect(planOrgBoardScene(recoveredNewbiz).zones.find((z) => z.deptId === 'newbiz')?.tone).toBe(
      'ok',
    );
  });

  it('islandDepth は 1..99 の帯を返す', () => {
    expect(islandDepth(700, 288)).toBeGreaterThanOrEqual(1);
    expect(islandDepth(700, 288)).toBeLessThanOrEqual(99);
    expect(islandDepth(100, 500)).toBeLessThanOrEqual(99);
  });

  it('extraTeams で増えたチームも最小間隔を保つ', () => {
    const org = generateOrgScale(
      orgScaleInput('ri01-spacing', {
        adjust: { company: { ...emptyAdjustState().company, extraTeams: 4 }, byDept: {} },
      }),
    );
    const productTeams = org.departments.find((d) => d.def.id === 'product')!.teams;
    expect(productTeams.length).toBeGreaterThanOrEqual(6);

    const positions = productTeams.map((_, i) => teamDesignPosition(0, i, productTeams.length));
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        const dx = Math.abs(positions[i].x - positions[j].x);
        const dy = Math.abs(positions[i].y - positions[j].y);
        if (dy < MIN_ISLAND_SPACING_Y * 0.5) {
          expect(dx).toBeGreaterThanOrEqual(MIN_ISLAND_SPACING_X * 0.85);
        }
        if (dx < MIN_ISLAND_SPACING_X * 0.5) {
          expect(dy).toBeGreaterThanOrEqual(MIN_ISLAND_SPACING_Y * 0.85);
        }
      }
    }
  });
});

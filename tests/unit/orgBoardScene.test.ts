/**
 * 全社マップ等角盤面のシーン計画検証（RI-01 / SPEC 第22.5）。
 */
import { describe, expect, it } from 'vitest';
import { generateOrgScale } from '../../src/sim/orgscale';
import type { OrgScaleInput } from '../../src/sim/orgscale/generate';
import type { OrgState } from '../../src/sim/types';
import type { RunTotals } from '../../src/sim/run/types';
import {
  ORG_VIEW,
  isInOrgView,
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
    for (const island of scene.islands) {
      expect(isInOrgView(island.x, island.y)).toBe(true);
      expect(isInOrgView(island.badge.x, island.badge.y)).toBe(true);
    }
    expect(isInOrgView(scene.hub.x, scene.hub.y)).toBe(true);
  });

  it('画家順 depth が y 座標で単調非減少', () => {
    const org = generateOrgScale(orgScaleInput('ri01-depth'));
    const scene = planOrgBoardScene(org);
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
});

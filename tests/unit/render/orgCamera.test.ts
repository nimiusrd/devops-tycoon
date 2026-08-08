/**
 * 全社マップカメラ目標の数値検証（SPEC 第22.5）。
 */
import { describe, expect, it } from 'vitest';
import {
  boundsCenter,
  dampedFocusScale,
  deptFocusTargetScale,
  scrollForCenteredTarget,
  teamFocusTargetScale,
  TEAM_FOCUS_MAX_ZOOM_IN,
  TEAM_FOCUS_SPAN,
  worldBoundsForAll,
  worldBoundsForDept,
  worldBoundsForTeamFocus,
  worldPointForTeam,
} from '../../../src/render/orgCamera';
import { LOD_BADGE_MAX } from '../../../src/render/orgIslandView';
import { isoProject } from '../../../src/render/iso';
import {
  isoLayoutOrigin,
  layoutIso,
  ORG_CARD_W,
  ORG_ISO,
  ORG_PAD,
} from '../../../src/render/orgView';
import type { Team, TeamHealth } from '../../../src/sim/orgscale/types';

const ISO = ORG_ISO;
const PAD = ORG_PAD;

function team(partial: Partial<Team> & Pick<Team, 'id' | 'gridX' | 'gridY'>): Team {
  return {
    deptId: 'eng',
    name: partial.id,
    shipping: 0,
    aiDependency: 0,
    reviewQueue: 0,
    incidents: 0,
    morale: 50,
    techDebt: 0,
    engineers: 5,
    aiAssignedCount: 0,
    health: 'healthy' as TeamHealth,
    isPlayer: false,
    isActive: false,
    ...partial,
  };
}

describe('worldBoundsForAll', () => {
  it('layoutIso と同じ全体サイズを返す', () => {
    const teams = [
      team({ id: 'a', gridX: 0, gridY: 0 }),
      team({ id: 'b', gridX: 2, gridY: 1, deptId: 'prod' }),
    ];
    const layout = layoutIso(teams, ISO, PAD);
    const bounds = worldBoundsForAll(teams, ISO, PAD);
    expect(bounds).toEqual({ x: 0, y: 0, width: layout.width, height: layout.height });
  });

  it('空入力は null', () => {
    expect(worldBoundsForAll([], ISO, PAD)).toBeNull();
  });
});

describe('worldBoundsForDept', () => {
  it('部門チームだけを囲む bounds を返す', () => {
    const teams = [
      team({ id: 'e1', gridX: 0, gridY: 0, deptId: 'eng' }),
      team({ id: 'e2', gridX: 1, gridY: 0, deptId: 'eng' }),
      team({ id: 'p1', gridX: 5, gridY: 0, deptId: 'prod' }),
    ];
    const eng = worldBoundsForDept(teams, 'eng', ISO, PAD, 0);
    const prod = worldBoundsForDept(teams, 'prod', ISO, PAD, 0);
    expect(eng!.width).toBeLessThan(prod!.x + prod!.width);
    expect(boundsCenter(eng!).x).toBeLessThan(boundsCenter(prod!).x);
  });

  it('未知の部門は null', () => {
    const teams = [team({ id: 'a', gridX: 0, gridY: 0 })];
    expect(worldBoundsForDept(teams, 'missing', ISO, PAD)).toBeNull();
  });
});

describe('worldPointForTeam / worldBoundsForTeamFocus', () => {
  it('チーム ID から投影座標を返す', () => {
    const teams = [team({ id: 't1', gridX: 1, gridY: 0 })];
    const origin = isoLayoutOrigin(teams, ISO, PAD);
    const expected = isoProject(1, 0, { ...ISO, ...origin });
    const p = worldPointForTeam(teams, 't1', ISO, PAD);
    expect(p).toEqual(expected);
  });

  it('未知 ID は null', () => {
    expect(worldPointForTeam([team({ id: 'a', gridX: 0, gridY: 0 })], 'x', ISO, PAD)).toBeNull();
  });

  it('チームフォーカス bounds は中心を team 点に置く', () => {
    const teams = [team({ id: 't1', gridX: 1, gridY: 0 })];
    const focus = worldBoundsForTeamFocus(teams, 't1', ISO, PAD)!;
    expect(boundsCenter(focus)).toEqual(worldPointForTeam(teams, 't1', ISO, PAD));
    expect(focus.width).toBe(TEAM_FOCUS_SPAN);
    expect(TEAM_FOCUS_SPAN).toBe(ORG_CARD_W + ORG_PAD);
  });
});

describe('dampedFocusScale / teamFocusTargetScale', () => {
  it('fit が現在より小さいときは縮小しない', () => {
    expect(teamFocusTargetScale(1.5, 1.1)).toBe(1.5);
  });

  it('fit が大きくても 1 回の拡大倍率を上限に抑える', () => {
    expect(teamFocusTargetScale(1.2, 2.4)).toBeCloseTo(1.2 * TEAM_FOCUS_MAX_ZOOM_IN);
    expect(dampedFocusScale(1.2, 2.4, TEAM_FOCUS_MAX_ZOOM_IN)).toBeCloseTo(
      1.2 * TEAM_FOCUS_MAX_ZOOM_IN,
    );
  });

  it('card LOD 下限を下回らない', () => {
    expect(teamFocusTargetScale(0.3, 0.4)).toBe(LOD_BADGE_MAX);
  });

  it('部門フォーカスは DEPT 上限で抑える', () => {
    expect(deptFocusTargetScale(1.0, 3.0)).toBe(1.5);
  });
});

describe('scrollForCenteredTarget', () => {
  it('対象点を可視窓の中央に置く scrollLeft/Top を返す', () => {
    expect(scrollForCenteredTarget(500, 200, 400, 300, 2000, 800)).toEqual({
      scrollLeft: 300,
      scrollTop: 50,
    });
  });

  it('端では clamp する', () => {
    expect(scrollForCenteredTarget(50, 10, 400, 300, 800, 600)).toEqual({
      scrollLeft: 0,
      scrollTop: 0,
    });
    expect(scrollForCenteredTarget(750, 550, 400, 300, 800, 600)).toEqual({
      scrollLeft: 400,
      scrollTop: 300,
    });
  });
});

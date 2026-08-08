/**
 * 全社マップレイアウトヘルパーの数値検証（SPEC 第22.5）。
 * DOM/Pixi で共有する origin 算出が layoutIso と一致することを GPU 無しで検証する。
 */
import { describe, expect, it } from 'vitest';
import { isoProject } from '../../../src/render/iso';
import { isoLayoutOrigin, layoutIso, orgLayoutFingerprint } from '../../../src/render/orgView';
import type { Team, TeamHealth } from '../../../src/sim/orgscale/types';

const ISO = { tileW: 132, tileH: 82 };
const PAD = 64;

function team(partial: Partial<Team> & Pick<Team, 'id' | 'gridX' | 'gridY'>): Team {
  return {
    deptId: 'dep',
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

describe('isoLayoutOrigin', () => {
  it('layoutIso の配置座標と origin 付き isoProject が一致する', () => {
    const teams = [
      team({ id: 'a', gridX: 0, gridY: 0 }),
      team({ id: 'b', gridX: 2, gridY: 1 }),
      team({ id: 'c', gridX: 1, gridY: 3 }),
    ];
    const layout = layoutIso(teams, ISO, PAD);
    const origin = isoLayoutOrigin(teams, ISO, PAD);

    for (const { item, x, y } of layout.placed) {
      const p = isoProject(item.gridX, item.gridY, { ...ISO, ...origin });
      expect(p.x).toBeCloseTo(x, 5);
      expect(p.y).toBeCloseTo(y, 5);
    }
  });

  it('空入力では pad を origin に返す', () => {
    expect(isoLayoutOrigin([], ISO, PAD)).toEqual({ originX: PAD, originY: PAD });
  });
});

describe('orgLayoutFingerprint', () => {
  it('格子配置が変わると指紋も変わる', () => {
    const t1 = team({ id: 'a', gridX: 0, gridY: 0 });
    const t2 = team({ id: 'b', gridX: 2, gridY: 1 });
    const moved = team({ id: 'b', gridX: 3, gridY: 1 });
    const fp1 = orgLayoutFingerprint([t1, t2], ISO, PAD);
    const fp2 = orgLayoutFingerprint([t1, moved], ISO, PAD);
    expect(fp1).not.toBe(fp2);
  });

  it('健全度など非配置フィールドだけ変わっても指紋は同じ', () => {
    const base = team({ id: 'a', gridX: 0, gridY: 0 });
    const updated = { ...base, health: 'reviewHell' as TeamHealth, incidents: 3 };
    expect(orgLayoutFingerprint([base], ISO, PAD)).toBe(orgLayoutFingerprint([updated], ISO, PAD));
  });
});

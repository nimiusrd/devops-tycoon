/**
 * 全社マップレイアウトヘルパーの数値検証（SPEC 第22.5）。
 * DOM/Pixi で共有する origin 算出が layoutIso と一致することを GPU 無しで検証する。
 */
import { describe, expect, it } from 'vitest';
import { isoProject } from '../../src/render/iso';
import { isoLayoutOrigin, layoutIso } from '../../src/render/orgView';
import type { Team, TeamHealth } from '../../src/sim/orgscale/types';

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
    health: 'healthy' as TeamHealth,
    isPlayer: false,
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

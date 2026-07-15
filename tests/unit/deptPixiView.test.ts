/**
 * 部署ビュー Pixi レンダラの純ヘルパ検証（RI-11 / SPEC 第22.5）。
 *
 * GPU を使わない数値計算（フローパス解析・破線分割・contain-fit）を Vitest で
 * 検証する。実 WebGL は CI で回さない方針（architecture §4.2）のため、
 * レンダラ本体はブラウザの Pixi 視覚回帰（@pixi opt-in）で確認する。
 */
import { describe, expect, it } from 'vitest';
import { planDeptBoardScene } from '../../src/render/deptBoardScene';
import {
  containFitTransform,
  parseQuadPath,
  pileDotOffsets,
  quadDashPolylines,
  quadEndAngleDeg,
  quadPointAt,
  teamFloorColor,
  teamZoomTransform,
  zoomTransformAt,
} from '../../src/render/deptPixiView';
import { DEPARTMENT_DEFS } from '../../src/data/departments';
import { aggregateDepartment } from '../../src/sim/orgscale/aggregate';
import type { DepartmentState, Team } from '../../src/sim/orgscale/types';

function makeTeam(id: string): Team {
  return {
    id,
    deptId: 'product',
    name: id,
    gridX: 0,
    gridY: 0,
    shipping: 120,
    aiDependency: 30,
    reviewQueue: 2,
    incidents: 0,
    morale: 70,
    techDebt: 20,
    engineers: 6,
    aiAssignedCount: 0,
    health: 'healthy',
    isPlayer: false,
  };
}

function makeDept(teams: Team[]): DepartmentState {
  return aggregateDepartment(DEPARTMENT_DEFS[0], teams);
}

describe('parseQuadPath', () => {
  it('M/Q 形式のフローパスを数値へ解析する', () => {
    expect(parseQuadPath('M450,274 Q576,314 702,364')).toEqual({
      sx: 450,
      sy: 274,
      cx: 576,
      cy: 314,
      ex: 702,
      ey: 364,
    });
  });

  it('小数・負数を扱える（flowPathBetween の生成値）', () => {
    const p = parseQuadPath('M266,309.6 Q431,-12.5 596,326.4');
    expect(p).not.toBeNull();
    expect(p?.cy).toBeCloseTo(-12.5);
  });

  it('不正な形式は null', () => {
    expect(parseQuadPath('')).toBeNull();
    expect(parseQuadPath('M450,274 L702,364')).toBeNull();
  });

  it('シーン計画の全フローパスを解析できる', () => {
    for (const count of [2, 3, 4, 6]) {
      const teams = Array.from({ length: count }, (_, i) => makeTeam(`t${i}`));
      const scene = planDeptBoardScene(makeDept(teams));
      expect(scene.flows.length).toBe(count - 1);
      for (const flow of scene.flows) {
        expect(parseQuadPath(flow.d)).not.toBeNull();
      }
    }
  });
});

describe('quadPointAt / quadEndAngleDeg', () => {
  const p = { sx: 0, sy: 0, cx: 50, cy: 100, ex: 100, ey: 0 };

  it('端点は始点・終点に一致する', () => {
    expect(quadPointAt(p, 0)).toEqual({ x: 0, y: 0 });
    expect(quadPointAt(p, 1)).toEqual({ x: 100, y: 0 });
  });

  it('中点は制御点方向へ膨らむ', () => {
    const mid = quadPointAt(p, 0.5);
    expect(mid.x).toBeCloseTo(50);
    expect(mid.y).toBeCloseTo(50);
  });

  it('終端接線角は制御点→終点の向き', () => {
    // (50,100) → (100,0): 右下向き（y 軸は下向き正なので負角）。
    expect(quadEndAngleDeg(p)).toBeCloseTo((Math.atan2(-100, 50) * 180) / Math.PI);
  });

  it('制御点と終点が一致する退化時は始点→終点で代用する', () => {
    expect(quadEndAngleDeg({ sx: 0, sy: 0, cx: 100, cy: 0, ex: 100, ey: 0 })).toBeCloseTo(0);
  });
});

describe('quadDashPolylines', () => {
  // 直線に退化した 2 次ベジェ（長さ 150）で破線パターンを検証する。
  const line = { sx: 0, sy: 0, cx: 75, cy: 0, ex: 150, ey: 0 };

  it('dash/gap パターンで折れ線に分割される', () => {
    const dashes = quadDashPolylines(line, 6, 9, 150);
    // 周期 15px × 長さ 150 = 10 セグメント。
    expect(dashes.length).toBe(10);
    for (const seg of dashes) {
      expect(seg.length).toBeGreaterThanOrEqual(2);
      const len = seg[seg.length - 1].x - seg[0].x;
      expect(len).toBeGreaterThan(0);
      expect(len).toBeLessThanOrEqual(6 + 1e-6);
    }
  });

  it('決定論（同一入力＝同一出力）', () => {
    expect(quadDashPolylines(line, 6, 9)).toEqual(quadDashPolylines(line, 6, 9));
  });

  it('不正な入力は空', () => {
    expect(quadDashPolylines(line, 0, 9)).toEqual([]);
    expect(quadDashPolylines({ ...line, cx: 0, ex: 0 }, 6, 9)).toEqual([]);
  });
});

describe('containFitTransform', () => {
  it('横長ホストでは高さ基準で中央寄せ', () => {
    const t = containFitTransform(2808, 573, 1404, 573);
    expect(t.scale).toBe(1);
    expect(t.x).toBe(702);
    expect(t.y).toBe(0);
  });

  it('縦長ホストでは幅基準で中央寄せ', () => {
    const t = containFitTransform(702, 573, 1404, 573);
    expect(t.scale).toBe(0.5);
    expect(t.x).toBe(0);
    expect(t.y).toBeCloseTo((573 - 573 * 0.5) / 2);
  });

  it('ゼロ寸法は恒等変換', () => {
    expect(containFitTransform(0, 100, 1404, 573)).toEqual({ scale: 1, x: 0, y: 0 });
  });
});

describe('teamFloorColor / pileDotOffsets', () => {
  it('健全度で床色が変わる（DOM DeptTeamMini と同値）', () => {
    expect(teamFloorColor('healthy')).toBe('#3a2f68');
    expect(teamFloorColor('congested')).toBe('#3f3470');
    expect(teamFloorColor('reviewHell')).toBe('#4a2b45');
  });

  it('粒山は 4 個/行・上限 12・多いと小径', () => {
    expect(pileDotOffsets(0)).toEqual([]);
    const five = pileDotOffsets(5);
    expect(five.length).toBe(5);
    expect(five[4]).toEqual({ x: -15, y: -9, r: 6 });
    const many = pileDotOffsets(20);
    expect(many.length).toBe(12);
    expect(many.every((d) => d.r === 5)).toBe(true);
  });
});

describe('teamZoomTransform / zoomTransformAt（RI-04）', () => {
  const fit = containFitTransform(1404, 573, 1404, 573); // scale 1, x 0, y 0

  it('チーム設計座標が host 中央へ来る変換を返す', () => {
    const to = teamZoomTransform(fit, 400, 300, 1404, 573);
    expect(to.scale).toBeCloseTo(1.6, 5);
    // 設計 (400,300) → 画面 (400*1.6 + x, 300*1.6 + y) = (702, 286.5)。
    expect(400 * to.scale + to.x).toBeCloseTo(1404 / 2, 5);
    expect(300 * to.scale + to.y).toBeCloseTo(573 / 2, 5);
  });

  it('zoomMul を指定できる', () => {
    const to = teamZoomTransform(fit, 0, 0, 1000, 500, 2);
    expect(to.scale).toBeCloseTo(2, 5);
    expect(to.x).toBeCloseTo(500, 5);
    expect(to.y).toBeCloseTo(250, 5);
  });

  it('補間は端点一致・easeOutCubic で単調', () => {
    const from = { scale: 1, x: 0, y: 0 };
    const to = { scale: 1.6, x: -200, y: -100 };
    expect(zoomTransformAt(0, from, to)).toEqual(from);
    expect(zoomTransformAt(1, from, to)).toEqual(to);
    // 範囲外はクランプ。
    expect(zoomTransformAt(-1, from, to)).toEqual(from);
    expect(zoomTransformAt(2, from, to)).toEqual(to);
    // easeOut: 前半で半分以上進む。
    const mid = zoomTransformAt(0.5, from, to);
    expect(mid.scale).toBeGreaterThan(1.3);
    expect(mid.scale).toBeLessThan(1.6);
    // 単調増加。
    let prev = from.scale;
    for (let i = 1; i <= 10; i += 1) {
      const at = zoomTransformAt(i / 10, from, to);
      expect(at.scale).toBeGreaterThanOrEqual(prev);
      prev = at.scale;
    }
  });
});

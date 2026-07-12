/**
 * 部署ビュー等角盤面のシーン計画検証（RI-02 / SPEC 第22.5）。
 */
import { describe, expect, it } from 'vitest';
import { generateOrgScale } from '../../src/sim/orgscale';
import type { OrgScaleInput } from '../../src/sim/orgscale/generate';
import type { OrgState } from '../../src/sim/types';
import type { RunTotals } from '../../src/sim/run/types';
import type { DepartmentState, Team, TeamHealth } from '../../src/sim/orgscale/types';
import { aggregateDepartment } from '../../src/sim/orgscale/aggregate';
import {
  DEPT_VIEW,
  flowEndpoints,
  isInDeptView,
  planChainedIndices,
  planDeptBoardScene,
  teamDesignPosition,
  teamLaneCounts,
  teamLayoutScale,
} from '../../src/render/deptBoardScene';

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

function team(id: string, health: TeamHealth, reviewQueue = 0): Team {
  return {
    id,
    deptId: 'product',
    name: id,
    gridX: 0,
    gridY: 0,
    shipping: 120,
    aiDependency: 70,
    reviewQueue,
    incidents: health === 'reviewHell' ? 2 : 0,
    morale: 50,
    techDebt: 20,
    engineers: 8,
    health,
    isPlayer: false,
  };
}

function deptWithTeams(teams: Team[]): DepartmentState {
  const org = generateOrgScale(orgScaleInput('ri02-dept'));
  return aggregateDepartment(org.departments[0].def, teams);
}

describe('planDeptBoardScene (RI-02)', () => {
  it('チーム数ぶんのミニパイプラインを生成する', () => {
    const dept = deptWithTeams([
      team('t0', 'healthy'),
      team('t1', 'congested', 4),
      team('t2', 'reviewHell', 8),
    ]);
    const scene = planDeptBoardScene(dept);
    expect(scene.teams).toHaveLength(3);
    expect(scene.teams.map((t) => t.teamId)).toEqual(['t0', 't1', 't2']);
    expect(scene.flows).toHaveLength(2);
    expect(scene.stageLabels).toHaveLength(3);
  });

  it('全チーム座標が DEPT_VIEW 内に収まる', () => {
    const dept = deptWithTeams([
      team('t0', 'healthy'),
      team('t1', 'healthy'),
      team('t2', 'healthy'),
      team('t3', 'healthy'),
    ]);
    const scene = planDeptBoardScene(dept);
    for (const t of scene.teams) {
      expect(isInDeptView(t.x, t.y)).toBe(true);
      expect(isInDeptView(t.banner.x, t.banner.y)).toBe(true);
    }
  });

  it('reviewHell 上流の下流 dependency が hot になる', () => {
    const dept = deptWithTeams([team('t0', 'reviewHell', 10), team('t1', 'healthy')]);
    const scene = planDeptBoardScene(dept);
    expect(scene.teams[1].chained).toBe(true);
    expect(scene.flows[0].hot).toBe(true);
  });

  it('Review 工程 label が reviewQueue>=6 で hot になる', () => {
    const dept = deptWithTeams([team('t0', 'congested', 7)]);
    const scene = planDeptBoardScene(dept);
    expect(scene.teams[0].lanes.find((l) => l.lane === 'review')?.hot).toBe(true);
    expect(scene.stageLabels.find((l) => l.lane === 'review')?.hot).toBe(true);
  });

  it('部門 tone が健全度に応じて plate に反映される', () => {
    const healthy = deptWithTeams([team('t0', 'healthy')]);
    const hell = deptWithTeams([team('t0', 'reviewHell', 12)]);
    expect(planDeptBoardScene(healthy).plate.tone).toBe('ok');
    expect(planDeptBoardScene(hell).plate.tone).toBe('hell');
    expect(planDeptBoardScene(hell).plate.glow?.kind).toBe('hell');
  });
});

describe('teamLaneCounts / planChainedIndices', () => {
  it('工程粒数を現行 DeptScreen と同様に導出する', () => {
    const t = team('t0', 'healthy');
    t.engineers = 10;
    t.shipping = 250;
    t.reviewQueue = 5;
    expect(teamLaneCounts(t)).toEqual({ coding: 6, review: 5, done: 3 });
  });

  it('炎上チームの次インデックスだけ chained になる', () => {
    const teams = [team('t0', 'reviewHell'), team('t1', 'healthy'), team('t2', 'healthy')];
    expect([...planChainedIndices(teams)]).toEqual([1]);
  });
});

describe('teamDesignPosition', () => {
  it('3 チーム時は旧モック由来の固定座標を返す', () => {
    const p0 = teamDesignPosition(0, 3);
    const p1 = teamDesignPosition(1, 3);
    const p2 = teamDesignPosition(2, 3);
    expect(p0).toEqual({ x: 300, y: 264 });
    expect(p1).toEqual({ x: 702, y: 374 });
    expect(p2).toEqual({ x: 1104, y: 264 });
    expect(DEPT_VIEW.w).toBe(1404);
  });

  it('4 チームは横一列に配置し X 方向の間隔を確保する', () => {
    const positions = [0, 1, 2, 3].map((i) => teamDesignPosition(i, 4));
    const ys = positions.map((p) => p.y);
    expect(new Set(ys).size).toBe(1);
    const xs = positions.map((p) => p.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(260);
    }
  });

  it('4 チームの依存フローは左から右へ向く', () => {
    const dept = deptWithTeams([0, 1, 2, 3].map((i) => team(`t${i}`, 'healthy')));
    const scene = planDeptBoardScene(dept);
    for (const flow of scene.flows) {
      const { sx, ex } = flowEndpoints(flow.d);
      expect(sx).toBeLessThan(ex);
    }
  });

  it('5 チームは縮小スケールと 2 段配置を使う', () => {
    const dept = deptWithTeams([0, 1, 2, 3, 4].map((i) => team(`t${i}`, 'healthy')));
    const scene = planDeptBoardScene(dept);
    expect(teamLayoutScale(5)).toBeLessThan(1);
    expect(scene.teams.every((t) => t.scale === teamLayoutScale(5))).toBe(true);
    const ys = scene.teams.map((t) => t.y);
    expect(new Set(ys).size).toBeGreaterThanOrEqual(2);
  });
});

/**
 * 部署 / 現場 Pixi 描画予算の純関数検証（RI-11 / SPEC 第22.5）。
 * GPU 不要。レンダラ本体はブラウザでのみ init する。
 */
import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import {
  DEPT_SPRITE_BUDGET,
  estimateDeptPixiMetrics,
  strokeQuadraticPath,
} from '../../src/render/adapters/pixiDeptRenderer';
import {
  BOARD_DOT_BUDGET,
  estimateBoardPixiMetrics,
} from '../../src/render/adapters/pixiBoardRenderer';
import { planBoardScene } from '../../src/render/boardScene';
import { planDeptBoardScene } from '../../src/render/deptBoardScene';
import { SpritePool } from '../../src/render/iso';
import { generateOrgScale } from '../../src/sim/orgscale';
import { aggregateDepartment } from '../../src/sim/orgscale/aggregate';
import type { OrgScaleInput } from '../../src/sim/orgscale/generate';
import type { Team, TeamHealth } from '../../src/sim/orgscale/types';
import type { OrgState, Task } from '../../src/sim/types';
import type { RunTotals } from '../../src/sim/run/types';

function orgScaleInput(seed: string): OrgScaleInput {
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
  return { seed, org, totals, diagnosis: 'healthyAcceleration', budget: 100 };
}

function team(id: string, health: TeamHealth = 'healthy'): Team {
  return {
    id,
    deptId: 'product',
    name: id,
    gridX: 0,
    gridY: 0,
    shipping: 120,
    aiDependency: 70,
    reviewQueue: health === 'reviewHell' ? 8 : 2,
    incidents: health === 'reviewHell' ? 2 : 0,
    morale: 50,
    techDebt: 20,
    engineers: 8,
    health,
    isPlayer: false,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 0,
    kind: 'normal',
    highValue: false,
    aiAssisted: false,
    lane: 'coding',
    progress: 0,
    reworkAttempts: 0,
    wasReworked: false,
    incident: false,
    debt: false,
    ...overrides,
  };
}

describe('estimateDeptPixiMetrics (RI-11)', () => {
  it('チーム数＝スプライト見積もり、予算内に収まる', () => {
    const org = generateOrgScale(orgScaleInput('ri11-dept'));
    const dept = aggregateDepartment(org.departments[0].def, [
      team('t0'),
      team('t1', 'congested'),
      team('t2', 'reviewHell'),
    ]);
    const scene = planDeptBoardScene(dept);
    const metrics = estimateDeptPixiMetrics(scene);
    expect(metrics.teams).toBe(3);
    expect(metrics.sprites).toBe(3);
    expect(metrics.flows).toBe(2);
    expect(metrics.stageLabels).toBeGreaterThan(0);
    expect(metrics.sprites).toBeLessThanOrEqual(DEPT_SPRITE_BUDGET);
  });
});

describe('strokeQuadraticPath (RI-11)', () => {
  it('M/Q パスを Graphics に描ける', () => {
    const g = new Graphics();
    strokeQuadraticPath(g, 'M450,274 Q576,314 702,364', '#cdbff0', 2.2, 0.65);
    expect(g).toBeTruthy();
  });
});

describe('estimateBoardPixiMetrics (RI-11)', () => {
  it('粒数は予算内、ステーションは常に 5', () => {
    const tasks = Array.from({ length: 30 }, (_, i) =>
      task({ id: i + 1, lane: i % 2 === 0 ? 'review' : 'coding' }),
    );
    const scene = planBoardScene(tasks);
    const metrics = estimateBoardPixiMetrics(scene);
    expect(metrics.stations).toBe(5);
    expect(metrics.flows).toBe(5);
    expect(metrics.sprites).toBe(scene.dots.length);
    expect(metrics.sprites).toBeLessThanOrEqual(BOARD_DOT_BUDGET);
  });
});

describe('SpritePool 再利用（RI-11 予算）', () => {
  it('releaseAll 後の再 acquire は reuse が増える', () => {
    const pool = new SpritePool(() => ({ id: Math.random() }), { max: 8 });
    const a = pool.acquire();
    const b = pool.acquire();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(pool.createdCount).toBe(2);
    pool.releaseAll();
    expect(pool.activeCount).toBe(0);
    pool.acquire();
    expect(pool.reuseCount).toBe(1);
  });
});

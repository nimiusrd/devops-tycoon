/**
 * 全社マップ「シーン計画」の数値検証（SPEC 第22.5）。
 * 画面外カリング数 / スプライト予算超過数 / 画家順 / 色マッピングを GPU 無しで検証する。
 * これは PixiJS 移行時の性能予算 DoD の供給先（描画は同じ計画を読むだけ）。
 */
import { describe, expect, it } from 'vitest';
import { LOD_BADGE_MAX, LOD_DOT_MAX } from '../../src/render/orgIslandView';
import { planOrgScene, type OrgSceneOptions } from '../../src/render/orgScene';
import { HEALTH_COLOR } from '../../src/render/orgView';
import type { Team, TeamHealth } from '../../src/sim/orgscale/types';

const ISO = { tileW: 64, tileH: 32 };
const BIG_CAMERA = { x: -10000, y: -10000, w: 20000, h: 20000 };

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

function opts(overrides: Partial<OrgSceneOptions> = {}): OrgSceneOptions {
  return { iso: ISO, spriteBudget: 1000, ...overrides };
}

describe('planOrgScene', () => {
  it('可視チームを画家順（奥→手前）に並べ、座標を投影する', () => {
    const teams = [
      team({ id: 'far', gridX: 2, gridY: 2 }),
      team({ id: 'near', gridX: 0, gridY: 0 }),
      team({ id: 'mid', gridX: 1, gridY: 0 }),
    ];
    const plan = planOrgScene(teams, BIG_CAMERA, opts());
    expect(plan.sprites.map((s) => s.teamId)).toEqual(['near', 'mid', 'far']);
    // (0,0) は原点へ投影される。
    expect(plan.sprites[0]).toMatchObject({ x: 0, y: 0 });
    expect(plan.total).toBe(3);
    expect(plan.culled).toBe(0);
    expect(plan.overBudget).toBe(0);
  });

  it('カメラ矩形外のチームを除外し、カリング数を返す', () => {
    const teams = [
      team({ id: 'in', gridX: 0, gridY: 0 }), // (0,0)
      team({ id: 'out', gridX: 50, gridY: 0 }), // (1600,800) 範囲外
    ];
    const plan = planOrgScene(teams, { x: -50, y: -50, w: 200, h: 200 }, opts());
    expect(plan.sprites.map((s) => s.teamId)).toEqual(['in']);
    expect(plan.culled).toBe(1);
    expect(plan.total).toBe(2);
  });

  it('スプライト予算を超えた分は描かず overBudget に数える（性能予算）', () => {
    const teams = Array.from({ length: 10 }, (_, i) => team({ id: `t${i}`, gridX: i, gridY: 0 }));
    const plan = planOrgScene(teams, BIG_CAMERA, opts({ spriteBudget: 4 }));
    expect(plan.sprites).toHaveLength(4);
    expect(plan.overBudget).toBe(6);
    // 予算は深度順（手前から）ではなく奥から詰めるので先頭は最奥。
    expect(plan.sprites[0].teamId).toBe('t0');
  });

  it('健全度を色（tint）へ写し、炎上強度を 0..1 に正規化する', () => {
    const healths: TeamHealth[] = ['healthy', 'congested', 'reviewHell'];
    const teams = healths.map((h, i) =>
      team({ id: h, gridX: i, gridY: 0, health: h, incidents: i * 6 }),
    );
    const plan = planOrgScene(teams, BIG_CAMERA, opts());
    for (const s of plan.sprites) {
      expect(s.tint).toBe(HEALTH_COLOR[s.teamId as TeamHealth]);
    }
    expect(plan.sprites.find((s) => s.teamId === 'healthy')?.fire).toBe(0);
    expect(plan.sprites.find((s) => s.teamId === 'reviewHell')?.fire).toBe(1); // 12/6 → clamp 1
  });

  it('プレイヤーチームのフラグを伝播する', () => {
    const teams = [team({ id: 'me', gridX: 0, gridY: 0, isPlayer: true })];
    const plan = planOrgScene(teams, BIG_CAMERA, opts());
    expect(plan.sprites[0].isPlayer).toBe(true);
  });

  it('拡張フィールド・部門色・LOD・ラベルを伝播する', () => {
    const teams = [
      team({
        id: 'plat',
        gridX: 0,
        gridY: 0,
        name: 'Platform',
        deptId: 'eng',
        shipping: 55,
        aiDependency: 33,
        incidents: 2,
        health: 'congested',
        isPlayer: true,
      }),
    ];
    const plan = planOrgScene(
      teams,
      BIG_CAMERA,
      opts({
        zoomScale: LOD_BADGE_MAX,
        deptColor: (id) => (id === 'eng' ? '#aabbcc' : '#000000'),
      }),
    );
    const s = plan.sprites[0];
    expect(s.name).toBe('Platform');
    expect(s.deptColor).toBe('#aabbcc');
    expect(s.shipping).toBe(55);
    expect(s.aiDependency).toBe(33);
    expect(s.incidents).toBe(2);
    expect(s.health).toBe('congested');
    expect(s.detail).toBe('card');
    expect(s.labels.name).toBe('★ Platform');
    expect(s.labels.fire).toBe('🔥2');
    expect(s.labels.shipping).toBe('出荷 55');
    expect(s.labels.ai).toBe('AI 33');
  });

  it('zoomScale 未指定時は card、deptColor 未指定時はフォールバック色', () => {
    const teams = [team({ id: 't', gridX: 0, gridY: 0, name: 'Team A' })];
    const plan = planOrgScene(teams, BIG_CAMERA, opts());
    expect(plan.sprites[0].detail).toBe('card');
    expect(plan.sprites[0].deptColor).toBe('#6b4a9e');
    expect(plan.sprites[0].labels.shipping).toBe('出荷 0');
  });

  it('zoomScale が dot 閾値未満なら dot LOD になる', () => {
    const teams = [team({ id: 't', gridX: 0, gridY: 0, name: 'Far' })];
    const plan = planOrgScene(teams, BIG_CAMERA, opts({ zoomScale: LOD_DOT_MAX - 0.01 }));
    expect(plan.sprites[0].detail).toBe('dot');
    expect(plan.sprites[0].labels.name).toBe('');
  });

  it('空入力でも壊れない', () => {
    const plan = planOrgScene([], BIG_CAMERA, opts());
    expect(plan).toEqual({ sprites: [], culled: 0, overBudget: 0, total: 0 });
  });
});

/**
 * チーム島表示計画の数値検証（SPEC 第22.5）。
 * LOD 境界・名前省略・DOM 同等ラベルを GPU 無しで固定する。
 */
import { describe, expect, it } from 'vitest';
import {
  BADGE_NAME_MAX_CHARS,
  detailForZoom,
  fireLabel,
  LOD_BADGE_MAX,
  LOD_DOT_MAX,
  teamIslandView,
  truncateName,
} from '../../src/render/orgIslandView';
import type { Team, TeamHealth } from '../../src/sim/orgscale/types';

function team(partial: Partial<Team> & Pick<Team, 'id'>): Team {
  return {
    deptId: 'dep',
    name: partial.name ?? partial.id,
    gridX: 0,
    gridY: 0,
    shipping: 10,
    aiDependency: 42,
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

describe('detailForZoom', () => {
  it('scale < 0.35 は dot', () => {
    expect(detailForZoom(0)).toBe('dot');
    expect(detailForZoom(0.349)).toBe('dot');
  });

  it('0.35 <= scale < 0.7 は badge', () => {
    expect(detailForZoom(LOD_DOT_MAX)).toBe('badge');
    expect(detailForZoom(0.5)).toBe('badge');
    expect(detailForZoom(LOD_BADGE_MAX - 0.001)).toBe('badge');
  });

  it('scale >= 0.7 は card', () => {
    expect(detailForZoom(LOD_BADGE_MAX)).toBe('card');
    expect(detailForZoom(1)).toBe('card');
    expect(detailForZoom(2)).toBe('card');
  });
});

describe('truncateName', () => {
  it('最大文字数以内はそのまま返す', () => {
    expect(truncateName('Alpha', 8)).toBe('Alpha');
  });

  it('超過分は末尾を … に置き換える', () => {
    expect(truncateName('Platform Team', BADGE_NAME_MAX_CHARS)).toBe('Platfor…');
  });

  it('maxChars <= 0 は空文字', () => {
    expect(truncateName('Alpha', 0)).toBe('');
  });
});

describe('teamIslandView', () => {
  it('card では DOM TeamIsland 相当のラベルを返す', () => {
    const labels = teamIslandView(
      team({ id: 't1', name: 'Platform', shipping: 99, aiDependency: 70, incidents: 3 }),
      'card',
    );
    expect(labels).toEqual({
      name: 'Platform',
      shipping: '出荷 99',
      ai: 'AI 70',
      fire: '🔥3',
      title: 'Platform（健全）へドリルダウン',
      showBadge: true,
    });
  });

  it('プレイヤーチームは ★ 付き名前', () => {
    const labels = teamIslandView(team({ id: 'me', name: 'My Team', isPlayer: true }), 'card');
    expect(labels.name).toBe('★ My Team');
  });

  it('炎上 0 件では fire は null', () => {
    const labels = teamIslandView(team({ id: 'ok', incidents: 0 }), 'card');
    expect(labels.fire).toBeNull();
    expect(fireLabel(0)).toBeNull();
  });

  it('badge では短い名前と炎上のみ', () => {
    const labels = teamIslandView(
      team({ id: 'long', name: 'Very Long Team Name', incidents: 2 }),
      'badge',
    );
    expect(labels.name).toBe('Very Lo…');
    expect(labels.shipping).toBeNull();
    expect(labels.ai).toBeNull();
    expect(labels.fire).toBe('🔥2');
    expect(labels.showBadge).toBe(false);
  });

  it('dot ではラベルを出さない', () => {
    const labels = teamIslandView(team({ id: 'x', name: 'Hidden' }), 'dot');
    expect(labels.name).toBe('');
    expect(labels.shipping).toBeNull();
    expect(labels.ai).toBeNull();
    expect(labels.fire).toBeNull();
    expect(labels.showBadge).toBe(false);
  });
});

/**
 * 全社マップ「シーン計画」の性能予算テスト用 fixture（GPU 不要）。
 * 格子配置は決定論的で、100 / 500 / 1000 件など任意件数を生成できる。
 */
import type { Team, TeamHealth } from '../../src/sim/orgscale/types';

/** 性能テスト用の決定論的 Team 配列を生成する。 */
export function stressOrgTeams(count: number): Team[] {
  if (count <= 0) return [];
  const cols = Math.ceil(Math.sqrt(count));
  return Array.from({ length: count }, (_, i) => {
    const gridX = i % cols;
    const gridY = Math.floor(i / cols);
    const health: TeamHealth = i % 3 === 0 ? 'healthy' : i % 3 === 1 ? 'congested' : 'reviewHell';
    return {
      id: `stress-${i}`,
      deptId: i % 2 === 0 ? 'product' : 'platform',
      name: `Stress ${i}`,
      gridX,
      gridY,
      shipping: i * 3,
      aiDependency: i % 100,
      reviewQueue: i % 8,
      incidents: i % 4,
      morale: 40 + (i % 60),
      techDebt: i * 2,
      engineers: 3 + (i % 6),
      health,
      isPlayer: i === 0,
    };
  });
}

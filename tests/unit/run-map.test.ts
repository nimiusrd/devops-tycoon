import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/sim/rng';
import {
  MAP_COLUMNS,
  bossNode,
  firstColumnNodes,
  generateRunMap,
  nodeById,
} from '../../src/sim/run/map';

describe('ランマップ生成（第4.4）', () => {
  it('同一 seed なら完全に同じマップ（決定論）', () => {
    const a = generateRunMap(createRng('m:seed'));
    const b = generateRunMap(createRng('m:seed'));
    expect(a).toEqual(b);
  });

  it('最終層にボスが 1 ノードだけ存在する', () => {
    const map = generateRunMap(createRng('boss'));
    const bosses = map.nodes.filter((n) => n.type === 'boss');
    expect(bosses).toHaveLength(1);
    expect(bosses[0].col).toBe(MAP_COLUMNS - 1);
    expect(bossNode(map)?.id).toBe(bosses[0].id);
  });

  it('第0層は通常ノードのみで、最初の選択肢になる', () => {
    const map = generateRunMap(createRng('first'));
    const first = firstColumnNodes(map);
    expect(first.length).toBeGreaterThanOrEqual(2);
    for (const id of first) expect(nodeById(map, id)?.type).toBe('normal');
  });

  it('連結性: ボス以外のどのノードからも次層へ辺があり、ボスは辿り着ける', () => {
    const map = generateRunMap(createRng('connect'));
    for (const node of map.nodes) {
      if (node.type === 'boss') continue;
      expect(node.next.length).toBeGreaterThanOrEqual(1);
      for (const nid of node.next) {
        expect(nodeById(map, nid)?.col).toBe(node.col + 1);
      }
    }
    // 第0層からボスまで列を辿れる（各層に到達可能なノードがある）。
    let reachable = new Set(firstColumnNodes(map));
    for (let c = 0; c < MAP_COLUMNS - 1; c += 1) {
      const next = new Set<string>();
      for (const id of reachable) {
        for (const nid of nodeById(map, id)!.next) next.add(nid);
      }
      reachable = next;
    }
    expect(reachable.has(bossNode(map)!.id)).toBe(true);
  });
});

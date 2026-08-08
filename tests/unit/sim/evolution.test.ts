/**
 * src/sim/run/evolution.ts の単体テスト。
 * ミューテーションテストの Survived / NoCoverage mutation を exact 断言で潰す（旧 RI-91-C4）。
 */
import { describe, expect, it } from 'vitest';
import { EVOLUTION_NODES, getEvolutionNode } from '../../../src/data/evolution';
import { canUnlock, isUnlocked, unlockableNodes, unlockNode } from '../../../src/sim/run/evolution';
import type { EvolutionState } from '../../../src/sim/run/types';

describe('RI-91-C4 evolution survived mutants', () => {
  describe('未知 ID', () => {
    it('canUnlock / unlockNode / isUnlocked は未知 ID を拒否し同一参照を返す', () => {
      const evo: EvolutionState = { points: 10, unlocked: {} };
      expect(getEvolutionNode('nope')).toBeUndefined();
      expect(canUnlock(evo, 'nope')).toBe(false);
      expect(isUnlocked(evo, 'nope')).toBe(false);
      expect(unlockNode(evo, 'nope')).toBe(evo);
      expect(evo.points).toBe(10);
      expect(evo.unlocked).toEqual({});
    });
  });

  describe('再解放 no-op', () => {
    it('既解放ノードは canUnlock=false で unlockNode が同一参照・points 不変', () => {
      const evo: EvolutionState = { points: 5, unlocked: { 'dev-1': true } };
      expect(isUnlocked(evo, 'dev-1')).toBe(true);
      expect(canUnlock(evo, 'dev-1')).toBe(false);
      expect(unlockNode(evo, 'dev-1')).toBe(evo);
      expect(evo.points).toBe(5);
      expect(evo.unlocked).toEqual({ 'dev-1': true });
    });
  });

  describe('points === cost 境界', () => {
    it('ちょうど cost なら解放でき、消費後 points は 0', () => {
      const cost = getEvolutionNode('dev-1')!.cost;
      expect(cost).toBe(1);
      const evo: EvolutionState = { points: cost, unlocked: {} };
      expect(canUnlock(evo, 'dev-1')).toBe(true);
      const next = unlockNode(evo, 'dev-1');
      expect(next).not.toBe(evo);
      expect(next.points).toBe(0);
      expect(isUnlocked(next, 'dev-1')).toBe(true);
      expect(evo.points).toBe(cost);
    });

    it('cost 未満なら解放できない', () => {
      const evo: EvolutionState = { points: 0, unlocked: {} };
      expect(canUnlock(evo, 'dev-1')).toBe(false);
      expect(unlockNode(evo, 'dev-1')).toBe(evo);
    });
  });

  describe('unlockableNodes', () => {
    it('points=0 なら空配列', () => {
      expect(unlockableNodes({ points: 0, unlocked: {} })).toEqual([]);
    });

    it('points=1 なら cost<=1 のルートだけ返す', () => {
      const expected = EVOLUTION_NODES.filter((n) => !n.requires && n.cost <= 1).map((n) => n.id);
      expect(expected).toEqual(['dev-1', 'review-1', 'quality-1']);
      expect(unlockableNodes({ points: 1, unlocked: {} })).toEqual(expected);
    });

    it('dev-1 解放済 + points=中段コストなら次ノードを含み既解放を含まない', () => {
      const midCost = getEvolutionNode('dev-2')!.cost;
      const ids = unlockableNodes({ points: midCost, unlocked: { 'dev-1': true } });
      expect(ids).toContain('dev-2');
      expect(ids).not.toContain('dev-1');
      expect(ids).toContain('review-1');
      expect(ids).toContain('quality-1');
      expect(ids).not.toContain('ai-1'); // cost 4 > mid 3
      expect(ids).not.toContain('dev-3');
    });
  });
});

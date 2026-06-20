/**
 * 組織進化ツリーの解放ロジック（SPEC 第11章）。
 *
 * 進化ポイントの割り振り（前提・コスト検査）を行う純TS。効果そのものは
 * `effects.ts` がスプリント係数へ畳み込み、加算系の組織反映は engine が行う。
 */
import { EVOLUTION_NODES, getEvolutionNode } from '../../data/evolution';
import type { EvolutionState } from './types';

/** 解放済みか。 */
export function isUnlocked(evo: EvolutionState, id: string): boolean {
  return evo.unlocked[id] === true;
}

/** そのノードを今すぐ解放できるか（存在・未解放・前提・ポイント充足）。 */
export function canUnlock(evo: EvolutionState, id: string): boolean {
  const node = getEvolutionNode(id);
  if (!node) return false;
  if (isUnlocked(evo, id)) return false;
  if (node.requires && !isUnlocked(evo, node.requires)) return false;
  return evo.points >= node.cost;
}

/**
 * ノードを解放した新しい `EvolutionState` を返す（不変・コスト消費）。
 * 解放できない場合は元の状態をそのまま返す。
 */
export function unlockNode(evo: EvolutionState, id: string): EvolutionState {
  if (!canUnlock(evo, id)) return evo;
  const node = getEvolutionNode(id)!;
  return {
    points: evo.points - node.cost,
    unlocked: { ...evo.unlocked, [id]: true },
  };
}

/** 今解放可能なノード ID 一覧。 */
export function unlockableNodes(evo: EvolutionState): string[] {
  return EVOLUTION_NODES.filter((n) => canUnlock(evo, n.id)).map((n) => n.id);
}

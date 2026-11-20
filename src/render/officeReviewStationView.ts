import { getEvolutionNode } from '../data/evolution';
import { isUnlocked } from '../sim/run/evolution';
import type { EvolutionState } from '../sim/run/types';
import { formatEvolutionNodeTags } from './eventOutcomeView';

const NODE_ID = 'review-1';

/** 設備は表示中のランまたはリプレイの解放状態から導出する。 */
export function officeReviewStationView(evolution: EvolutionState, replay = false) {
  if (!isUnlocked(evolution, NODE_ID)) return null;

  // リプレイは解放有無を保持するが、記録時の進化ノード定義は保持しない。
  const node = replay ? undefined : getEvolutionNode(NODE_ID);
  return {
    id: NODE_ID,
    name: node?.name ?? 'レビュー設備',
    description: node?.description ?? '記録時の進化効果の説明はありません。',
    tags: node ? formatEvolutionNodeTags(node) : [],
  };
}

export type OfficeReviewStationView = NonNullable<ReturnType<typeof officeReviewStationView>>;

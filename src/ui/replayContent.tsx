import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { getCard } from '../data/cards';
import { getRelic, type RelicDef } from '../data/relics';
import type { CardDef } from '../sim/types';
import type { ReplayContentSnapshot } from '../state/replay';

export interface ReplayContentContextValue {
  /** リプレイ中は保存済み定義を優先し、見つからなければプレースホルダーを返す。 */
  resolveCard: (id: string) => CardDef;
  /** リプレイ中は保存済み定義を優先し、見つからなければプレースホルダーを返す。 */
  resolveRelic: (id: string) => RelicDef;
  /** 保存済みスナップショットを参照しているか。旧 v1 は false。 */
  isReplaySnapshot: boolean;
}

function unknownCard(id: string): CardDef {
  return {
    id,
    name: '不明なカード（' + id + '）',
    rarity: 'common',
    cost: 0,
    focusCost: 0,
    description: ['記録時のカード定義が見つかりません。'],
    base: {},
  };
}

function unknownRelic(id: string): RelicDef {
  return {
    id,
    name: '不明なレリック（' + id + '）',
    description: '記録時のレリック定義が見つかりません。',
  };
}

const currentContent: ReplayContentContextValue = {
  resolveCard: (id) => getCard(id) ?? unknownCard(id),
  resolveRelic: (id) => getRelic(id) ?? unknownRelic(id),
  isReplaySnapshot: false,
};

const ReplayContentContext = createContext<ReplayContentContextValue>(currentContent);

export function createReplayContentResolver(
  contentSnapshot: ReplayContentSnapshot | null,
): ReplayContentContextValue {
  if (!contentSnapshot) return currentContent;
  const cards = new Map(contentSnapshot.cards.map((card) => [card.id, card]));
  const relics = new Map(contentSnapshot.relics.map((relic) => [relic.id, relic]));
  return {
    resolveCard: (id) => cards.get(id) ?? unknownCard(id),
    resolveRelic: (id) => relics.get(id) ?? unknownRelic(id),
    isReplaySnapshot: true,
  };
}

export function ReplayContentProvider({
  contentSnapshot,
  children,
}: {
  contentSnapshot: ReplayContentSnapshot | null;
  children: ReactNode;
}) {
  const value = useMemo(() => createReplayContentResolver(contentSnapshot), [contentSnapshot]);

  return <ReplayContentContext.Provider value={value}>{children}</ReplayContentContext.Provider>;
}

export function useReplayContent(): ReplayContentContextValue {
  return useContext(ReplayContentContext);
}

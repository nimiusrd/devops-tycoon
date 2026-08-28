import { createContext, useContext } from 'react';
import { getCard } from '../data/cards';
import { getRelic, type RelicDef } from '../data/relics';
import { resolveLiveTrial, type TrialHudView } from '../render/trialView';
import type { CardDef } from '../sim/types';
import type { ReplayContentSnapshot } from '../state/replay';

export interface ReplayContentContextValue {
  /** リプレイ中は保存済み定義を優先し、見つからなければプレースホルダーを返す。 */
  resolveCard: (id: string) => CardDef;
  /** リプレイ中は保存済み定義を優先し、見つからなければプレースホルダーを返す。 */
  resolveRelic: (id: string) => RelicDef;
  /**
   * リプレイ中は記録時の試練表示を返す。旧スナップショット（trials 省略）は
   * 現行定義へフォールバックし、未知 ID は undefined。
   */
  resolveTrial: (id: string) => TrialHudView | undefined;
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

function unknownTrial(id: string): TrialHudView {
  return {
    id,
    label: '不明な試練（' + id + '）',
    description: '記録時の試練定義が見つかりません。',
    budgetMul: 1,
  };
}

const currentContent: ReplayContentContextValue = {
  resolveCard: (id) => getCard(id) ?? unknownCard(id),
  resolveRelic: (id) => getRelic(id) ?? unknownRelic(id),
  resolveTrial: resolveLiveTrial,
  isReplaySnapshot: false,
};

export const ReplayContentContext = createContext<ReplayContentContextValue>(currentContent);

export function createReplayContentResolver(
  contentSnapshot: ReplayContentSnapshot | null,
): ReplayContentContextValue {
  if (!contentSnapshot) return currentContent;
  const cards = new Map(contentSnapshot.cards.map((card) => [card.id, card]));
  const relics = new Map(contentSnapshot.relics.map((relic) => [relic.id, relic]));
  const recordedTrials = contentSnapshot.trials
    ? new Map(contentSnapshot.trials.map((trial) => [trial.id, trial]))
    : undefined;
  return {
    resolveCard: (id) => cards.get(id) ?? unknownCard(id),
    resolveRelic: (id) => relics.get(id) ?? unknownRelic(id),
    resolveTrial:
      recordedTrials === undefined
        ? resolveLiveTrial
        : (id) => recordedTrials.get(id) ?? unknownTrial(id),
    isReplaySnapshot: true,
  };
}

export function useReplayContent(): ReplayContentContextValue {
  return useContext(ReplayContentContext);
}

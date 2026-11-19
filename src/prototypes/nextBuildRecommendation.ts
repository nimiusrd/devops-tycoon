/** RI-296。決着リプレイに記録された施策の組み合わせから次の試用候補を選ぶ。 */
import { getCard } from '../data/cards';
import { getCardUnlockByContentId, type UnlockDef } from '../data/unlocks';
import { unlockedContent, type MetaState } from '../state/meta';
import type { ReplayBlob } from '../state/replay';
import { CURRENT_RUN_RULESET } from '../state/runPersistence';
import { summarizeBuild } from './buildHistory';

const BUILD_TEMPLATES = [
  {
    id: 'quality-investment',
    cardIds: ['auto-test', 'static-analysis'],
    decision: '自動テストと静的解析に投資し、手戻りを抑える',
    tradeoff: '整備に集中力を使い、短期の実装速度が落ちる',
  },
  {
    id: 'small-pr-review',
    cardIds: ['pr-size-limit', 'review-bot'],
    decision: 'PRを小さく保ち、Botでレビューを補助する',
    tradeoff: '施策の発動に集中力を使う。レビューBotの解放が必要な場合はポイントもかかる',
  },
] as const;

type BuildTemplate = (typeof BUILD_TEMPLATES)[number];

type RecommendationBasis =
  | { kind: 'general' }
  | {
      kind: 'recorded-alternative';
      recordedCardIds: BuildTemplate['cardIds'];
      replayIds: readonly string[];
    };

export interface NextBuildRecommendation {
  template: BuildTemplate;
  basis: RecommendationBasis;
  /** 現行メタで未解放の施策を通常プールへ加える取得条件。 */
  unlocks: readonly Readonly<UnlockDef>[];
}

/**
 * 両カードが同じ終端デッキに揃う場合だけ、その組み合わせの根拠にする。
 * 中間の使用回数や記録者本人の運営傾向は判定しない。
 */
export function recommendNextBuild(
  replays: readonly ReplayBlob[],
  meta: MetaState,
): NextBuildRecommendation | null {
  const builds = replays.flatMap((replay) => {
    if (
      replay.ruleset?.version !== CURRENT_RUN_RULESET.version ||
      replay.ruleset.fingerprint !== CURRENT_RUN_RULESET.fingerprint
    ) {
      return [];
    }
    const summary = summarizeBuild(replay);
    return summary
      ? [{ id: replay.id, cardIds: new Set(summary.cards.map((card) => card.defId)) }]
      : [];
  });

  const availableCards = unlockedContent(meta).cards;
  const templates = BUILD_TEMPLATES.filter(({ cardIds }) => cardIds.every((id) => getCard(id))).map(
    (template) => ({
      template,
      replayIds: [
        ...new Set(
          builds
            .filter((build) => template.cardIds.every((id) => build.cardIds.has(id)))
            .map((build) => build.id),
        ),
      ].sort(),
      unlocks: template.cardIds.flatMap((id) => {
        if (availableCards.has(id)) return [];
        const unlock = getCardUnlockByContentId(id);
        return unlock ? [{ ...unlock }] : [];
      }),
    }),
  );

  const unobserved = templates.filter(({ replayIds }) => replayIds.length === 0);
  const next = unobserved.find(({ unlocks }) => unlocks.length === 0) ?? unobserved[0];
  if (!next) return null;

  const observed = templates.find(({ replayIds }) => replayIds.length > 0);
  return {
    template: structuredClone(next.template),
    unlocks: next.unlocks,
    basis: observed
      ? {
          kind: 'recorded-alternative',
          recordedCardIds: structuredClone(observed.template.cardIds),
          replayIds: observed.replayIds,
        }
      : { kind: 'general' },
  };
}

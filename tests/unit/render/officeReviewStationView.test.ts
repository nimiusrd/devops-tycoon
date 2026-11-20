import { describe, expect, it } from 'vitest';
import { EVOLUTION_NODES } from '../../../src/data/evolution';
import { formatEvolutionNodeTags } from '../../../src/render/eventOutcomeView';
import { officeReviewStationView } from '../../../src/render/officeReviewStationView';

describe('officeReviewStationView', () => {
  it('ポイントや別の進化があっても、対象を解放するまでは表示しない', () => {
    expect(officeReviewStationView({ points: 99, unlocked: {} })).toBeNull();
    expect(
      officeReviewStationView({ points: 0, unlocked: { 'review-1': false, 'dev-1': true } }),
    ).toBeNull();
  });

  it('解放した進化と同じ名前・説明・効果を使う', () => {
    const node = EVOLUTION_NODES.find(({ id }) => id === 'review-1')!;
    expect(officeReviewStationView({ points: 0, unlocked: { 'review-1': true } })).toEqual({
      id: node.id,
      name: node.name,
      description: node.description,
      tags: formatEvolutionNodeTags(node),
    });
  });

  it('リプレイの解放状態を表示し、記録にない効果は表示しない', () => {
    expect(officeReviewStationView({ points: 1, unlocked: {} }, true)).toBeNull();
    expect(officeReviewStationView({ points: 0, unlocked: { 'review-1': true } }, true)).toEqual({
      id: 'review-1',
      name: 'レビュー設備',
      description: '記録時の進化効果の説明はありません。',
      tags: [],
    });
  });
});

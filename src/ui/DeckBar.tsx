/**
 * デッキ / 手札表示（SPEC 第7章 / RI-30）。
 *
 * スプリント中は手札を操作可能カードとして並べ、クリックで発動する。
 * セットアップ等ではデッキコレクションを閲覧表示する。
 */
import { getCard } from '../data/cards';
import { playCost } from '../sim/cards';
import type { CardInstance, CardPlayOutcome } from '../sim/types';
import { CardView } from './CardView';

export interface DeckBarProps {
  deck: CardInstance[];
  /** スプリント中の手札（deck インデックス）。省略時はコレクション表示。 */
  hand?: number[];
  focus?: number;
  playable?: boolean;
  /** 安定な deckIndex で発動する（連打で手札がずれない）。 */
  onPlay?: (deckIndex: number) => CardPlayOutcome;
}

export function DeckBar({ deck, hand, focus = 0, playable = false, onPlay }: DeckBarProps) {
  const isHandMode = hand !== undefined && playable && onPlay;

  if (isHandMode) {
    return (
      <div className="deckbar" data-testid="deck" data-mode="hand">
        <span className="deckbar-label">手札</span>
        {hand.length === 0 ? (
          <span className="deckbar-empty">手札がありません</span>
        ) : (
          <div className="deckbar-cards">
            {hand.map((deckIndex) => {
              const inst = deck[deckIndex];
              if (!inst) return null;
              const def = getCard(inst.defId);
              if (!def) return null;
              const cost = playCost(def.cost, inst.level);
              const canPlay = focus >= cost;
              return (
                <CardView
                  key={`hand-${deckIndex}`}
                  def={def}
                  level={inst.level}
                  compact
                  playCost={cost}
                  disabled={!canPlay}
                  onPlay={() => onPlay(deckIndex)}
                />
              );
            })}
          </div>
        )}
        <span className="deckbar-meta" data-testid="deck-size">
          デッキ {deck.length}
        </span>
      </div>
    );
  }

  return (
    <div className="deckbar" data-testid="deck" data-mode="collection">
      <span className="deckbar-label">デッキ</span>
      {deck.length === 0 ? (
        <span className="deckbar-empty">
          まだカードがありません（スプリント後のドラフトで獲得）
        </span>
      ) : (
        <div className="deckbar-cards">
          {deck.map((inst, i) => {
            const def = getCard(inst.defId);
            if (!def) return null;
            return <CardView key={`${inst.defId}-${i}`} def={def} level={inst.level} compact />;
          })}
        </div>
      )}
    </div>
  );
}

/**
 * デッキ表示（SPEC 第7章）。
 *
 * 現在所持しているカード（＝このスプリントに効いている施策＝手札）を並べる。
 * ドラフトで増えるたびにここが育っていくのが見える。
 */
import { getCard } from '../data/cards';
import type { CardInstance } from '../sim/types';
import { CardView } from './CardView';

export interface DeckBarProps {
  deck: CardInstance[];
}

export function DeckBar({ deck }: DeckBarProps) {
  return (
    <div className="deckbar" data-testid="deck">
      <span className="deckbar-label">手札 / デッキ</span>
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

/**
 * デッキ / 手札表示（SPEC 第7章 / RI-30）。
 *
 * スプリント中は手札を操作可能カードとして並べ、クリックで発動する。
 * セットアップ等ではデッキコレクションを閲覧表示する。
 */
import { playCost } from '../sim/cards';
import type { CardInstance, CardPlayOutcome } from '../sim/types';
import { CardView } from './CardView';
import { useReplayContent } from './replayContent';

export interface DeckBarProps {
  deck: CardInstance[];
  /** スプリント中の手札（deck インデックス）。省略時はコレクション表示。 */
  hand?: number[];
  focus?: number;
  playable?: boolean;
  /** プレイヤー Pause 中。手札は見せたまま発動だけ止める。 */
  paused?: boolean;
  /** 安定な deckIndex で発動する（連打で手札がずれない）。 */
  onPlay?: (deckIndex: number) => CardPlayOutcome;
}

export function DeckBar({
  deck,
  hand,
  focus = 0,
  playable = false,
  paused = false,
  onPlay,
}: DeckBarProps) {
  const { resolveCard } = useReplayContent();
  const isHandMode = hand !== undefined && playable && onPlay;

  if (isHandMode) {
    return (
      <div
        className="deckbar"
        data-testid="deck"
        data-mode="hand"
        data-paused={paused ? 'true' : 'false'}
      >
        <span className="deckbar-label">手札</span>
        {hand.length === 0 ? (
          <span className="deckbar-empty">手札がありません</span>
        ) : (
          <div className="deckbar-cards">
            {hand.map((deckIndex) => {
              const inst = deck[deckIndex];
              if (!inst) return null;
              const def = resolveCard(inst.defId);
              const cost = playCost(def.focusCost, inst.level);
              const canPlay = !paused && focus >= cost;
              return (
                <CardView
                  key={`hand-${deckIndex}`}
                  def={def}
                  level={inst.level}
                  compact
                  playCost={cost}
                  disabled={!canPlay}
                  disabledReason={paused ? '一時停止中はカードを発動できない' : undefined}
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
            const def = resolveCard(inst.defId);
            return <CardView key={`${inst.defId}-${i}`} def={def} level={inst.level} compact />;
          })}
        </div>
      )}
    </div>
  );
}

/**
 * デッキ / 手札表示（SPEC 第7章 / RI-30）。
 *
 * スプリント中は手札を操作可能カードとして並べ、クリックで発動する。
 * セットアップ等ではデッキコレクションを閲覧表示する。
 */
import { ACTION_BLOCK_MESSAGES } from '../render/actionBarView';
import { playCost } from '../sim/cards';
import type { CardExchangeOutcome, CardInstance, CardPlayOutcome } from '../sim/types';
import { CardView } from './CardView';
import { useReplayContent } from './replayContent';

export interface DeckBarProps {
  deck: CardInstance[];
  /** スプリント中の手札（deck インデックス）。省略時はコレクション表示。 */
  hand?: number[];
  focus?: number;
  drawCount?: number;
  exchangesUsed?: number;
  exchangeCost?: number;
  maxExchanges?: number;
  exchangeUnavailableReason?: string;
  playable?: boolean;
  /** プレイヤー Pause 中。手札は見せたまま発動だけ止める。 */
  paused?: boolean;
  /** 安定な deckIndex で発動する（連打で手札がずれない）。 */
  onPlay?: (deckIndex: number) => CardPlayOutcome;
  /** 交換先のカードを選ぶときのハンドラ。 */
  onExchange?: (deckIndex: number) => CardExchangeOutcome;
  exchangeMode?: boolean;
  onExchangeModeChange?: (active: boolean) => void;
}

export function DeckBar({
  deck,
  hand,
  focus = 0,
  drawCount = 0,
  exchangesUsed = 0,
  exchangeCost = 2,
  maxExchanges = 2,
  exchangeUnavailableReason,
  playable = false,
  paused = false,
  onPlay,
  onExchange,
  exchangeMode = false,
  onExchangeModeChange,
}: DeckBarProps) {
  const { resolveCard } = useReplayContent();
  const isHandMode = hand !== undefined && playable && onPlay;
  const isExchangeMode = exchangeMode && !!onExchange;
  const exchangeDisabledReason =
    exchangeUnavailableReason ??
    (paused
      ? '一時停止中'
      : hand?.length === 0
        ? '手札がありません'
        : exchangesUsed >= maxExchanges
          ? 'このスプリントの交換上限です'
          : drawCount <= 0
            ? '山札に交換できるカードがありません'
            : focus < exchangeCost
              ? `集中力不足（${exchangeCost}必要）`
              : undefined);
  const exchangeStatus = isExchangeMode
    ? '交換するカードを選択'
    : exchangeDisabledReason
      ? `交換不可: ${exchangeDisabledReason}`
      : undefined;

  if (isHandMode) {
    return (
      <div
        className={onExchange ? 'deckbar deckbar-with-exchange' : 'deckbar'}
        data-testid="deck"
        data-mode="hand"
        data-paused={paused ? 'true' : 'false'}
        data-exchange-mode={isExchangeMode ? 'true' : 'false'}
      >
        <div className="deckbar-hand">
          <span className="deckbar-label">手札</span>
          {hand.length === 0 ? (
            <span className="deckbar-empty">手札がありません</span>
          ) : (
            <div className="deckbar-cards">
              {hand.map((deckIndex) => {
                const inst = deck[deckIndex];
                if (!inst) return null;
                const def = resolveCard(inst.defId);
                const cost = isExchangeMode ? exchangeCost : playCost(def.focusCost, inst.level);
                const canAct = isExchangeMode ? !exchangeDisabledReason : !paused && focus >= cost;
                const disabledReason = isExchangeMode
                  ? exchangeDisabledReason
                  : paused
                    ? ACTION_BLOCK_MESSAGES.paused
                    : focus < cost
                      ? ACTION_BLOCK_MESSAGES['no-focus']
                      : undefined;
                return (
                  <CardView
                    key={`hand-${deckIndex}`}
                    def={def}
                    level={inst.level}
                    compact
                    playCost={cost}
                    actionLabel={isExchangeMode ? '交換' : '発動'}
                    disabled={!canAct}
                    disabledReason={disabledReason}
                    onPlay={() => (isExchangeMode ? onExchange?.(deckIndex) : onPlay(deckIndex))}
                  />
                );
              })}
            </div>
          )}
        </div>
        <div className="deckbar-actions">
          <span className="deckbar-meta" data-testid="deck-size">
            デッキ {deck.length}
          </span>
          <span className="deckbar-meta" data-testid="deck-draw-count">
            山札 {drawCount}
          </span>
          <span className="deckbar-meta" data-testid="hand-exchange-count">
            交換 {exchangesUsed}/{maxExchanges}
          </span>
          {onExchange && (
            <span
              className="deckbar-exchange-status"
              data-testid="hand-exchange-status"
              role="status"
            >
              {exchangeStatus}
            </span>
          )}
          {onExchange && (
            <button
              type="button"
              className="btn btn-secondary deckbar-exchange-toggle"
              data-testid="hand-exchange-toggle"
              aria-pressed={isExchangeMode}
              disabled={!isExchangeMode && !!exchangeDisabledReason}
              title={
                isExchangeMode
                  ? '交換をやめる'
                  : (exchangeDisabledReason ?? `集中力${exchangeCost}で手札1枚を交換`)
              }
              onClick={() => onExchangeModeChange?.(!isExchangeMode)}
            >
              {isExchangeMode ? 'やめる' : `交換 ⚡${exchangeCost}`}
            </button>
          )}
        </div>
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

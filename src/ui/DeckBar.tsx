/**
 * デッキ / 手札表示（SPEC 第7章 / RI-30）。
 *
 * スプリント中は手札を操作可能カードとして並べ、クリックで発動する。
 * セットアップ等ではデッキコレクションを閲覧表示する。
 */
import { ACTION_BLOCK_MESSAGES } from '../render/actionBarView';
import {
  formatHandExchangeVisibleStatus,
  resolveHandExchangeDisabledReason,
} from '../render/handExchangeStatusView';
import { playCost } from '../sim/cards';
import type { CardExchangeOutcome, CardInstance, CardPlayOutcome } from '../sim/types';
import { CardView } from './CardView';
import { HandExchangeStatusAnnouncer } from './HandExchangeStatusAnnouncer';
import { useReplayContent } from './replayContent';
import { ScrollOverflowRow } from './ScrollOverflowRow';

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
  /** minCompleteTick 待ちなど、カード発動を止める理由（#972）。 */
  cardInteractionBlockedReason?: string;
  playable?: boolean;
  /** プレイヤー Pause 中。手札は見せたまま発動だけ止める。 */
  paused?: boolean;
  /** 安定な deckIndex で発動する（連打で手札がずれない）。 */
  onPlay?: (deckIndex: number) => CardPlayOutcome;
  /** 交換先のカードを選ぶときのハンドラ。 */
  onExchange?: (deckIndex: number) => CardExchangeOutcome;
  exchangeMode?: boolean;
  onExchangeModeChange?: (active: boolean) => void;
  /** 320×568 で手札と介入バーを入れ替える（#904）。 */
  sprintBottomRail?: 'deck' | 'controls' | null;
  onSprintBottomRailChange?: (rail: 'deck' | 'controls') => void;
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
  cardInteractionBlockedReason,
  playable = false,
  paused = false,
  onPlay,
  onExchange,
  exchangeMode = false,
  onExchangeModeChange,
  sprintBottomRail,
  onSprintBottomRailChange,
}: DeckBarProps) {
  const { resolveCard } = useReplayContent();
  const isHandMode = hand !== undefined && playable && onPlay;
  const isExchangeMode = exchangeMode && !!onExchange;
  const exchangeDisabledReason = resolveHandExchangeDisabledReason({
    exchangeUnavailableReason,
    paused,
    handLength: hand?.length,
    exchangesUsed,
    maxExchanges,
    drawCount,
    focus,
    exchangeCost,
  });
  const exchangeStatus = formatHandExchangeVisibleStatus(exchangeDisabledReason, isExchangeMode);

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
          {sprintBottomRail === 'controls' && onSprintBottomRailChange ? (
            <button
              type="button"
              className="sprint-bottom-rail-toggle"
              data-testid="sprint-bottom-rail-expand-deck"
              onClick={() => onSprintBottomRailChange('deck')}
            >
              手札を見る
            </button>
          ) : null}
          <span className="deckbar-label">手札</span>
          {hand.length === 0 ? (
            <span className="deckbar-empty">手札がありません</span>
          ) : (
            <ScrollOverflowRow className="deckbar-cards-scroll" scrollerClassName="deckbar-cards">
              {hand.map((deckIndex) => {
                const inst = deck[deckIndex];
                if (!inst) return null;
                const def = resolveCard(inst.defId);
                const cost = isExchangeMode ? exchangeCost : playCost(def.focusCost, inst.level);
                const canAct = isExchangeMode
                  ? !exchangeDisabledReason
                  : !paused && !cardInteractionBlockedReason && focus >= cost;
                const disabledReason = isExchangeMode
                  ? exchangeDisabledReason
                  : paused
                    ? ACTION_BLOCK_MESSAGES.paused
                    : cardInteractionBlockedReason
                      ? cardInteractionBlockedReason
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
                    gated={
                      !!cardInteractionBlockedReason &&
                      disabledReason === cardInteractionBlockedReason
                    }
                    disabledReason={disabledReason}
                    onPlay={() => (isExchangeMode ? onExchange?.(deckIndex) : onPlay(deckIndex))}
                  />
                );
              })}
            </ScrollOverflowRow>
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
            <>
              <span
                className="deckbar-exchange-status"
                data-testid="hand-exchange-status"
                aria-hidden="true"
              >
                {exchangeStatus}
              </span>
              <HandExchangeStatusAnnouncer
                disabledReason={exchangeDisabledReason}
                isExchangeMode={isExchangeMode}
              />
            </>
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

/**
 * スプリント内イベントティッカー（RI-52）。
 *
 * sim の `SprintState.events` を読み、直近の介入・出来事を言語化して盤面脇に出す。
 * 演出は読むだけ（第22.2）。履歴と現在値が食い違うときは「今」の段数を併記する（#357）。
 *
 * DS-01: リストは常に pointer-events: none。フォーカス中も盤面ドラッグを通す。
 * DS-06 / DS-08: 見出しの click で展開し、修飾なしホイールとキーボードで全行へ到達する。
 * #471: 既定は1行サマリー。展開中だけ履歴リストを出す。
 * DS-09: prefers-reduced-motion では入場・退場アニメを止め、静的行だけを出す。
 * 溢れたリストは touch/pen の pointerdown 時点でパンを確保し、境界キーでも外側を動かさない。
 */
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { COMBO_HUD_EVENT_WINDOW, shouldShowLiveComboHint } from '../render/sprintComboView';
import {
  clientPointHitsRegisteredBoardDrag,
  hasRegisteredBoardDragHitTest,
} from '../render/boardDragHit';
import {
  formatRecentSprintEvents,
  formatTickerSummary,
  type SprintEventView,
} from '../render/sprintEventView';
import type { SprintEvent } from '../sim/types';
import {
  applyTickerListScroll,
  applyTickerPointerPan,
  hitBlocksTickerTouchScroll,
  isTickerPointerSuppressed,
  pointInRect,
  readLineHeightPx,
  shouldCaptureTickerWheel,
  shouldClaimTickerTouchIdentifier,
  shouldClaimTickerTouchPan,
  shouldPreventTickerListKey,
  shouldPreventTickerTouchMove,
  shouldPreventTickerWheelDefault,
  tickerHasOverflow,
  tickerListKeyDelta,
  wheelDeltaYInCssPixels,
} from './eventTickerPointer';
import { VisualIcon } from './VisualIcon';

/** 同時表示する最大件数。コンボ HUD の履歴判定と同じ窓を使う。 */
const TICKER_LIMIT = COMBO_HUD_EVENT_WINDOW;

/** 退場中に行高が縮んでも本文が隣行へはみ出さない（#457）。 */
const TICKER_ROW_EXIT = {
  opacity: 0,
  height: 0,
  paddingTop: 0,
  paddingBottom: 0,
  overflow: 'hidden',
} as const;

function tickerRowBody(row: SprintEventView) {
  return (
    <>
      <span className="event-ticker-icon" aria-hidden="true">
        <VisualIcon name={row.icon} size="hud" />
      </span>
      <span className="event-ticker-text">{row.text}</span>
    </>
  );
}

/** フォーカス中のリストを矢印 / Page / Home / End でスクロールする（DS-08）。 */
function handleTickerListKeyDown(event: KeyboardEvent<HTMLUListElement>): void {
  const list = event.currentTarget;
  const overflow = tickerHasOverflow(list);
  if (!shouldPreventTickerListKey(event.key, overflow)) return;
  const parent = list.parentElement;
  const scroller = list.scrollHeight > list.clientHeight + 1 ? list : parent;
  if (!scroller) return;
  const delta = tickerListKeyDelta(
    event.key,
    scroller.clientHeight,
    scroller.scrollTop,
    scroller.scrollHeight,
  );
  if (delta == null) return;
  applyTickerListScroll(scroller, delta);
  event.preventDefault();
}

export interface EventTickerProps {
  events: readonly SprintEvent[];
  /** コンボ HUD と同じ「今」の段数。省略時は履歴のみ。 */
  liveCombo?: number;
  /** true なら入場アニメを止め、既存行だけを静的表示する（進化オーバーレイ中）。 */
  frozen?: boolean;
  /** 履歴リストの展開。省略時は内部状態。 */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

export function EventTicker({
  events,
  liveCombo = 0,
  frozen = false,
  expanded: expandedProp,
  onExpandedChange,
}: EventTickerProps) {
  const rows = formatRecentSprintEvents(events, TICKER_LIMIT);
  const summary = formatTickerSummary(rows);
  const showLiveCombo = shouldShowLiveComboHint(liveCombo, events, TICKER_LIMIT);
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(false);
  const [optimisticExpanded, setOptimisticExpanded] = useState<boolean | null>(null);
  const expanded =
    optimisticExpanded !== null && expandedProp !== optimisticExpanded
      ? optimisticExpanded
      : (expandedProp ?? uncontrolledExpanded);
  const listRef = useRef<HTMLUListElement>(null);
  const pendingFocusRef = useRef(false);
  const reduceMotion = useReducedMotion() ?? false;
  const still = frozen || reduceMotion;

  const focusList = () => {
    listRef.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!expanded || !pendingFocusRef.current) return;
    pendingFocusRef.current = false;
    focusList();
  }, [expanded]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || rows.length === 0) return;

    let touchPan: { pointerId: number; lastY: number } | null = null;

    const scrollBy = (deltaY: number): boolean => {
      if (applyTickerListScroll(list, deltaY)) return true;
      const parent = list.parentElement;
      return parent != null && applyTickerListScroll(parent, deltaY);
    };

    const onWheel = (event: WheelEvent) => {
      if (!shouldCaptureTickerWheel(event)) return;
      const root = list.parentElement ?? list;
      if (!pointInRect(event.clientX, event.clientY, root.getBoundingClientRect())) return;
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      if (isTickerPointerSuppressed(list, hit)) return;
      const deltaY = wheelDeltaYInCssPixels(
        event,
        readLineHeightPx(window.getComputedStyle(list).lineHeight),
        list.clientHeight,
      );
      const overflowed =
        list.scrollHeight > list.clientHeight + 1 ||
        (root !== list && root.scrollHeight > root.clientHeight + 1);
      if (!shouldPreventTickerWheelDefault(overflowed, deltaY)) return;
      if (event.cancelable) event.preventDefault();
      if (scrollBy(deltaY)) return;
      window.requestAnimationFrame(() => {
        scrollBy(deltaY);
      });
    };

    const shouldClaimAt = (
      clientX: number,
      clientY: number,
      pointerType: string,
      defaultPrevented: boolean,
    ): boolean => {
      if (!pointInRect(clientX, clientY, list.getBoundingClientRect())) return false;
      const hit = document.elementFromPoint(clientX, clientY);
      if (isTickerPointerSuppressed(list, hit)) return false;
      return shouldClaimTickerTouchPan({
        pointerType,
        defaultPrevented,
        overflow: tickerHasOverflow(list),
        hitsBoardDot: hitBlocksTickerTouchScroll(hit, {
          clientX,
          clientY,
          hitsBoardDot: hasRegisteredBoardDragHitTest()
            ? clientPointHitsRegisteredBoardDrag
            : undefined,
        }),
      });
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch' && !event.isPrimary) {
        touchPan = null;
        return;
      }
      if (!shouldClaimAt(event.clientX, event.clientY, event.pointerType, event.defaultPrevented)) {
        return;
      }
      touchPan = { pointerId: event.pointerId, lastY: event.clientY };
      if (event.pointerType === 'touch') return;
      if (event.cancelable) event.preventDefault();
    };

    const onTouchStart = (event: TouchEvent) => {
      if (!shouldClaimTickerTouchIdentifier(event.touches.length)) {
        touchPan = null;
        return;
      }
      const touch = event.touches[0];
      if (!shouldClaimAt(touch.clientX, touch.clientY, 'touch', event.defaultPrevented)) return;
      touchPan = { pointerId: -1, lastY: touch.clientY };
    };

    const onTouchMove = (event: TouchEvent) => {
      const pan = touchPan;
      if (!shouldPreventTickerTouchMove(event.touches.length, pan != null)) {
        if (event.touches.length !== 1) touchPan = null;
        return;
      }
      if (!pan) return;
      const touch = event.touches[0];
      pan.lastY = applyTickerPointerPan(list, pan.lastY, touch.clientY).lastY;
      if (event.cancelable) event.preventDefault();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!touchPan || event.pointerId !== touchPan.pointerId) return;
      touchPan.lastY = applyTickerPointerPan(list, touchPan.lastY, event.clientY).lastY;
      if (event.cancelable) event.preventDefault();
    };

    const onPointerUp = (event: PointerEvent) => {
      if (touchPan?.pointerId === event.pointerId) touchPan = null;
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length === 0) touchPan = null;
    };

    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('pointerdown', onPointerDown, { capture: true, passive: false });
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
    window.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
    window.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    window.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: true });
    return () => {
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('touchstart', onTouchStart, true);
      window.removeEventListener('touchmove', onTouchMove, true);
      window.removeEventListener('touchend', onTouchEnd, true);
      window.removeEventListener('touchcancel', onTouchEnd, true);
    };
  }, [rows.length]);

  const toggleExpanded = () => {
    if (rows.length === 0) return;
    const next = !expanded;
    if (next) {
      pendingFocusRef.current = true;
      focusList();
    }
    if (expandedProp === undefined) setUncontrolledExpanded(next);
    else setOptimisticExpanded(next);
    onExpandedChange?.(next);
  };

  return (
    <aside
      className="event-ticker"
      data-testid="event-ticker"
      data-expanded={expanded ? 'true' : 'false'}
      aria-label="スプリント出来事"
    >
      <button
        type="button"
        className="event-ticker-label"
        id="event-ticker-heading"
        data-testid="event-ticker-heading"
        disabled={rows.length === 0}
        aria-expanded={expanded}
        aria-controls="event-ticker-list"
        onClick={toggleExpanded}
      >
        出来事
        {rows.length > 0 && (
          <span className="event-ticker-count" data-testid="event-ticker-count" aria-hidden="true">
            {rows.length}件
          </span>
        )}
      </button>
      {!expanded && summary && (
        <p className="event-ticker-summary" data-testid="event-ticker-summary">
          {summary}
        </p>
      )}
      {showLiveCombo && expanded && (
        <p className="event-ticker-now" data-testid="event-ticker-now">
          現在 COMBO ×{liveCombo}
        </p>
      )}
      <ul
        ref={listRef}
        id="event-ticker-list"
        className="event-ticker-list"
        data-testid="event-ticker-list"
        tabIndex={expanded && rows.length > 0 ? 0 : undefined}
        aria-labelledby="event-ticker-heading"
        onKeyDown={handleTickerListKeyDown}
      >
        {still ? (
          rows.map((row) => (
            <li
              key={row.key}
              className={`event-ticker-row tone-${row.tone}`}
              data-testid={`event-ticker-row-${row.tone}`}
            >
              {tickerRowBody(row)}
            </li>
          ))
        ) : (
          <AnimatePresence initial={false}>
            {rows.map((row) => (
              <motion.li
                key={row.key}
                className={`event-ticker-row tone-${row.tone}`}
                data-testid={`event-ticker-row-${row.tone}`}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={TICKER_ROW_EXIT}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              >
                {tickerRowBody(row)}
              </motion.li>
            ))}
          </AnimatePresence>
        )}
      </ul>
    </aside>
  );
}

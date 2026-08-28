/**
 * スプリント内イベントティッカー（RI-52）。
 *
 * sim の `SprintState.events` を読み、直近の介入・出来事を言語化して盤面脇に出す。
 * 演出は読むだけ（第22.2）。
 *
 * DS-01: リストは常に pointer-events: none。フォーカス中も盤面ドラッグを通す。
 * DS-06 / DS-08: 見出しの click と修飾なしホイール、キーボードで全行へ到達する。
 * 溢れたリストは touch/pen の pointerdown 時点でパンを確保し、境界キーでも外側を動かさない。
 */
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import {
  clientPointHitsRegisteredBoardDrag,
  hasRegisteredBoardDragHitTest,
} from '../render/boardDragHit';
import { formatRecentSprintEvents } from '../render/sprintEventView';
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

/** 同時表示する最大件数。 */
const TICKER_LIMIT = 5;

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
}

export function EventTicker({ events }: EventTickerProps) {
  const rows = formatRecentSprintEvents(events, TICKER_LIMIT);
  const listRef = useRef<HTMLUListElement>(null);

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

  const focusList = () => {
    listRef.current?.focus({ preventScroll: true });
  };

  return (
    <aside className="event-ticker" data-testid="event-ticker" aria-label="スプリント出来事">
      <button
        type="button"
        className="event-ticker-label"
        id="event-ticker-heading"
        data-testid="event-ticker-heading"
        disabled={rows.length === 0}
        onClick={focusList}
      >
        出来事
      </button>
      <ul
        ref={listRef}
        className="event-ticker-list"
        data-testid="event-ticker-list"
        tabIndex={rows.length > 0 ? 0 : undefined}
        aria-labelledby="event-ticker-heading"
        onKeyDown={handleTickerListKeyDown}
      >
        <AnimatePresence initial={false}>
          {rows.map((row) => (
            <motion.li
              key={row.key}
              className={`event-ticker-row tone-${row.tone}`}
              data-testid={`event-ticker-row-${row.tone}`}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
            >
              <span className="event-ticker-icon" aria-hidden="true">
                {row.icon}
              </span>
              <span className="event-ticker-text">{row.text}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </aside>
  );
}

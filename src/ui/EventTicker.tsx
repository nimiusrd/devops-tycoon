/**
 * スプリント内イベントティッカー（RI-52）。
 *
 * sim の `SprintState.events` を読み、直近の介入・出来事を言語化して盤面脇に出す。
 * 演出は読むだけ（第22.2）。
 *
 * DS-01: リストは常に pointer-events: none。フォーカス中も盤面ドラッグを通す。
 * DS-06 / DS-08: 見出しの click と修飾なしホイール、キーボードで全行へ到達する。
 */
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { clientPointHitsRegisteredBoardDrag } from '../render/boardDragHit';
import { formatRecentSprintEvents } from '../render/sprintEventView';
import type { SprintEvent } from '../sim/types';
import {
  applyTickerListScroll,
  hitBlocksTickerTouchScroll,
  isTickerPointerSuppressed,
  pointInRect,
  readLineHeightPx,
  shouldCaptureTickerWheel,
  wheelDeltaYInCssPixels,
} from './eventTickerPointer';

/** 同時表示する最大件数。 */
const TICKER_LIMIT = 5;

/** フォーカス中のリストを矢印 / Page / Home / End でスクロールする（DS-08）。 */
function handleTickerListKeyDown(event: KeyboardEvent<HTMLUListElement>): void {
  const list = event.currentTarget;
  const parent = list.parentElement;
  const scroller =
    list.scrollHeight > list.clientHeight + 1
      ? list
      : parent != null && parent.scrollHeight > parent.clientHeight + 1
        ? parent
        : null;
  if (!scroller) return;
  const page = scroller.clientHeight;
  let delta: number;
  switch (event.key) {
    case 'ArrowDown':
      delta = 24;
      break;
    case 'ArrowUp':
      delta = -24;
      break;
    case 'PageDown':
      delta = page;
      break;
    case 'PageUp':
      delta = -page;
      break;
    case 'End':
      delta = scroller.scrollHeight;
      break;
    case 'Home':
      delta = -scroller.scrollTop;
      break;
    default:
      return;
  }
  if (!applyTickerListScroll(scroller, delta)) return;
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
      if (!overflowed) return;
      if (event.cancelable) event.preventDefault();
      if (scrollBy(deltaY)) return;
      window.requestAnimationFrame(() => {
        scrollBy(deltaY);
      });
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
      if (!pointInRect(event.clientX, event.clientY, list.getBoundingClientRect())) return;
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      if (isTickerPointerSuppressed(list, hit)) return;
      if (
        hitBlocksTickerTouchScroll(hit, {
          clientX: event.clientX,
          clientY: event.clientY,
          hitsBoardDot: clientPointHitsRegisteredBoardDrag,
        })
      ) {
        return;
      }
      touchPan = { pointerId: event.pointerId, lastY: event.clientY };
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!touchPan || event.pointerId !== touchPan.pointerId) return;
      const dy = touchPan.lastY - event.clientY;
      if (!applyTickerListScroll(list, dy)) {
        const parent = list.parentElement;
        if (parent == null || !applyTickerListScroll(parent, dy)) return;
      }
      touchPan.lastY = event.clientY;
      if (event.cancelable) event.preventDefault();
    };

    const onPointerUp = (event: PointerEvent) => {
      if (touchPan?.pointerId === event.pointerId) touchPan = null;
    };

    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
    return () => {
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
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

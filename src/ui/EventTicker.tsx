/**
 * スプリント内イベントティッカー（RI-52）。
 *
 * sim の `SprintState.events` を読み、直近の介入・出来事を言語化して盤面脇に出す。
 * 演出は読むだけ（第22.2）。
 *
 * DS-01: リストは既定で pointer-events: none。ホバーでは盤面ドラッグを奪わない。
 * DS-06 / DS-08: ホイール（修飾キーなし）・見出しタップでフォーカス・キーボードで全行へ到達する。
 */
import { AnimatePresence, motion } from 'framer-motion';
import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { formatRecentSprintEvents } from '../render/sprintEventView';
import type { SprintEvent } from '../sim/types';
import {
  applyTickerListScroll,
  hitBlocksTickerTouchScroll,
  pointInRect,
  shouldCaptureTickerWheel,
} from './eventTickerPointer';

/** 同時表示する最大件数。 */
const TICKER_LIMIT = 5;

/** フォーカス中のリストを矢印 / Page / Home / End でスクロールする（DS-08）。 */
function handleTickerListKeyDown(event: KeyboardEvent<HTMLUListElement>): void {
  const list = event.currentTarget;
  if (list.scrollHeight <= list.clientHeight + 1) return;
  const page = list.clientHeight;
  let next = list.scrollTop;
  switch (event.key) {
    case 'ArrowDown':
      next += 24;
      break;
    case 'ArrowUp':
      next -= 24;
      break;
    case 'PageDown':
      next += page;
      break;
    case 'PageUp':
      next -= page;
      break;
    case 'End':
      next = list.scrollHeight;
      break;
    case 'Home':
      next = 0;
      break;
    default:
      return;
  }
  event.preventDefault();
  list.scrollTop = next;
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

    const onWheel = (event: WheelEvent) => {
      if (!shouldCaptureTickerWheel(event)) return;
      if (!pointInRect(event.clientX, event.clientY, list.getBoundingClientRect())) return;
      if (!applyTickerListScroll(list, event.deltaY)) return;
      event.preventDefault();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
      if (!pointInRect(event.clientX, event.clientY, list.getBoundingClientRect())) return;
      if (hitBlocksTickerTouchScroll(document.elementFromPoint(event.clientX, event.clientY))) {
        return;
      }
      touchPan = { pointerId: event.pointerId, lastY: event.clientY };
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!touchPan || event.pointerId !== touchPan.pointerId) return;
      const dy = touchPan.lastY - event.clientY;
      if (!applyTickerListScroll(list, dy)) return;
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

  const focusList = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    listRef.current?.focus();
  };

  return (
    <aside className="event-ticker" data-testid="event-ticker" aria-label="スプリント出来事">
      <button
        type="button"
        className="event-ticker-label"
        id="event-ticker-heading"
        data-testid="event-ticker-heading"
        tabIndex={-1}
        onPointerDown={focusList}
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

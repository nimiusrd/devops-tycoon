/**
 * スプリント内イベントティッカー（RI-52）。
 *
 * sim の `SprintState.events` を読み、直近の介入・出来事を言語化して盤面脇に出す。
 * 演出は読むだけ（第22.2）。
 *
 * DS-01: 既定は pointer-events を通し、武装中の盤面ドラッグを奪わない。
 * DS-06 / DS-08: ホバー・フォーカス中だけリストがスクロール操作を受ける。
 */
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { formatRecentSprintEvents } from '../render/sprintEventView';
import type { SprintEvent } from '../sim/types';

/** 同時表示する最大件数。 */
const TICKER_LIMIT = 5;

function pointInRect(x: number, y: number, rect: DOMRect): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

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
  const [pointerHot, setPointerHot] = useState(false);

  useEffect(() => {
    const list = listRef.current;
    if (!list || rows.length === 0) {
      setPointerHot(false);
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      // 盤面ドラッグ中はホットにせず、ポインターを盤面へ通し続ける。
      if (event.buttons !== 0) return;
      setPointerHot(pointInRect(event.clientX, event.clientY, list.getBoundingClientRect()));
    };

    const onWheel = (event: WheelEvent) => {
      if (!pointInRect(event.clientX, event.clientY, list.getBoundingClientRect())) return;
      if (list.scrollHeight <= list.clientHeight + 1) return;
      const max = list.scrollHeight - list.clientHeight;
      const next = Math.min(max, Math.max(0, list.scrollTop + event.deltaY));
      if (next === list.scrollTop) return;
      event.preventDefault();
      list.scrollTop = next;
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('wheel', onWheel, true);
    };
  }, [rows.length]);

  return (
    <aside className="event-ticker" data-testid="event-ticker" aria-label="スプリント出来事">
      <p className="event-ticker-label" id="event-ticker-heading">
        出来事
      </p>
      <ul
        ref={listRef}
        className={`event-ticker-list${pointerHot ? ' is-pointer-hot' : ''}`}
        data-testid="event-ticker-list"
        data-pointer-hot={pointerHot ? 'true' : undefined}
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

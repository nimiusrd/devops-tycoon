/**
 * スプリント内イベントティッカー（RI-52）。
 *
 * sim の `SprintState.events` を読み、直近の介入・出来事を言語化して盤面脇に出す。
 * 演出は読むだけ（第22.2）。
 */
import { AnimatePresence, motion } from 'framer-motion';
import { formatRecentSprintEvents } from '../render/sprintEventView';
import type { SprintEvent } from '../sim/types';

/** 同時表示する最大件数。 */
const TICKER_LIMIT = 5;

export interface EventTickerProps {
  events: readonly SprintEvent[];
}

export function EventTicker({ events }: EventTickerProps) {
  const rows = formatRecentSprintEvents(events, TICKER_LIMIT);

  return (
    <aside className="event-ticker" data-testid="event-ticker" aria-label="スプリント出来事">
      <p className="event-ticker-label">出来事</p>
      <ul className="event-ticker-list">
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

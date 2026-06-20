/**
 * 分岐選択イベント画面（SPEC 第9.4）。
 *
 * トレードオフのある選択肢を提示する。選択の積み重ねが組織の「文化」を形作る。
 */
import { getEvent } from '../data/events';
import type { RunState } from '../sim/run/types';

export interface EventScreenProps {
  state: RunState;
  onChoose: (index: number) => void;
}

export function EventScreen({ state, onChoose }: EventScreenProps) {
  const ev = state.eventId ? getEvent(state.eventId) : undefined;
  if (!ev) return null;
  return (
    <div className="result-overlay" data-testid="event" role="dialog" aria-label="Event">
      <div className={`event-panel tone-${ev.tone}`}>
        <p className="result-eyebrow">EVENT</p>
        <h2 className="event-title">{ev.title}</h2>
        <p className="event-prompt">{ev.prompt}</p>
        <div className="event-choices">
          {ev.choices.map((choice, i) => (
            <button
              type="button"
              key={i}
              className="event-choice"
              data-testid={`event-choice-${i}`}
              onClick={() => onChoose(i)}
            >
              <span className="event-choice-label">{choice.label}</span>
              <span className="event-choice-desc">{choice.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

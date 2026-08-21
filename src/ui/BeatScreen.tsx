/**
 * ビート（スプリント間イベント）画面（SPEC 第4.4 / 第9章）。
 *
 * 固定トラックのスプリントの合間に出るイベントを提示する。
 * - 判定イベント（judgment）: 選択肢を出さず「了解」で自動適用（制御できない緊張感）。
 * - 選択イベント（decision）: リスク/リターンの 2〜3 択。安全側にも代償がある。
 * 「予算で補強」「一息つく」は選択後にショップ/休息へ遷移する。
 */
import { getEvent } from '../data/events';
import { formatEventChoiceTags, formatEventOutcomeTags } from '../render/eventOutcomeView';
import type { RunState } from '../sim/run/types';
import { EffectTagList } from './EffectTagList';
import { useReplayContent } from './replayContent';

export interface BeatScreenProps {
  state: RunState;
  onResolve: (choiceIndex?: number) => void;
}

export function BeatScreen({ state, onResolve }: BeatScreenProps) {
  const { resolveCard, resolveRelic } = useReplayContent();
  const contentResolver = { getCard: resolveCard, getRelic: resolveRelic };
  const beat = state.beat;
  const ev = beat ? getEvent(beat.eventId) : undefined;
  if (!beat || !ev) return null;

  if (beat.kind === 'judgment') {
    const outcome = ev.choices[0];
    return (
      <div className="result-overlay" data-testid="beat" data-kind="judgment" role="dialog">
        <div className={`event-panel tone-${ev.tone}`}>
          <p className="result-eyebrow">JUDGMENT</p>
          <h2 className="event-title">{ev.title}</h2>
          <p className="event-prompt">{ev.prompt}</p>
          {outcome && (
            <>
              <EffectTagList tags={formatEventOutcomeTags(outcome.outcome, contentResolver)} />
              {outcome.description && <p className="event-choice-desc">{outcome.description}</p>}
            </>
          )}
          <div className="event-choices">
            <button
              type="button"
              className="event-choice"
              data-testid="beat-ack"
              onClick={() => onResolve()}
            >
              <span className="event-choice-label">了解</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="result-overlay" data-testid="beat" data-kind="decision" role="dialog">
      <div className={`event-panel tone-${ev.tone}`}>
        <p className="result-eyebrow">DECISION</p>
        <h2 className="event-title">{ev.title}</h2>
        <p className="event-prompt">{ev.prompt}</p>
        <div className="event-choices">
          {ev.choices.map((choice, i) => (
            <button
              type="button"
              key={i}
              className="event-choice"
              data-testid={`beat-choice-${i}`}
              onClick={() => onResolve(i)}
            >
              <span className="event-choice-label">{choice.label}</span>
              <EffectTagList tags={formatEventChoiceTags(choice, contentResolver)} />
              {choice.description && (
                <span className="event-choice-desc">{choice.description}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * ビート（スプリント間イベント）画面（SPEC 第4.4 / 第9章）。
 *
 * 固定トラックのスプリントの合間に出るイベントを提示する。
 * - 判定イベント（judgment）: 選択肢を出さず「了解」で自動適用（制御できない緊張感）。
 * - 選択イベント（decision）: リスク/リターンの 2〜3 択。安全側にも代償がある。
 * 「予算で補強」「一息つく」は選択後にショップ/休息へ遷移する。
 */
import { useEffect, useRef, useState } from 'react';
import { getEvent, type EventDef } from '../data/events';
import { formatEventChoiceTags, formatEventOutcomeTags } from '../render/eventOutcomeView';
import type { RunState } from '../sim/run/types';
import { EffectTagList } from './EffectTagList';
import { useReplayContent } from './replayContent';
import { useDialogOverlayLock } from './useDialogOverlayLock';

export interface BeatScreenProps {
  state: RunState;
  onResolve: (choiceIndex?: number) => void;
}

interface DecisionDialogProps {
  event: EventDef;
  onResolve: (choiceIndex: number) => void;
  onDismiss: () => void;
}

function DecisionDialog({ event, onResolve, onDismiss }: DecisionDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const { resolveCard, resolveRelic } = useReplayContent();
  const contentResolver = { getCard: resolveCard, getRelic: resolveRelic };
  useDialogOverlayLock(overlayRef, { onDismiss });

  return (
    <div
      ref={overlayRef}
      className="result-overlay"
      data-testid="beat"
      data-kind="decision"
      role="dialog"
      aria-modal="true"
      aria-labelledby="decision-title"
      aria-describedby="decision-prompt"
      tabIndex={-1}
    >
      <div className={`event-panel tone-${event.tone}`}>
        <p className="result-eyebrow">DECISION</p>
        <h2 className="event-title" id="decision-title">
          {event.title}
        </h2>
        <p className="event-prompt" id="decision-prompt">
          {event.prompt}
        </p>
        <div className="event-choices">
          {event.choices.map((choice, i) => (
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
        <button
          type="button"
          className="btn btn-secondary beat-dismiss"
          data-testid="beat-dismiss"
          onClick={onDismiss}
        >
          状況を確認する
        </button>
      </div>
    </div>
  );
}

function DecisionReminder({ event, onOpen }: { event: EventDef; onOpen: () => void }) {
  const openButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    openButtonRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section className={`event-panel tone-${event.tone} beat-pending`} data-testid="beat-pending">
      <div>
        <p className="result-eyebrow">DECISION PENDING</p>
        <h2 className="event-title">{event.title}</h2>
        <p className="event-prompt">選択はまだ確定していません。状況を確認してから戻れます。</p>
      </div>
      <button
        ref={openButtonRef}
        type="button"
        className="btn btn-primary"
        data-testid="beat-reopen"
        onClick={onOpen}
      >
        判断に戻る
      </button>
    </section>
  );
}

export function BeatScreen({ state, onResolve }: BeatScreenProps) {
  const [decisionOpen, setDecisionOpen] = useState(true);
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

  if (!decisionOpen) {
    return <DecisionReminder event={ev} onOpen={() => setDecisionOpen(true)} />;
  }

  return (
    <DecisionDialog event={ev} onResolve={onResolve} onDismiss={() => setDecisionOpen(false)} />
  );
}

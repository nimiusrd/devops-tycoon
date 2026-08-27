/**
 * 中断ランがあるときのデイリー開始確認（#367）。
 *
 * プレイヤー判断: 途中セーブを守って再開するか、上書きしてデイリーを始めるか。
 * 既存の `.result-overlay` を確認ダイアログとして使う。
 */
import { useEffect, useId, useRef } from 'react';
import type { RunSaveSummary } from '../state/runPersistence';
import { resumableRunDetail, resumableRunHeadline } from './runSaveSummaryCopy';

export interface StartDailyConfirmDialogProps {
  summary: RunSaveSummary;
  canResume: boolean;
  onCancel: () => void;
  onResume: () => void;
  onDiscardAndStart: () => void;
}

export function StartDailyConfirmDialog({
  summary,
  canResume,
  onCancel,
  onResume,
  onDiscardAndStart,
}: StartDailyConfirmDialogProps) {
  const titleId = useId();
  const descId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const previouslyFocused = document.activeElement;
    const initial = canResume ? resumeRef.current : cancelRef.current;
    (initial ?? root).focus();

    const focusableButtons = (): HTMLButtonElement[] => [
      ...root.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
    ];

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;
      const buttons = focusableButtons();
      if (buttons.length === 0) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [canResume, onCancel]);

  return (
    <div
      ref={rootRef}
      className="result-overlay start-daily-confirm"
      data-testid="start-daily-confirm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      tabIndex={-1}
    >
      <div className="result-card start-daily-confirm-card">
        <p className="result-eyebrow">確認</p>
        <h2 className="draft-title" id={titleId}>
          中断中のランがあります
        </h2>
        <p className="start-daily-confirm-state">
          <b>{resumableRunHeadline(summary)}</b>
          <small>{resumableRunDetail(summary)}</small>
        </p>
        <p className="start-daily-confirm-risk" id={descId}>
          デイリーを始めると途中セーブが上書きされ、このランは続きから再開できなくなります。先に再開するか、中断ランを捨てるかを選んでください。
        </p>
        <div className="start-daily-confirm-actions">
          <button
            ref={cancelRef}
            type="button"
            className="btn btn-secondary"
            data-testid="start-daily-confirm-cancel"
            onClick={onCancel}
          >
            戻る
          </button>
          {canResume ? (
            <button
              ref={resumeRef}
              type="button"
              className="btn btn-primary"
              data-testid="start-daily-confirm-resume"
              onClick={onResume}
            >
              続きから再開
            </button>
          ) : null}
          <button
            type="button"
            className="btn start-daily-confirm-discard"
            data-testid="start-daily-confirm-discard"
            onClick={onDiscardAndStart}
          >
            中断ランを捨ててデイリーを始める
          </button>
        </div>
      </div>
    </div>
  );
}

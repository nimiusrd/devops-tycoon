/**
 * 中断ランがあるときのデイリー開始確認（#367）。
 *
 * 再開できるとき: 途中セーブを守って再開するか、上書きしてデイリーを始めるか。
 * 再開できないとき: 戻るか、互換のないセーブを捨ててデイリーを始めるか。
 * 既存の `.result-overlay` と `useDialogOverlayLock` でモーダル契約（DS-08）を守る。
 */
import { useEffect, useId, useRef } from 'react';
import type { RunSaveSummary } from '../state/runPersistence';
import {
  resumableRunDetail,
  resumableRunHeadline,
  startDailyConfirmRiskText,
  startDailyConfirmTitle,
} from './runSaveSummaryCopy';
import { useDialogOverlayLock } from './useDialogOverlayLock';

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
    const initial = canResume ? resumeRef.current : cancelRef.current;
    (initial ?? root).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCancel();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [canResume, onCancel]);
  useDialogOverlayLock(rootRef);

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
          {startDailyConfirmTitle(canResume)}
        </h2>
        <p className="start-daily-confirm-state">
          <b>{resumableRunHeadline(summary)}</b>
          <small>{resumableRunDetail(summary)}</small>
        </p>
        <p className="start-daily-confirm-risk" id={descId}>
          {startDailyConfirmRiskText(canResume)}
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

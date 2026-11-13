import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { leaveReturnSpeech, leaveReturnSummaryParts } from '../render/leaveReturnNoticeView';
import { planLeaveReturnNotices } from '../sim/member';
import type { LeaveReturnNotice } from '../sim/member/types';
import {
  noteAnnouncedLeaveReturnSpeech,
  readAnnouncedLeaveReturnSpeech,
} from './leaveReturnSpeech';

/**
 * 編成ヒントと、休職復帰の通知。
 * ヒントの下に1行分を空け、収まるときだけ要約を出す。
 * 収まらないときは警告を優先し、復帰は読み上げだけにする。
 * live region は空でマウントし、その後に文を入れる。読み上げは1回。
 */
export function LeaveReturnNotices({
  hint,
  notices,
  runEpoch,
  teamId,
}: {
  hint: string;
  notices: readonly LeaveReturnNotice[];
  /** startRun ごとの世代。別ランの同じ文は、空の領域から読み上げ直す。 */
  runEpoch: number;
  /** 入り込み先。チームが変わったら、そのチームの復帰者で余白を取り直す。 */
  teamId: string;
}) {
  const unique = planLeaveReturnNotices(notices, []);
  const speech = leaveReturnSpeech(unique);
  const summary = leaveReturnSummaryParts(unique);
  const copyRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLParagraphElement>(null);
  const [showSummary, setShowSummary] = useState(false);
  // 余白を足すかは、このチームの編成画面を開いたときの復帰者で決める。
  const reserveKey = `${runEpoch}:${teamId}`;
  const [reserved, setReserved] = useState({ key: reserveKey, line: notices.length > 0 });
  if (reserved.key !== reserveKey) {
    setReserved({ key: reserveKey, line: notices.length > 0 });
  }
  const reserveLine = reserved.key === reserveKey ? reserved.line : notices.length > 0;
  const [spoken, setSpoken] = useState(() =>
    speech !== '' && readAnnouncedLeaveReturnSpeech(reserveKey) === speech ? speech : '',
  );

  useLayoutEffect(() => {
    const hintEl = hintRef.current;
    const copyEl = copyRef.current;
    if (!hintEl || !copyEl) return;
    const measure = () => {
      if (unique.length === 0) {
        setShowSummary(false);
        return;
      }
      const lineHeight = Number.parseFloat(getComputedStyle(hintEl).lineHeight);
      // 警告の本文に1行を足しても枠へ収まるときだけ、要約を出す。
      setShowSummary(
        Number.isFinite(lineHeight) && hintEl.scrollHeight + lineHeight <= copyEl.clientHeight + 1,
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(copyEl);
    return () => observer.disconnect();
  }, [hint, summary?.name, summary?.tail, unique.length]);

  useEffect(() => {
    let cancelled = false;
    const publish = () => {
      if (cancelled) return;
      if (!speech) {
        setSpoken('');
        return;
      }
      if (readAnnouncedLeaveReturnSpeech(reserveKey) !== speech) {
        noteAnnouncedLeaveReturnSpeech(reserveKey, speech);
      }
      setSpoken(speech);
    };
    if (typeof requestAnimationFrame !== 'function') {
      queueMicrotask(publish);
      return () => {
        cancelled = true;
      };
    }
    const frame = requestAnimationFrame(publish);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [reserveKey, speech]);

  return (
    <div
      ref={copyRef}
      className="formation-setup-copy"
      data-reserve={reserveLine ? 'true' : undefined}
    >
      <p ref={hintRef} className="formation-setup-hint">
        {hint}
      </p>
      {showSummary && summary ? (
        <p className="leave-return-summary" data-testid="leave-return-summary" aria-hidden="true">
          <span className="leave-return-name">{summary.name}</span>
          <span className="leave-return-tail">{summary.tail}</span>
        </p>
      ) : null}
      <div
        className="leave-return-slot"
        data-testid="leave-return-slot"
        data-empty={spoken ? undefined : 'true'}
      >
        <div role="status" aria-live="polite" aria-atomic="true" data-testid="leave-return-status">
          {spoken}
        </div>
      </div>
    </div>
  );
}

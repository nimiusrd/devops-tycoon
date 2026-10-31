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
 * 通知の見た目はヒント枠の下端1行だけ。枠はヒントの高さのままにする。
 * 1行を足すと警告が隠れるときは見た目を出さず、読み上げだけにする。
 * live region は空でマウントし、その後に文を入れる。読み上げは1回。
 */
export function LeaveReturnNotices({
  hint,
  notices,
}: {
  hint: string;
  notices: readonly LeaveReturnNotice[];
}) {
  const unique = planLeaveReturnNotices(notices, []);
  const speech = leaveReturnSpeech(unique);
  const summary = leaveReturnSummaryParts(unique);
  const copyRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLParagraphElement>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [spoken, setSpoken] = useState(() =>
    speech !== '' && readAnnouncedLeaveReturnSpeech() === speech ? speech : '',
  );

  useLayoutEffect(() => {
    const hintEl = hintRef.current;
    const copyEl = copyRef.current;
    if (!hintEl || !copyEl || unique.length === 0) {
      setShowSummary(false);
      return;
    }
    const lineHeight = Number.parseFloat(getComputedStyle(hintEl).lineHeight);
    // 警告の本文に1行を足しても枠へ収まるときだけ、要約を出す。
    setShowSummary(
      Number.isFinite(lineHeight) && hintEl.scrollHeight + lineHeight <= copyEl.clientHeight + 1,
    );
  }, [hint, summary?.name, summary?.tail, unique.length]);

  useEffect(() => {
    let cancelled = false;
    const publish = () => {
      if (cancelled) return;
      if (!speech) {
        setSpoken('');
        return;
      }
      if (readAnnouncedLeaveReturnSpeech() !== speech) noteAnnouncedLeaveReturnSpeech(speech);
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
  }, [speech]);

  return (
    <div ref={copyRef} className="formation-setup-copy">
      <p ref={hintRef} className="formation-setup-hint">
        {hint}
      </p>
      {showSummary && (
        <p className="leave-return-summary" data-testid="leave-return-summary" aria-hidden="true">
          <span className="leave-return-name">{summary.name}</span>
          <span className="leave-return-tail">{summary.tail}</span>
        </p>
      )}
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

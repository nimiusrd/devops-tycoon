import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { leaveReturnSpeech, leaveReturnSummary } from '../render/leaveReturnNoticeView';
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
  const summary = leaveReturnSummary(unique);
  const hintRef = useRef<HTMLParagraphElement>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [spoken, setSpoken] = useState(() =>
    speech !== '' && readAnnouncedLeaveReturnSpeech() === speech ? speech : '',
  );

  useLayoutEffect(() => {
    const hintEl = hintRef.current;
    if (!hintEl || unique.length === 0) {
      setShowSummary(false);
      return;
    }
    const lineHeight = Number.parseFloat(getComputedStyle(hintEl).lineHeight);
    // 下端の1行を通知に使っても、警告の先頭行が残るときだけ重ねる。
    setShowSummary(Number.isFinite(lineHeight) && hintEl.clientHeight > lineHeight + 1);
  }, [hint, summary, unique.length]);

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
    <div className="formation-setup-copy">
      <p ref={hintRef} className="formation-setup-hint">
        {hint}
      </p>
      {showSummary && (
        <p className="leave-return-summary" data-testid="leave-return-summary" aria-hidden="true">
          {summary}
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

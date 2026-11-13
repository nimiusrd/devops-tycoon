import { useEffect, useRef, useState } from 'react';
import {
  publishSplitPrConfirmAnnouncement,
  type SplitPrConfirmCue,
} from '../render/splitPrConfirmView';

/**
 * PR 分割成功時の polite 読み上げ。空でマウントし、次フレームで文を入れる（#1020）。
 */
export function SplitPrConfirmAnnouncer({ cue }: { cue: SplitPrConfirmCue | null }) {
  const lastSpokenKeyRef = useRef<string | null>(null);
  const [spoken, setSpoken] = useState('');

  useEffect(() => {
    let cancelled = false;
    const publish = () => {
      if (cancelled) return;
      const next = publishSplitPrConfirmAnnouncement(lastSpokenKeyRef.current, cue);
      if (!next) return;
      lastSpokenKeyRef.current = next.lastSpokenKey;
      setSpoken(next.text);
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
  }, [cue]);

  return (
    <div
      className="visually-hidden"
      data-testid="split-pr-confirm-live"
      data-empty={spoken ? undefined : 'true'}
    >
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="split-pr-confirm-announce"
      >
        {spoken}
      </div>
    </div>
  );
}

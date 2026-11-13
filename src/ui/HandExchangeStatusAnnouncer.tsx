import { useEffect, useRef, useState } from 'react';
import {
  handExchangeAnnouncementKey,
  publishHandExchangeAnnouncement,
} from '../render/handExchangeStatusView';

/**
 * 手札交換の polite 読み上げ。空でマウントし、次フレームで文を入れる。
 * 理由キーが変わらない限り live region を更新しない（#1024）。
 */
export function HandExchangeStatusAnnouncer({
  disabledReason,
  isExchangeMode,
}: {
  disabledReason: string | undefined;
  isExchangeMode: boolean;
}) {
  const announcementKey = handExchangeAnnouncementKey(disabledReason, isExchangeMode);
  const lastSpokenKeyRef = useRef<string | null>(null);
  const [spoken, setSpoken] = useState('');

  useEffect(() => {
    let cancelled = false;
    const publish = () => {
      if (cancelled) return;
      const next = publishHandExchangeAnnouncement(lastSpokenKeyRef.current, announcementKey);
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
  }, [announcementKey]);

  return (
    <div
      className="deckbar-exchange-live visually-hidden"
      data-testid="hand-exchange-status-live"
      data-empty={spoken ? undefined : 'true'}
    >
      <div role="status" aria-live="polite" aria-atomic="true">
        {spoken}
      </div>
    </div>
  );
}

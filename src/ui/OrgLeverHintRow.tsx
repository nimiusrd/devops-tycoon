import { useEffect, useState } from 'react';
import { ORG_LEVER_HINT_MESSAGE } from '../render/orgLeverHintView';

/**
 * 編成を開いた時点の判定だけを行にする。
 * 開いている途中で条件が揃っても行は足さない。
 * 消すのは、レバーを開いたときか予算が 0 になったときだけ。
 *
 * 読み上げ用の live region は RunBar に1つだけ置く（#1019）。
 */
export function OrgLeverHintRow({
  eligible,
  dismissed,
}: {
  eligible: boolean;
  dismissed: boolean;
}) {
  const [includedAtOpen] = useState(eligible);
  if (!includedAtOpen || dismissed) return null;
  return (
    <p className="org-lever-hint" data-testid="org-lever-hint" aria-hidden="true">
      {ORG_LEVER_HINT_MESSAGE}
    </p>
  );
}

/**
 * 組織レバー案内の polite 読み上げ。空でマウントし、次フレームで文を入れる。
 */
export function OrgLeverHintLiveAnnouncer({ active }: { active: boolean }) {
  const [spoken, setSpoken] = useState('');

  useEffect(() => {
    let cancelled = false;
    const publish = () => {
      if (cancelled) return;
      setSpoken(active ? ORG_LEVER_HINT_MESSAGE : '');
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
  }, [active]);

  if (!active) return null;

  return (
    <div
      className="org-lever-hint-live"
      data-testid="org-lever-hint-live"
      data-empty={spoken ? undefined : 'true'}
    >
      <div role="status" aria-live="polite" aria-atomic="true" data-testid="org-lever-hint-status">
        {spoken}
      </div>
    </div>
  );
}

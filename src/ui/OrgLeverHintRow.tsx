import { useEffect, useState } from 'react';
import { ORG_LEVER_HINT_MESSAGE } from '../render/orgLeverHintView';

/**
 * 編成を開いた時点の判定だけを行にする（#966 / #985）。
 * 開いている途中で条件が揃っても行は足さない。
 * 予算 0 やレバー開閉でセッションが消去されても、閉じるまで行は残す。
 * 次に同じ画面を開いたときに出すかどうかを決め直す。
 *
 * 黄色い点の出入りは RunBar がライブ判定する（#969）。
 * 読み上げ用 live region は RunBar から body へ1つだけ出す（#1019）。
 */
export function OrgLeverHintRow({ eligible }: { eligible: boolean }) {
  const [includedAtOpen] = useState(eligible);
  if (!includedAtOpen) return null;
  return (
    <p className="org-lever-hint" data-testid="org-lever-hint">
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

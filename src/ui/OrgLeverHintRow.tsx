import { useState } from 'react';
import { ORG_LEVER_HINT_MESSAGE } from '../render/orgLeverHintView';

/**
 * 編成を開いた時点の判定だけを行にする。
 * 開いている途中で条件が揃っても行は足さない。
 * 消すのは、レバーを開いたときか予算が 0 になったときだけ。
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
    <p className="org-lever-hint" data-testid="org-lever-hint" role="status">
      {ORG_LEVER_HINT_MESSAGE}
    </p>
  );
}

/**
 * 編成画面の組織レバー案内行。
 *
 * 開いた時点で条件を満たすときだけ、最初の描画から一行を置く。
 * 開いている途中では行を足さない。消えるのは組織レバーを開いたときだけ。
 */
import { useState } from 'react';
import {
  isShopOfferPresent,
  ORG_LEVER_HINT_MESSAGE,
  shouldShowOrgLeverHint,
} from '../render/orgLeverHintView';
import type { RunState } from '../sim/run/types';
import {
  createOrgLeverHintOpenToken,
  orgLeverHintRowFromOpen,
  readOrgLeverHintSession,
} from './orgLeverHintSession';

export function OrgLeverHintRow({
  state,
  readOnly = false,
  runEpoch = 0,
  kind,
}: {
  state: Pick<RunState, 'quarterNumber' | 'budget' | 'phase' | 'beat' | 'shop'>;
  readOnly?: boolean;
  runEpoch?: number;
  kind: 'setup' | 'formation';
}) {
  const [openToken] = useState(() => createOrgLeverHintOpenToken(kind));
  const session = readOrgLeverHintSession(runEpoch);
  const showRow =
    orgLeverHintRowFromOpen(
      openToken,
      shouldShowOrgLeverHint({
        quarterNumber: state.quarterNumber,
        budget: state.budget,
        shopArrived: isShopOfferPresent(state) || session.shopArrived,
        dismissed: session.dismissed,
        readOnly,
      }),
    ) && !session.dismissed;

  if (!showRow) return null;

  return (
    <p className="formation-setup-hint" data-testid="org-lever-hint" role="status">
      {ORG_LEVER_HINT_MESSAGE}
    </p>
  );
}

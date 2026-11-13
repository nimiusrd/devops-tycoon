/**
 * 組織レバー一覧（全社・部署・チーム共通）。
 *
 * 支払後に予算が尽きる操作はショップと同じ SpendConfirm で一度だけ確定させる（RI-147 / #1016）。
 */
import { useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { LeverDef } from '../sim/orgscale/types';
import { formatLeverDefTags, formatLeverTooltip } from '../render/eventOutcomeView';
import { spendRiskView, type SpendRiskView } from '../render/spendRiskView';
import { EffectTagList } from './EffectTagList';
import { focusByTestId } from './focusByTestId';
import { SpendConfirm } from './SpendConfirm';
import { useDialogOverlayLock } from './useDialogOverlayLock';

interface PendingLeverSpend {
  lever: LeverDef;
  risk: SpendRiskView;
  returnTestId: string;
}

export interface OrgLeverListProps {
  levers: readonly LeverDef[];
  budget: number;
  regionTestId: string;
  regionLabel: string;
  title: string;
  onApply: (leverId: string) => void;
  leverAriaLabel?: (lever: LeverDef) => string;
  /** タブ競合モーダルなど、別ダイアログが背面ロックを担う間は確認を出さない。 */
  spendConfirmEnabled?: boolean;
  /** minCompleteTick 待ちなど、レバー操作全体を止める理由（#972）。 */
  sprintInteractionBlockedReason?: string;
}

function OrgLeverSpendGate({
  pending,
  onConfirm,
  onCancel,
}: {
  pending: PendingLeverSpend;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLDivElement>(null);
  useDialogOverlayLock(confirmRef, {
    restoreFocus: true,
    onDismiss: onCancel,
  });
  return (
    <OrgLeverSpendOverlay
      pending={pending}
      confirmRef={confirmRef}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

function OrgLeverSpendOverlay({
  pending,
  confirmRef,
  onConfirm,
  onCancel,
}: {
  pending: PendingLeverSpend;
  confirmRef: RefObject<HTMLDivElement | null>;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const layer = (
    <div
      ref={confirmRef}
      className="result-overlay overlay-contained org-lever-spend-overlay"
      data-testid="org-lever-spend-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="予算枯渇の確認"
      tabIndex={-1}
    >
      <SpendConfirm
        subject={pending.lever.name}
        balanceAfter={pending.risk.balanceAfter}
        returnTestId={pending.returnTestId}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </div>
  );
  return typeof document === 'undefined' ? layer : createPortal(layer, document.body);
}

export function OrgLeverList({
  levers,
  budget,
  regionTestId,
  regionLabel,
  title,
  onApply,
  leverAriaLabel,
  spendConfirmEnabled = true,
  sprintInteractionBlockedReason,
}: OrgLeverListProps) {
  const confirmGateKey = spendConfirmEnabled ? 'enabled' : 'blocked';
  const [confirmState, setConfirmState] = useState({
    gateKey: confirmGateKey,
    pending: null as PendingLeverSpend | null,
  });
  if (confirmState.gateKey !== confirmGateKey) {
    setConfirmState({ gateKey: confirmGateKey, pending: null });
  }
  const pending = confirmState.pending;
  const setPending = (value: PendingLeverSpend | null) => {
    setConfirmState({ gateKey: confirmGateKey, pending: value });
  };
  const dismissConfirm = () => {
    if (!pending) return;
    const returnTestId = pending.returnTestId;
    setPending(null);
    setTimeout(() => focusByTestId(returnTestId), 0);
  };
  const [blockedToast, setBlockedToast] = useState<string | null>(null);
  const flashBlockedToast = (message: string) => {
    setBlockedToast(message);
    window.setTimeout(() => setBlockedToast(null), 1_000);
  };

  const requestLever = (lever: LeverDef) => {
    if (sprintInteractionBlockedReason) {
      flashBlockedToast(sprintInteractionBlockedReason);
      return;
    }
    const risk = spendRiskView({ budget, cost: lever.cost });
    if (risk.blocked !== null) return;
    const returnTestId = `lever-${lever.id}`;
    if (risk.requiresConfirm) {
      if (!spendConfirmEnabled) return;
      setPending({ lever, risk, returnTestId });
      return;
    }
    setPending(null);
    onApply(lever.id);
  };

  return (
    <div className="org-levers" data-testid={regionTestId} role="region" aria-label={regionLabel}>
      <span className="org-levers-title">{title}</span>
      {pending ? (
        <OrgLeverSpendGate
          pending={pending}
          onConfirm={() => {
            const current = pending;
            setPending(null);
            onApply(current.lever.id);
          }}
          onCancel={dismissConfirm}
        />
      ) : null}
      {blockedToast ? (
        <span
          className="org-lever-gate-toast interaction-block-reason"
          data-testid="org-lever-gate-toast"
          role="status"
        >
          {blockedToast}
        </span>
      ) : null}
      {levers.map((lever) => {
        const risk = spendRiskView({ budget, cost: lever.cost });
        const leverTestId = `lever-${lever.id}`;
        const interactionGated = !!sprintInteractionBlockedReason;
        const budgetBlocked = !interactionGated && (pending !== null || risk.blocked !== null);
        return (
          <button
            type="button"
            key={lever.id}
            className={`org-lever${risk.endsRun ? ' is-spend-risk' : ''}${interactionGated ? ' is-gated' : ''}`}
            data-testid={leverTestId}
            disabled={budgetBlocked}
            aria-disabled={interactionGated ? true : undefined}
            aria-label={
              interactionGated
                ? `${leverAriaLabel?.(lever) ?? lever.name}。${sprintInteractionBlockedReason}`
                : leverAriaLabel?.(lever)
            }
            onClick={() => requestLever(lever)}
            title={interactionGated ? sprintInteractionBlockedReason : formatLeverTooltip(lever)}
          >
            <span className="org-lever-head">
              <b>{lever.name}</b>
              <span className="org-lever-cost">
                {risk.blocked === null ? `💰${lever.cost}→${risk.balanceAfter}` : `💰${lever.cost}`}
              </span>
              {risk.warningLabel ? (
                <span className="spend-risk-warning org-lever-warning">{risk.warningLabel}</span>
              ) : null}
            </span>
            <EffectTagList tags={formatLeverDefTags(lever)} testId={`lever-tags-${lever.id}`} />
            {interactionGated ? (
              <span
                className="org-lever-block-reason interaction-block-reason"
                data-testid={`org-lever-block-${lever.id}`}
              >
                {sprintInteractionBlockedReason}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 予算枯渇になる支払いの確定段階（RI-147）。
 *
 * 通常購入の1クリックとは分け、取消では支払いを実行しない。
 * 初期フォーカスは取消に置き、Escape でも同じ取消に戻す。
 */
import { useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { listFocusable, wrapTabIfNeeded } from './dialogOverlayLock';
import { focusByTestId, focusGameOverPrimaryAction } from './focusByTestId';
import { useDialogOverlayLock } from './useDialogOverlayLock';

export interface SpendConfirmProps {
  subject: string;
  balanceAfter: number;
  /** 取消後にフォーカスを戻す操作の data-testid。 */
  returnTestId: string;
  onConfirm: () => void;
  onCancel: () => void;
  /**
   * 内側 group の名前。親ダイアログが同じ名前を持つときは null にして重複を外す。
   * 省略時はショップなど、親が別の名前の確認で使う。
   */
  groupLabel?: string | null;
}

export function SpendConfirm({
  subject,
  balanceAfter,
  returnTestId,
  onConfirm,
  onCancel,
  groupLabel = '予算枯渇の確認',
}: SpendConfirmProps) {
  const cancel = () => {
    onCancel();
    // 確認ボタンのアンマウント後に、再び有効になった元の操作へ戻す。
    setTimeout(() => focusByTestId(returnTestId), 0);
  };
  const confirm = () => {
    onConfirm();
    // 起点はアンマウントされる。GAME OVER の主操作が載ってから移す。
    focusGameOverPrimaryAction();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const root = event.currentTarget;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const next = wrapTabIfNeeded(listFocusable(root), active, event.shiftKey, root);
    if (!next) return;
    event.preventDefault();
    if (next !== root) next.focus();
  };

  return (
    <div
      className="spend-confirm"
      role={groupLabel ? 'group' : undefined}
      aria-label={groupLabel ?? undefined}
      data-testid="spend-confirm"
      onKeyDown={onKeyDown}
    >
      <p className="spend-confirm-warning">予算枯渇でランが終了する</p>
      <p className="spend-confirm-detail">
        {subject}を実行すると支払後の残高は 💰{balanceAfter} です。
      </p>
      <div className="spend-confirm-actions">
        <button
          type="button"
          className="btn btn-secondary"
          data-testid="spend-confirm-cancel"
          autoFocus
          onClick={cancel}
        >
          取り消す
        </button>
        <button
          type="button"
          className="btn btn-danger"
          data-testid="spend-confirm-accept"
          onClick={confirm}
        >
          このまま実行する
        </button>
      </div>
    </div>
  );
}

/** 組織レバーとショップで、枯渇確認を背面から独立したモーダルとして開く。 */
export function SpendConfirmDialog({
  testId,
  onCancel,
  ...confirmation
}: Omit<SpendConfirmProps, 'groupLabel'> & { testId: string }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const dismiss = () => {
    onCancel();
    setTimeout(() => focusByTestId(confirmation.returnTestId), 0);
  };
  useDialogOverlayLock(dialogRef, { restoreFocus: true, onDismiss: dismiss });
  const layer = (
    <div
      ref={dialogRef}
      className="result-overlay overlay-contained spend-confirm-overlay"
      data-testid={testId}
      role="dialog"
      aria-modal="true"
      aria-label="予算枯渇の確認"
      tabIndex={-1}
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <SpendConfirm {...confirmation} onCancel={onCancel} groupLabel={null} />
    </div>
  );
  return typeof document === 'undefined' ? layer : createPortal(layer, document.body);
}

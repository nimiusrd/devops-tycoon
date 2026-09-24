/**
 * 予算枯渇になる支払いの確定段階（RI-147）。
 *
 * 通常購入の1クリックとは分け、取消では支払いを実行しない。
 * 初期フォーカスは取消に置き、Escape でも同じ取消に戻す。
 */
import type { KeyboardEvent } from 'react';

export interface SpendConfirmProps {
  subject: string;
  balanceAfter: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SpendConfirm({ subject, balanceAfter, onConfirm, onCancel }: SpendConfirmProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  };

  return (
    <div
      className="spend-confirm"
      role="group"
      aria-label="予算枯渇の確認"
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
          onClick={onCancel}
        >
          取り消す
        </button>
        <button
          type="button"
          className="btn btn-danger"
          data-testid="spend-confirm-accept"
          onClick={onConfirm}
        >
          このまま実行する
        </button>
      </div>
    </div>
  );
}

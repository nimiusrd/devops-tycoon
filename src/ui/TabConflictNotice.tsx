/**
 * 別タブが先に記録を更新したときの案内（RI-144）。
 *
 * プレイヤーは、このタブの古い変更を捨てて最新の記録を読み直すかを判断する。
 * 再試行で古い状態を書き戻さない。
 */
import { createPortal } from 'react-dom';

export interface TabConflictNoticeProps {
  onTakeOver: () => void;
}

export function TabConflictNotice({ onTakeOver }: TabConflictNoticeProps) {
  const content = (
    <>
      <span
        className="visually-hidden persistence-live"
        aria-live="polite"
        data-overlay-lock-exempt="true"
      >
        別のタブが記録を更新しました。このタブの変更は保存していません。再読込して引き継げます。
      </span>
      <div
        className="persistence-notice"
        data-testid="tab-conflict-notice"
        data-state="conflict"
        data-tone="warn"
        data-persistent="true"
        data-overlay-lock-exempt="true"
      >
        <p className="persistence-notice-headline">別のタブが記録を更新しました</p>
        <p className="persistence-notice-detail">
          このタブの変更は保存していません。進行や途中セーブを巻き戻さないよう、ここからの保存を止めています。最新の記録で操作を引き継ぐには、再読込してください。
        </p>
        <button
          type="button"
          className="btn"
          data-testid="tab-conflict-reload"
          onClick={onTakeOver}
        >
          再読込して引き継ぐ
        </button>
      </div>
    </>
  );
  if (typeof document !== 'undefined' && document.body) {
    return createPortal(content, document.body);
  }
  return content;
}

/**
 * 別タブが先に記録を更新したときの案内（RI-144）。
 *
 * プレイヤーは、このタブの古い変更を捨てて最新の記録を読み直すかを判断する。
 * 再試行で古い状態を書き戻さない。バナーは盤面の上に重ね、行を足して押し下げない。
 * 読み上げは呼び出し側の aria-live に任せ、ここでは role を付けない。
 */
import type { Ref } from 'react';

export interface TabConflictNoticeProps {
  onTakeOver: () => void;
  /** 高さを監視する。競合案内は余白にせず、盤面へ重ねる。 */
  bannerRef?: Ref<HTMLDivElement>;
  /** 未保存の途中セーブやリプレイを、再読込の前にファイルへ残す。 */
  showExport?: boolean;
  onExport?: () => void;
  /** 書き出しに失敗したとき、案内へ残す一文。 */
  exportMessage?: string | null;
}

export function TabConflictNotice({
  onTakeOver,
  bannerRef,
  showExport = false,
  onExport,
  exportMessage = null,
}: TabConflictNoticeProps) {
  return (
    <div
      ref={bannerRef}
      className="persistence-notice"
      data-testid="tab-conflict-notice"
      data-state="conflict"
      data-tone="warn"
      data-persistent="true"
      data-layout="overlay"
      data-overlay-lock-exempt="true"
    >
      <div className="persistence-notice-copy">
        <p className="persistence-notice-headline">別のタブが記録を更新しました</p>
        <p className="persistence-notice-detail">
          {showExport
            ? 'このタブの変更は保存していません。未保存のデータは破棄されます。残す場合は先に書き出してください。'
            : 'このタブの変更は保存していません。再読込で最新の記録を引き継げます。'}
        </p>
        {exportMessage ? (
          <p className="persistence-notice-detail" data-testid="tab-conflict-export-error">
            {exportMessage}
          </p>
        ) : null}
      </div>
      <div className="persistence-notice-actions">
        {showExport && onExport ? (
          <button
            type="button"
            className="btn"
            data-testid="tab-conflict-export"
            onClick={onExport}
          >
            ファイルに書き出す
          </button>
        ) : null}
        <button
          type="button"
          className="btn"
          data-testid="tab-conflict-reload"
          onClick={onTakeOver}
        >
          再読込して引き継ぐ
        </button>
      </div>
    </div>
  );
}

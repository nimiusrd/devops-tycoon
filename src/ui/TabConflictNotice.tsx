/**
 * 別タブが先に記録を更新したときの案内（RI-144）。
 *
 * プレイヤーは、このタブの古い変更を捨てて最新の記録を読み直すかを判断する。
 * 再試行で古い状態を書き戻さない。常駐バナーの高さは呼び出し側がタイトル余白へ渡す。
 */
import type { Ref } from 'react';

export interface TabConflictNoticeProps {
  onTakeOver: () => void;
  /** 常駐バナーの実高さを測る。 */
  bannerRef?: Ref<HTMLDivElement>;
  /** 未保存の途中セーブやリプレイを、再読込の前にファイルへ残す。 */
  showExport?: boolean;
  onExport?: () => void;
}

export function TabConflictNotice({
  onTakeOver,
  bannerRef,
  showExport = false,
  onExport,
}: TabConflictNoticeProps) {
  return (
    <div
      ref={bannerRef}
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
        {showExport
          ? '再読込すると、このタブに残っている未保存のデータは破棄されます。残す場合は先にファイルへ書き出してください。'
          : ''}
      </p>
      {showExport && onExport ? (
        <button type="button" className="btn" data-testid="tab-conflict-export" onClick={onExport}>
          ファイルに書き出す
        </button>
      ) : null}
      <button type="button" className="btn" data-testid="tab-conflict-reload" onClick={onTakeOver}>
        再読込して引き継ぐ
      </button>
    </div>
  );
}

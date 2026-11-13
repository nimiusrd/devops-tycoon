/**
 * 別タブが先に記録を更新したときの案内（RI-144）。
 *
 * 競合はモーダルとして扱い、自動進行を止めて背面を inert にする。
 * バナー本体だけが当たり判定を持ち、枠の外ではタップを受けない。
 * 読み上げは呼び出し側の aria-live に任せ、ここでは role を付けない。
 */
import { useLayoutEffect, useRef, type Ref } from 'react';
import { ResultOverlay } from './ResultOverlay';
import { listFocusable } from './dialogOverlayLock';
import { useDialogOverlayLock } from './useDialogOverlayLock';

/** モーダルを閉じたあとも、保存停止中であることを盤面を動かさず示す。 */
export function TabConflictAcknowledgedChip({
  onTakeOver,
  showExport = false,
  onExport,
}: {
  onTakeOver: () => void;
  showExport?: boolean;
  onExport?: () => void;
}) {
  return (
    <div
      className="persistence-notice persistence-notice-quiet tab-conflict-quiet"
      data-testid="tab-conflict-quiet"
      data-state="conflict"
      data-tone="warn"
      data-layout="overlay"
      data-overlay-lock-exempt="true"
    >
      <p className="persistence-notice-headline">別タブが先に記録を更新しました</p>
      <p className="persistence-notice-detail">このタブでは端末へ保存しません。</p>
      <div className="persistence-notice-actions">
        {showExport && onExport ? (
          <button
            type="button"
            className="btn btn-primary"
            data-testid="tab-conflict-export"
            onClick={onExport}
          >
            ファイルに書き出す
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-secondary"
          data-testid="tab-conflict-reload"
          onClick={onTakeOver}
        >
          再読込して引き継ぐ
        </button>
      </div>
    </div>
  );
}

export interface TabConflictNoticeProps {
  onAcknowledge: () => void;
  onTakeOver: () => void;
  /** 高さを監視する。競合案内は余白にせず、盤面へ重ねる。 */
  bannerRef?: Ref<HTMLDivElement>;
  /** 未保存の途中セーブやリプレイを、再読込の前にファイルへ残す。 */
  showExport?: boolean;
  onExport?: () => void;
  /** 書き出しに失敗したとき、案内へ残す一文。 */
  exportMessage?: string | null;
}

export function TabConflictNoticePanel({
  onAcknowledge,
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
    >
      <div className="persistence-notice-copy">
        <p className="persistence-notice-headline" id="tab-conflict-headline">
          別のタブが記録を更新しました
        </p>
        <p className="persistence-notice-detail">
          {showExport
            ? 'このタブの変更は保存していません。未保存のデータは破棄されます。残す場合は先に書き出してください。'
            : 'このタブの変更は保存していません。このタブで続けるか、再読込して最新の記録を引き継げます。'}
        </p>
        {exportMessage ? (
          <p className="persistence-notice-detail" data-testid="tab-conflict-export-error">
            {exportMessage}
          </p>
        ) : null}
      </div>
      <div className="persistence-notice-actions">
        {showExport && onExport ? (
          <>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="tab-conflict-export"
              onClick={onExport}
            >
              ファイルに書き出す
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              data-testid="tab-conflict-reload"
              onClick={onTakeOver}
            >
              再読込して引き継ぐ
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-secondary"
            data-testid="tab-conflict-reload"
            onClick={onTakeOver}
          >
            再読込して引き継ぐ
          </button>
        )}
        <button
          type="button"
          className="btn btn-secondary"
          data-testid="tab-conflict-continue"
          onClick={onAcknowledge}
        >
          このタブで続ける
        </button>
      </div>
    </div>
  );
}

export function TabConflictNotice(props: TabConflictNoticeProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  useDialogOverlayLock(overlayRef);

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const focusables = listFocusable(overlay);
    const next = focusables[0];
    if (next) next.focus({ preventScroll: true });
    else overlay.focus({ preventScroll: true });
  }, []);

  return (
    <ResultOverlay
      ref={overlayRef}
      className="tab-conflict-overlay"
      data-testid="tab-conflict-overlay"
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tab-conflict-headline"
    >
      <TabConflictNoticePanel {...props} />
    </ResultOverlay>
  );
}

/**
 * 別タブが先に記録を更新したときの案内（RI-144）。
 *
 * 競合はモーダルとして扱い、自動進行を止めて背面を inert にする。
 * Escape と枠外タップは「このタブで続ける」と同じく案内を閉じ、直前の操作へ戻す。
 * 閉じたあとの常駐チップはボタン以外のタップを受けない。
 * 他のオーバーレイが開いている間は、チップを背面にして inert にする。
 * 読み上げは呼び出し側の aria-live に任せ、ここでは role を付けない。
 */
import { useLayoutEffect, useRef, useState, type MouseEvent, type Ref } from 'react';
import { ResultOverlay } from './ResultOverlay';
import { listFocusable } from './dialogOverlayLock';
import { useDialogOverlayLock } from './useDialogOverlayLock';

/** 編成・全社・結果など、常駐チップより前面にすべきオーバーレイ。 */
const FRONT_OVERLAY_SELECTOR = '.zoom-overlay, .result-overlay:not(.tab-conflict-overlay)';

/** 他オーバーレイが DOM にある間、常駐チップを操作不能にする。 */
function useInertBehindFrontOverlay(): boolean {
  const [inert, setInert] = useState(false);

  useLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    const sync = () => {
      setInert(document.querySelector(FRONT_OVERLAY_SELECTOR) !== null);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return inert;
}

export interface TabConflictAcknowledgedChipProps {
  onTakeOver: () => void;
  showExport?: boolean;
  onExport?: () => void;
  /** 編成や全社などの前面オーバーレイ中は true。 */
  inert?: boolean;
}

/** モーダルを閉じたあとも、保存停止中であることを盤面を動かさず示す。 */
export function TabConflictAcknowledgedChipView({
  onTakeOver,
  showExport = false,
  onExport,
  inert = false,
}: TabConflictAcknowledgedChipProps) {
  return (
    <div
      className="persistence-notice persistence-notice-quiet tab-conflict-quiet"
      data-testid="tab-conflict-quiet"
      data-state="conflict"
      data-tone="warn"
      data-layout="overlay"
      inert={inert ? true : undefined}
    >
      <p className="persistence-notice-headline">別タブが先に記録を更新しました</p>
      <p className="persistence-notice-detail">保存停止中。このタブでは端末へ保存しません。</p>
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

export function TabConflictAcknowledgedChip(props: TabConflictAcknowledgedChipProps) {
  const inert = useInertBehindFrontOverlay();
  return <TabConflictAcknowledgedChipView {...props} inert={inert} />;
}

/** バナー本体以外（スクリム）のタップだけ案内を閉じる。 */
function acknowledgeTabConflictFromScrim(
  event: { target: EventTarget | null; currentTarget: EventTarget | null },
  acknowledge: () => void,
): void {
  if (event.target !== event.currentTarget) return;
  acknowledge();
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
  useDialogOverlayLock(overlayRef, {
    restoreFocus: true,
    onDismiss: props.onAcknowledge,
  });

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const focusables = listFocusable(overlay);
    const next = focusables[0];
    if (next) next.focus({ preventScroll: true });
    else overlay.focus({ preventScroll: true });
  }, []);

  const onScrimClick = (event: MouseEvent<HTMLDivElement>) => {
    acknowledgeTabConflictFromScrim(event, props.onAcknowledge);
  };

  return (
    <ResultOverlay
      ref={overlayRef}
      className="tab-conflict-overlay"
      data-testid="tab-conflict-overlay"
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tab-conflict-headline"
      onClick={onScrimClick}
    >
      <TabConflictNoticePanel {...props} />
    </ResultOverlay>
  );
}

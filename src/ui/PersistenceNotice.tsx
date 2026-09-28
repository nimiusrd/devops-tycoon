/**
 * 自動保存の状態（RI-145）。
 *
 * 保存失敗とセッション限りは常駐する。保存中・保存済みは盤面を押し下げない。
 * 読み上げは liveMessage を基本にし、書き出し失敗の一文だけ足す。連続した保存成功では文を変えない。
 * ライブリージョンはバナーの出し入れで作り直さない。先に空で置き、文言の変化だけを読み上げる。
 */
import { createPortal } from 'react-dom';
import type { PersistenceNotice as PersistenceNoticeModel } from '../state/persistenceStatus';
import { observePersistenceBannerHeight } from './persistenceBannerInset';

export interface PersistenceNoticeProps {
  notice: PersistenceNoticeModel;
  onRetry: () => void;
  onExport: () => void;
  /** ファイル書き出しに失敗したとき、バナーへ出す一文。 */
  exportMessage?: string | null;
}

let releaseBannerInset: (() => void) | undefined;

/** 常駐バナーの実高さをタイトルの上余白へ渡す。復旧チップやアンマウントでは余白を外す。 */
function bindPersistentBanner(node: HTMLDivElement | null): void {
  releaseBannerInset?.();
  releaseBannerInset = undefined;
  if (!node) return;
  releaseBannerInset = observePersistenceBannerHeight(node);
}

export function PersistenceNotice({
  notice,
  onRetry,
  onExport,
  exportMessage = null,
}: PersistenceNoticeProps) {
  // 平常時の保存済みは出さない。時刻入りの常駐チップは盤面を覆い、視覚回帰も毎分崩れる。
  const liveText = exportMessage
    ? `${notice.liveMessage} ${exportMessage}`.trim()
    : notice.liveMessage;
  const showBanner =
    notice.state !== 'idle' && !(notice.state === 'saved' && notice.liveMessage === '');
  const content = (
    <>
      <span
        className="visually-hidden persistence-live"
        aria-live="polite"
        data-testid="persistence-live"
        data-overlay-lock-exempt="true"
      >
        {liveText}
      </span>
      {showBanner ? (
        <div
          ref={bindPersistentBanner}
          className={`persistence-notice${notice.persistent ? '' : ' persistence-notice-quiet'}`}
          data-testid="persistence-notice"
          data-state={notice.state}
          data-tone={notice.tone}
          data-persistent={notice.persistent ? 'true' : 'false'}
          data-overlay-lock-exempt="true"
        >
          <p className="persistence-notice-headline" data-testid="persistence-notice-headline">
            {notice.headline}
          </p>
          {notice.detail ? <p className="persistence-notice-detail">{notice.detail}</p> : null}
          {notice.showRetry ? (
            <button type="button" className="btn" data-testid="persistence-retry" onClick={onRetry}>
              再試行
            </button>
          ) : null}
          {notice.showExport ? (
            <button
              type="button"
              className="btn"
              data-testid="persistence-export"
              onClick={onExport}
            >
              ファイルに書き出す
            </button>
          ) : null}
          {exportMessage ? (
            <p className="persistence-notice-detail" data-testid="persistence-export-error">
              {exportMessage}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
  // 失敗も復旧文も body へ出し、モーダルが #root を inert にしても読めるようにする。
  if (typeof document !== 'undefined' && document.body) {
    return createPortal(content, document.body);
  }
  return content;
}

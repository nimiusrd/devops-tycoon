/**
 * 自動保存の状態（RI-145）。
 *
 * 保存失敗とセッション限りは常駐する。保存中・保存済みは盤面を押し下げない。
 * 読み上げは liveMessage だけにし、連続した保存成功では文を変えない。
 */
import { createPortal } from 'react-dom';
import type { PersistenceNotice as PersistenceNoticeModel } from '../state/persistenceStatus';

export interface PersistenceNoticeProps {
  notice: PersistenceNoticeModel;
  onRetry: () => void;
  onExport: () => void;
}

export function PersistenceNotice({ notice, onRetry, onExport }: PersistenceNoticeProps) {
  // 平常時の保存済みは出さない。時刻入りの常駐チップは盤面を覆い、視覚回帰も毎分崩れる。
  // ライブリージョンは先に空で置き、文言の変化だけを読み上げる。
  const live = (
    <span
      className="visually-hidden"
      aria-live="polite"
      data-testid="persistence-live"
      data-overlay-lock-exempt="true"
    >
      {notice.liveMessage}
    </span>
  );
  const showBanner =
    notice.state !== 'idle' && !(notice.state === 'saved' && notice.liveMessage === '');
  const banner = showBanner ? (
    <div
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
      {live}
      {notice.showRetry ? (
        <button type="button" className="btn" data-testid="persistence-retry" onClick={onRetry}>
          再試行
        </button>
      ) : null}
      {notice.showExport ? (
        <button type="button" className="btn" data-testid="persistence-export" onClick={onExport}>
          ファイルに書き出す
        </button>
      ) : null}
    </div>
  ) : (
    live
  );
  // 失敗も復旧文も body へ出し、モーダルが #root を inert にしても読めるようにする。
  if (typeof document !== 'undefined' && document.body) {
    return createPortal(banner, document.body);
  }
  return banner;
}

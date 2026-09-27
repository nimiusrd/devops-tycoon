/**
 * 自動保存の状態（RI-145）。
 *
 * 保存失敗とセッション限りは常駐する。保存中・保存済みは盤面を押し下げない。
 * 読み上げは liveMessage だけにし、連続した保存成功では文を変えない。
 */
import type { PersistenceNotice as PersistenceNoticeModel } from '../state/persistenceStatus';

export interface PersistenceNoticeProps {
  notice: PersistenceNoticeModel;
  onRetry: () => void;
  onExport: () => void;
}

export function PersistenceNotice({ notice, onRetry, onExport }: PersistenceNoticeProps) {
  // 平常時の保存済みは出さない。時刻入りの常駐チップは盤面を覆い、視覚回帰も毎分崩れる。
  // 失敗・セッション限り・復旧後の読み上げがあるときだけ見せる。
  if (notice.state === 'idle') return null;
  if (notice.state === 'saved' && notice.liveMessage === '') return null;

  return (
    <div
      className={`persistence-notice${notice.persistent ? '' : ' persistence-notice-quiet'}`}
      data-testid="persistence-notice"
      data-state={notice.state}
      data-tone={notice.tone}
      data-persistent={notice.persistent ? 'true' : 'false'}
    >
      <p className="persistence-notice-headline" data-testid="persistence-notice-headline">
        {notice.headline}
      </p>
      {notice.detail ? <p className="persistence-notice-detail">{notice.detail}</p> : null}
      <span className="visually-hidden" aria-live="polite" data-testid="persistence-live">
        {notice.liveMessage}
      </span>
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
  );
}

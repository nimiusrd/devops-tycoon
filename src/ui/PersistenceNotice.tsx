/**
 * 自動保存の状態（RI-145）。
 *
 * 保存失敗とセッション限りは常駐する。保存中・保存済みは盤面全体を押し下げない。
 * 復旧チップは右上に固定せず、HUD の直下に置く。KPI詳細や要約チップを隠さない（#546）。
 * 読み上げは liveMessage を基本にし、書き出し失敗の一文だけ足す。連続した保存成功では文を変えない。
 * ライブリージョンはバナーの出し入れで作り直さない。先に空で置き、文言の変化だけを読み上げる。
 */
import { createPortal } from 'react-dom';
import type { PersistenceNotice as PersistenceNoticeModel } from '../state/persistenceStatus';
import { observePersistenceBannerHeight } from './persistenceBannerInset';
import { TabConflictNotice } from './TabConflictNotice';

export interface PersistenceNoticeProps {
  notice: PersistenceNoticeModel;
  onRetry: () => void;
  onExport: () => void;
  /** ファイル書き出しに失敗したとき、バナーへ出す一文。 */
  exportMessage?: string | null;
  /**
   * HUD がある画面では復旧チップをヘッダー内へ出す。
   * ここでは読み上げと常駐バナーだけを残す。
   */
  quietPlacement?: 'inline' | 'overlay';
  /** 別タブが記録を更新した。再試行バナーの代わりに再読込案内を出す。 */
  tabConflict?: boolean;
  onTakeOver?: () => void;
}

/** 平常時の保存済みは出さない。時刻の常時表示は盤面を覆い、視覚回帰も崩れる。 */
function showsPersistenceBanner(notice: PersistenceNoticeModel): boolean {
  return notice.state !== 'idle' && !(notice.state === 'saved' && notice.liveMessage === '');
}

/**
 * HUD の次の行へ置くのは、復旧直後の保存済みだけ。
 * 保存中は固定配置のままにし、書き込みのたびに盤面の高さを変えない。
 */
function showsInlineRecoveryChip(notice: PersistenceNoticeModel): boolean {
  return !notice.persistent && notice.state === 'saved' && showsPersistenceBanner(notice);
}

let releaseBannerInset: (() => void) | undefined;

/** 常駐バナーの実高さをタイトルの上余白へ渡す。復旧チップやアンマウントでは余白を外す。 */
function bindPersistentBanner(node: HTMLDivElement | null): void {
  releaseBannerInset?.();
  releaseBannerInset = undefined;
  if (!node) return;
  releaseBannerInset = observePersistenceBannerHeight(node);
}

export function PersistenceQuietChip({
  notice,
  active,
}: {
  notice: PersistenceNoticeModel;
  active: boolean;
}) {
  if (!active || !showsInlineRecoveryChip(notice)) return null;
  return (
    <div className="persistence-quiet-slot" data-testid="persistence-quiet-slot">
      <div
        className="persistence-notice persistence-notice-quiet"
        data-testid="persistence-notice"
        data-state={notice.state}
        data-tone={notice.tone}
        data-persistent="false"
        data-overlay-lock-exempt="true"
        data-quiet-placement="inline"
      >
        <p className="persistence-notice-headline" data-testid="persistence-notice-headline">
          {notice.headline}
        </p>
        {notice.detail ? (
          <p className="persistence-notice-detail" data-testid="persistence-notice-detail">
            {notice.detail}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function PersistenceNotice({
  notice,
  onRetry,
  onExport,
  exportMessage = null,
  quietPlacement = 'overlay',
  tabConflict = false,
  onTakeOver,
}: PersistenceNoticeProps) {
  const conflictText =
    '別のタブが記録を更新しました。このタブの変更は保存していません。再読込して引き継げます。';
  const liveText = tabConflict
    ? conflictText
    : exportMessage
      ? `${notice.liveMessage} ${exportMessage}`.trim()
      : notice.liveMessage;
  const showBanner =
    !tabConflict &&
    showsPersistenceBanner(notice) &&
    !(quietPlacement === 'inline' && showsInlineRecoveryChip(notice));
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
      {tabConflict && onTakeOver ? (
        <TabConflictNotice
          onTakeOver={onTakeOver}
          bannerRef={bindPersistentBanner}
          showExport={notice.showExport}
          onExport={onExport}
        />
      ) : null}
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
          {notice.detail ? (
            <p className="persistence-notice-detail" data-testid="persistence-notice-detail">
              {notice.detail}
            </p>
          ) : null}
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
  // 失敗と読み上げは body へ出し、モーダルが #root を inert にしても読めるようにする。
  // HUD がある画面の復旧チップはヘッダー内（quietPlacement=inline）。
  if (typeof document !== 'undefined' && document.body) {
    return createPortal(content, document.body);
  }
  return content;
}

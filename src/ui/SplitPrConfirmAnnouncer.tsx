import {
  formatSplitPrConfirmAnnouncement,
  splitPrConfirmAnnouncementKey,
  type SplitPrConfirmCue,
} from '../render/splitPrConfirmView';

/** 常設のライブ領域に、最新の分割結果を1回だけ追加する（#1020）。 */
export function SplitPrConfirmAnnouncer({ cue }: { cue: SplitPrConfirmCue | null }) {
  return (
    <div
      className="visually-hidden"
      data-testid="split-pr-confirm-live"
      data-empty={cue ? undefined : 'true'}
    >
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="split-pr-confirm-announce"
      >
        {cue && (
          <span key={splitPrConfirmAnnouncementKey(cue)}>
            {formatSplitPrConfirmAnnouncement(cue.taskId)}
          </span>
        )}
      </div>
    </div>
  );
}

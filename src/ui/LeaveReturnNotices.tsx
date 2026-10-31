import { Fragment } from 'react';
import { leaveReturnNoticePhrases } from '../render/leaveReturnNoticeView';
import { planLeaveReturnNotices } from '../sim/member';
import type { LeaveReturnNotice } from '../sim/member/types';

/**
 * 復帰したスプリントの編成画面に、名前ごとの一文を一度ずつ出す。
 * ヒント枠へ重ねるので、出ても開始ボタンの位置は変わらない。
 * role=status の polite だけを使い、role=alert との二重読み上げはしない。
 * 領域自体は空のときも残し、文が乗った更新を 1 回だけ読み上げる。
 */
export function LeaveReturnNotices({ notices }: { notices: readonly LeaveReturnNotice[] }) {
  const unique = planLeaveReturnNotices(notices, []);
  return (
    <div
      className="leave-return-slot"
      data-testid="leave-return-slot"
      data-empty={unique.length === 0 ? 'true' : undefined}
    >
      <div role="status" aria-live="polite" aria-atomic="true">
        {unique.length > 0 && (
          <ul className="leave-return-notices" data-testid="leave-return-notices">
            {unique.map((notice) => (
              <li key={notice.id} data-testid={`leave-return-${notice.id}`}>
                {leaveReturnNoticePhrases(notice.name).map((phrase, index) => (
                  <Fragment key={`${notice.id}-${index}`}>
                    {index > 0 && <wbr />}
                    <span className="setup-text-phrase">{phrase}</span>
                  </Fragment>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * 休職復帰の文言（#937）。
 *
 * プレイヤーは、戻った人がベンチにいると知り、開始前に配置を決める。
 * 見た目はヒント枠の1行に収め、枠の高さは変えない。入りきらないときは
 * ボスや高負荷の警告を優先し、復帰は読み上げだけにする。
 */
import type { LeaveReturnNotice } from '../sim/member/types';

/** 名前と「ベンチにいる」を、句の途中で改行しない単位に分ける。 */
export function leaveReturnNoticePhrases(name: string): readonly [string, string, string] {
  return [name, 'が復帰しました', '（ベンチ）'];
}

/** 1人のときの一文。例: アオイが復帰しました（ベンチ）。 */
export function leaveReturnNoticeText(name: string): string {
  return leaveReturnNoticePhrases(name).join('');
}

/** 見た目用。省略してよいのは名前だけで、文は「ベンチに復帰しました」で終わる。 */
export function leaveReturnSummaryParts(
  notices: readonly LeaveReturnNotice[],
): { name: string; tail: string } | null {
  const first = notices[0];
  if (!first) return null;
  if (notices.length === 1) return { name: first.name, tail: 'がベンチに復帰しました' };
  return { name: first.name, tail: `ほか${notices.length - 1}人がベンチに復帰しました` };
}

/** 見た目用の1行。複数人は先頭の名前と人数だけにする。 */
export function leaveReturnSummary(notices: readonly LeaveReturnNotice[]): string {
  const parts = leaveReturnSummaryParts(notices);
  return parts ? `${parts.name}${parts.tail}` : '';
}

/** 読み上げ用。戻った人すべての名前を一度ずつ含める。 */
export function leaveReturnSpeech(notices: readonly LeaveReturnNotice[]): string {
  return notices.map((notice) => leaveReturnNoticeText(notice.name)).join('');
}

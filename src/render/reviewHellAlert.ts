/**
 * スプリント状態枠の Review Hell 読み上げ（#975）。
 *
 * 表示の出し入れは盤面を押さない。読み上げは入ったときと出たときに 1 回ずつで、
 * 同じ状態の再描画では文言を変えない。
 */

export const REVIEW_HELL_ENTERED_MESSAGE = 'Review Hell に入った';
export const REVIEW_HELL_EXITED_MESSAGE = 'Review Hell を出た';

/**
 * 直前の状態から、今回読み上げる文言を返す。変化がなければ null。
 * 初期表示で既に入っているときは入った旨を 1 回だけ返す。
 */
export function reviewHellLiveMessage(previous: boolean | null, active: boolean): string | null {
  if (previous === active) return null;
  if (previous === null && !active) return null;
  return active ? REVIEW_HELL_ENTERED_MESSAGE : REVIEW_HELL_EXITED_MESSAGE;
}

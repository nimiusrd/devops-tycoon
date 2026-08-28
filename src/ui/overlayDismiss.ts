/**
 * 閉じ可能な result-overlay の操作契約（Escape / 背景クリック）。
 *
 * ネイティブ `<dialog>` ではなく既存の `role="dialog"` overlay を使う。
 * Escape の window リスナーは各 Screen に置かず、タイトルでは App が
 * 最前面判定つきで処理する（同時マウント時に背後まで閉じない）。
 */

/** overlay を閉じるキーか（一般的な dialog の Escape 契約）。 */
export function isOverlayDismissKey(key: string): boolean {
  return key === 'Escape';
}

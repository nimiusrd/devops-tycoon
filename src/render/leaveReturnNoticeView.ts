/**
 * 休職復帰の文言（#937）。
 *
 * プレイヤーは、戻った人がベンチにいると知り、開始前に配置を決める。
 * 通知は編成ヒントの枠へ重ね、行を足して開始ボタンを押さない（#928 / #931）。
 */

/** 名前と「ベンチにいる」を、句の途中で改行しない単位に分ける。 */
export function leaveReturnNoticePhrases(name: string): readonly [string, string, string] {
  return [name, 'が復帰しました', '（ベンチ）'];
}

/** スクリーンリーダーと見た目で同じ一文。例: アオイが復帰しました（ベンチ）。 */
export function leaveReturnNoticeText(name: string): string {
  return leaveReturnNoticePhrases(name).join('');
}

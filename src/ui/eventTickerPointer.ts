/**
 * イベントティッカーのポインター判定（DS-01 / DS-06 / DS-08）。
 *
 * 盤面ドラッグを奪わず、ホイール・タッチ・キーボードで一覧へ到達するための純関数。
 */

export function pointInRect(
  x: number,
  y: number,
  rect: { left: number; right: number; top: number; bottom: number },
): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/** Ctrl+wheel / ピンチズーム（Chrome は ctrlKey）はブラウザへ渡す。 */
export function shouldCaptureTickerWheel(event: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return !event.ctrlKey && !event.metaKey;
}

export function applyTickerListScroll(
  list: { scrollTop: number; scrollHeight: number; clientHeight: number },
  deltaY: number,
): boolean {
  if (list.scrollHeight <= list.clientHeight + 1) return false;
  const max = list.scrollHeight - list.clientHeight;
  const next = Math.min(max, Math.max(0, list.scrollTop + deltaY));
  if (next === list.scrollTop) return false;
  list.scrollTop = next;
  return true;
}

/** ティッカー下のタスク粒なら盤面ドラッグを優先する。 */
export function hitBlocksTickerTouchScroll(target: EventTarget | null): boolean {
  if (!target || !('closest' in target)) return false;
  const closest = (target as { closest?: (selector: string) => unknown }).closest;
  return typeof closest === 'function' && closest('[data-task-id]') != null;
}

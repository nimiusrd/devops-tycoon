/**
 * イベントティッカーのポインター判定（DS-01 / DS-06 / DS-08）。
 *
 * 盤面ドラッグを奪わず、ホイール・タッチ・キーボードで一覧へ到達するための純関数。
 */

export const WHEEL_DELTA_PIXEL = 0;
export const WHEEL_DELTA_LINE = 1;
export const WHEEL_DELTA_PAGE = 2;

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

/** WheelEvent.deltaY を CSS ピクセルへ換算する。 */
export function wheelDeltaYInCssPixels(
  event: { deltaY: number; deltaMode: number },
  lineHeightPx: number,
  pageHeightPx: number,
): number {
  if (event.deltaMode === WHEEL_DELTA_LINE) return event.deltaY * lineHeightPx;
  if (event.deltaMode === WHEEL_DELTA_PAGE) return event.deltaY * pageHeightPx;
  return event.deltaY;
}

export function readLineHeightPx(lineHeight: string, fallbackPx = 24): number {
  const parsed = Number.parseFloat(lineHeight);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackPx;
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

/** result オーバーレイ等で背面化したティッカーは window リスナーを動かさない。 */
export function isTickerPointerSuppressed(
  list: { closest: (selector: string) => unknown },
  hit: EventTarget | null,
): boolean {
  if (list.closest('[inert]') != null) return true;
  if (list.closest('[aria-hidden="true"]') != null) return true;
  if (!hit || !('closest' in hit)) return false;
  const closest = (hit as { closest?: (selector: string) => unknown }).closest;
  if (typeof closest !== 'function') return false;
  return closest('.result-overlay, [role="dialog"]') != null;
}

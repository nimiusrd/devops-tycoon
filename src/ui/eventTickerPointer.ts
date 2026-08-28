/**
 * イベントティッカーのポインター判定（DS-01 / DS-06 / DS-08）。
 *
 * 盤面ドラッグを奪わず、ホイール・タッチ・キーボードで一覧へ到達するための純関数。
 */
import { FRONT_OVERLAY_SELECTOR } from './viewportScroll';

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
  const previous = list.scrollTop;
  const max = list.scrollHeight - list.clientHeight;
  const next = Math.min(max, Math.max(0, previous + deltaY));
  if (next === previous) return false;
  list.scrollTop = next;
  return list.scrollTop !== previous;
}

export interface TickerTouchHitOptions {
  clientX: number;
  clientY: number;
  /** Pixi canvas 上の粒。DOM の `[data-task-id]` が無いときの Board 座標ヒット。 */
  hitsBoardDot?: (clientX: number, clientY: number) => boolean;
}

function closestMatches(target: EventTarget | null, selector: string): boolean {
  if (!target || !('closest' in target)) return false;
  const el = target as { closest?: (selector: string) => unknown };
  return typeof el.closest === 'function' && el.closest(selector) != null;
}

/** ネイティブ Element.closest はメソッドのまま呼ぶ（切り離すと Illegal invocation）。 */
export function hitBlocksTickerTouchScroll(
  target: EventTarget | null,
  options?: TickerTouchHitOptions,
): boolean {
  if (closestMatches(target, '[data-task-id]')) return true;
  return options?.hitsBoardDot?.(options.clientX, options.clientY) === true;
}

/**
 * 背面化したティッカーは window の capture リスナーを動かさない。
 * `inert` は結果オーバーレイの兄弟ロック。最前面が `.result-overlay` /
 * `.zoom-overlay` なら透過ヒットではなくオーバーレイ操作。
 * `.sprint-layout` はティッカー自身のホストなので見ない。
 * `[role="dialog"]` は初回ガイド等にも付くので見ない。
 */
export function isTickerPointerSuppressed(
  list: { closest: (selector: string) => unknown },
  hit: EventTarget | null,
): boolean {
  if (list.closest('[inert]') != null) return true;
  return closestMatches(hit, FRONT_OVERLAY_SELECTOR);
}

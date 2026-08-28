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

/** リスト本体か親が縦に溢れているか。 */
export function tickerHasOverflow(list: {
  scrollHeight: number;
  clientHeight: number;
  parentElement: { scrollHeight: number; clientHeight: number } | null;
}): boolean {
  if (list.scrollHeight > list.clientHeight + 1) return true;
  const parent = list.parentElement;
  return parent != null && parent.scrollHeight > parent.clientHeight + 1;
}

export const TICKER_LIST_ARROW_DELTA_PX = 24;

const TICKER_LIST_SCROLL_KEYS = new Set([
  'ArrowDown',
  'ArrowUp',
  'PageDown',
  'PageUp',
  'Home',
  'End',
]);

/** フォーカス中リストのスクロールキーに対応する delta。未知キーは null。 */
export function tickerListKeyDelta(
  key: string,
  pageSize: number,
  scrollTop: number,
  scrollHeight: number,
): number | null {
  switch (key) {
    case 'ArrowDown':
      return TICKER_LIST_ARROW_DELTA_PX;
    case 'ArrowUp':
      return -TICKER_LIST_ARROW_DELTA_PX;
    case 'PageDown':
      return pageSize;
    case 'PageUp':
      return -pageSize;
    case 'End':
      return scrollHeight;
    case 'Home':
      return -scrollTop;
    default:
      return null;
  }
}

/** 溢れているリストでは、境界でも認識キーの既定スクロールを抑止する。 */
export function shouldPreventTickerListKey(key: string, overflow: boolean): boolean {
  return overflow && TICKER_LIST_SCROLL_KEYS.has(key);
}

/**
 * タッチ開始時点でティッカーのパンを確保する。
 * 粒ヒット時は盤面ドラッグを優先し、mouse は従来どおり通す。
 */
export function shouldClaimTickerTouchPan(input: {
  pointerType: string;
  defaultPrevented: boolean;
  overflow: boolean;
  hitsBoardDot: boolean;
}): boolean {
  if (input.defaultPrevented) return false;
  if (input.pointerType !== 'touch' && input.pointerType !== 'pen') return false;
  return input.overflow && !input.hitsBoardDot;
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

/**
 * R&D 盤面 A/B のクエリ解決（本番バランス・AI は触らない）。
 *
 * `?rd=iso|lane` で盤面レイアウトだけ差し替える。未指定・未知値は現行の iso。
 * `?rdScene=stress` で炎上・渋滞・延焼が同時にある固定場面を載せる。
 * `?rdMeasure=1` は H2 測定用。盤面を覆うティッカーと A/B ピッカーだけを隠す。
 */

export type RdBoardLayout = 'iso' | 'lane';
export type RdBoardScene = 'live' | 'stress';

export const RD_BOARD_PROTOTYPE_SEED = 'rd-board-ab-stress';

/** クエリ文字列から盤面レイアウトを解決する。純関数。 */
export function resolveRdLayout(search: string): RdBoardLayout {
  const value = new URLSearchParams(search).get('rd');
  return value === 'lane' ? 'lane' : 'iso';
}

function locationSearch(): string | null {
  if (typeof window === 'undefined' || !window.location) return null;
  return window.location.search ?? '';
}

/** ブラウザ URL から盤面レイアウトを解決する。 */
export function resolveRdLayoutFromLocation(): RdBoardLayout {
  const search = locationSearch();
  return search === null ? 'iso' : resolveRdLayout(search);
}

/** クエリ文字列から R&D 固定場面を解決する。純関数。 */
export function resolveRdScene(search: string): RdBoardScene {
  const value = new URLSearchParams(search).get('rdScene');
  return value === 'stress' ? 'stress' : 'live';
}

/** ブラウザ URL から R&D 固定場面を解決する。 */
export function resolveRdSceneFromLocation(): RdBoardScene {
  const search = locationSearch();
  return search === null ? 'live' : resolveRdScene(search);
}

/** R&D ピッカーや固定場面が有効か。 */
export function isRdBoardPrototypeActive(search: string): boolean {
  const params = new URLSearchParams(search);
  return (
    params.get('rd') === 'lane' || params.get('rd') === 'iso' || params.get('rdScene') === 'stress'
  );
}

export function isRdBoardPrototypeActiveFromLocation(): boolean {
  const search = locationSearch();
  return search !== null && isRdBoardPrototypeActive(search);
}

/** H2 測定モード。`rdMeasure=1` のときだけ盤面オーバーレイを隠す。 */
export function resolveRdMeasure(search: string): boolean {
  return new URLSearchParams(search).get('rdMeasure') === '1';
}

export function isRdMeasureFromLocation(): boolean {
  const search = locationSearch();
  return search !== null && resolveRdMeasure(search);
}

/** `rd` だけを差し替えた search を返す（他パラメータは維持）。 */
export function replaceRdLayoutInSearch(search: string, layout: RdBoardLayout): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  params.set('rd', layout);
  const serialized = params.toString();
  return serialized.length > 0 ? `?${serialized}` : '';
}

/** 現在の URL の `rd` を履歴を汚さず差し替える。 */
export function writeRdLayoutToLocation(layout: RdBoardLayout): void {
  if (typeof window === 'undefined' || !window.location) return;
  const next = replaceRdLayoutInSearch(window.location.search ?? '', layout);
  const url = `${window.location.pathname}${next}${window.location.hash}`;
  window.history.replaceState(null, '', url);
}

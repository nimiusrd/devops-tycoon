/**
 * タイトル上に重ねるモーダルの前後関係（DOM 順 = 前面）。
 *
 * App の title フェーズ Suspense 内のマウント順と一致させる。
 * 遊び方の Escape は、最前面が help のときだけ閉じる。
 */
export const TITLE_MODAL_IDS = [
  'help',
  'metaShop',
  'deckPolicy',
  'cardCollection',
  'achievements',
  'replayList',
] as const;

export type TitleModalId = (typeof TITLE_MODAL_IDS)[number];

export type TitleModalOpenState = Readonly<Record<TitleModalId, boolean>>;

export function frontmostTitleModal(open: TitleModalOpenState): TitleModalId | null {
  for (let i = TITLE_MODAL_IDS.length - 1; i >= 0; i--) {
    const id = TITLE_MODAL_IDS[i];
    if (id && open[id]) return id;
  }
  return null;
}

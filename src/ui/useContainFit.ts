import { useLayoutEffect } from 'react';

/**
 * 親スロットに収まる最大幅へ要素を合わせる（アスペクト比を保つ contain フィット）。
 *
 * 盤面系のビュー（スプリント / 部門 / 全社 / 業界）で同じ実装が重複していたため集約した。
 * 各ビューで基準の縦横比が違うので、比率は呼び出し側から渡す。
 *
 * @param ref フィットさせる要素。親要素（スロット）のサイズを基準にする。
 * @param ratio 保ちたい縦横比（幅 / 高さ）。
 */
export function useContainFit(ref: React.RefObject<HTMLDivElement | null>, ratio: number): void {
  useLayoutEffect(() => {
    const el = ref.current;
    const slot = el?.parentElement;
    if (!el || !slot) return;
    const apply = () => {
      const w = slot.clientWidth;
      const h = slot.clientHeight;
      if (w === 0 || h === 0) return;
      el.style.width = `${Math.min(w, h * ratio)}px`;
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(slot);
    return () => ro.disconnect();
  }, [ref, ratio]);
}

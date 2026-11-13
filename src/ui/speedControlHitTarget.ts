import { VISUAL_TOKENS } from '../render/visualTokens';

export interface CssRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

type LayoutBox = Pick<DOMRectReadOnly, 'width' | 'height'> &
  ({ left: number; top: number } | { x: number; y: number });

/** 速度ボタンのレイアウト箱を、CSS `::before` と同じ 44px 最小ヒット領域へ拡げた矩形。 */
export function speedControlButtonHitRect(layout: LayoutBox): CssRect {
  const touch = VISUAL_TOKENS.dimensions.interaction.minTouchTargetCss;
  const width = Math.max(layout.width, touch);
  const height = Math.max(layout.height, touch);
  const originX = 'left' in layout ? layout.left : layout.x;
  const originY = 'top' in layout ? layout.top : layout.y;
  return {
    x: originX + layout.width / 2 - width / 2,
    y: originY + layout.height / 2 - height / 2,
    width,
    height,
  };
}

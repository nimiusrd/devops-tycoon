/**
 * スプリント盤面のクライアント座標。
 * Pixi の contain-fit とヒット判定が共有する、枠線の内側のキャンバス寸法。
 */
import type { Page } from '@playwright/test';
import { BOARD_VIEW } from '../../src/render/boardScene';
import { designToHostTransform, type DesignToHostTransform } from '../../src/render/visualTokens';

export interface BoardCanvasFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  fit: DesignToHostTransform;
}

/** 盤面の内側。`boardCanvasHostRect` とヒット判定が同じ原点・寸法を使う。 */
export async function readBoardCanvasFrame(page: Page): Promise<BoardCanvasFrame> {
  const frame = await page.getByTestId('board').evaluate((board) => {
    const border = board.getBoundingClientRect();
    const { clientLeft, clientTop, clientWidth, clientHeight } = board;
    return {
      x: border.left + clientLeft,
      y: border.top + clientTop,
      width: clientWidth,
      height: clientHeight,
    };
  });
  if (!Number.isFinite(frame.width) || frame.width <= 0) {
    throw new Error('盤面キャンバスの位置を取得できない');
  }
  return {
    ...frame,
    fit: designToHostTransform(frame.width, frame.height, BOARD_VIEW),
  };
}

/** 設計座標（拡大後の粒中心を含む）を、描画と同じクライアント座標へ写す。 */
export function designToClient(
  frame: BoardCanvasFrame,
  point: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: frame.x + frame.fit.x + point.x * frame.fit.scale,
    y: frame.y + frame.fit.y + point.y * frame.fit.scale,
  };
}

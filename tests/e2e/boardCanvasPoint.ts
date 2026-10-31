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

/** Pixi mount の枠。盤面要素の border box ではなく、描画と同じ内側を返す。 */
export async function readBoardCanvasFrame(page: Page): Promise<BoardCanvasFrame> {
  const mount = page.getByTestId('board-pixi-mount');
  const box = await mount.boundingBox();
  if (!box) throw new Error('盤面キャンバスの位置を取得できない');
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    fit: designToHostTransform(box.width, box.height, BOARD_VIEW),
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

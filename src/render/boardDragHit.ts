/**
 * 盤面ドラッグのクライアント座標ヒット（DOM 粒と Pixi canvas の共通判定）。
 *
 * Pixi 既定レンダラでは粒が canvas 内にあり `[data-task-id]` が DOM に無い。
 * Board が同じ `hitTestBoardDot` を登録し、ティッカーのタッチスクロールが
 * 武装中の粒ドラッグと同時に始まらないようにする。
 */
import { clientToBoardPoint, type BoardClientRect } from './boardDragPlan';
import { hitTestBoardDot } from './boardPixiView';
import type { BoardDotPlan } from './boardScene';

export type BoardDragHitTest = (clientX: number, clientY: number) => boolean;

let registeredBoardDragHitTest: BoardDragHitTest | null = null;

export function registerBoardDragHitTest(next: BoardDragHitTest | null): void {
  registeredBoardDragHitTest = next;
}

export function clientPointHitsRegisteredBoardDrag(clientX: number, clientY: number): boolean {
  return registeredBoardDragHitTest?.(clientX, clientY) === true;
}

export function clientPointHitsDraggableBoardDot(
  clientX: number,
  clientY: number,
  boardRect: BoardClientRect | null | undefined,
  dots: readonly BoardDotPlan[],
  draggableIds: ReadonlySet<number>,
): boolean {
  if (!boardRect || draggableIds.size === 0) return false;
  const pt = clientToBoardPoint(clientX, clientY, boardRect);
  return hitTestBoardDot(pt, dots, draggableIds) !== null;
}

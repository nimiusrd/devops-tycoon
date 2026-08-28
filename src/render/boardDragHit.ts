/**
 * 盤面ドラッグのクライアント座標ヒット（Pixi canvas 専用）。
 *
 * Pixi 既定レンダラでは粒が canvas 内にあり `[data-task-id]` が DOM に無い。
 * Board は Pixi 盤面ルートが座標ドラッグを受けるときだけ `hitTestBoardDot`
 * （DOT_HIT_MARGIN）を登録し、ティッカーのタッチスクロールが武装中の粒ドラッグ
 * と同時に始まらないようにする。DOM 粒は span 上でしかドラッグが始まらない。
 */
import { clientToBoardPoint, type BoardClientRect } from './boardDragPlan';
import { hitTestBoardDot } from './boardPixiView';
import type { BoardDotPlan } from './boardScene';

export type BoardDragHitTest = (clientX: number, clientY: number) => boolean;

let registeredBoardDragHitTest: BoardDragHitTest | null = null;

export function registerBoardDragHitTest(next: BoardDragHitTest | null): void {
  registeredBoardDragHitTest = next;
}

/**
 * Pixi 盤面が座標ドラッグを受けるときだけ拡張ヒットを登録する。
 * DOM レンダラでは常に解除し、粒外側の DOT_HIT_MARGIN でパンを塞がない。
 */
export function registerPixiBoardDragHitTest(
  usePixi: boolean,
  next: BoardDragHitTest | null,
): void {
  registerBoardDragHitTest(usePixi ? next : null);
}

export function clientPointHitsRegisteredBoardDrag(clientX: number, clientY: number): boolean {
  return registeredBoardDragHitTest?.(clientX, clientY) === true;
}

/** Pixi 盤面が座標ヒットを登録しているときだけ true。DOM では呼ばない。 */
export function hasRegisteredBoardDragHitTest(): boolean {
  return registeredBoardDragHitTest != null;
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

/**
 * 盤面ドラッグのクライアント座標ヒット（Pixi canvas 専用）。
 *
 * Board のドラッグ開始と、ティッカーのタッチスクロール抑止で同じ判定を使う。
 * 盤面の縮尺を渡し、CSS px の最小操作領域を両方の経路へ反映する。
 */
import { clientToBoardPoint, type BoardClientRect } from './boardDragPlan';
import { hitTestBoardDot } from './boardPixiView';
import { BOARD_VIEW, type BoardDotPlan } from './boardScene';
import { designToHostTransform } from './visualTokens';

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
  return hitTestClientBoardDot(clientX, clientY, boardRect, dots, draggableIds) !== null;
}

/** 枠線の内側にあるキャンバス（Pixi mount と同じ padding edge）。 */
export interface BoardCanvasElement {
  getBoundingClientRect(): BoardClientRect;
  clientLeft: number;
  clientTop: number;
  clientWidth: number;
  clientHeight: number;
}

/**
 * 描画キャンバスのクライアント矩形。
 * border box は 2px の枠を含むため、contain-fit の倍率と原点がキャンバスとずれる。
 */
export function boardCanvasHostRect(board: BoardCanvasElement): BoardClientRect | null {
  const border = board.getBoundingClientRect();
  const { clientLeft, clientTop, clientWidth, clientHeight } = board;
  if (
    ![
      border.left,
      border.top,
      border.width,
      border.height,
      clientLeft,
      clientTop,
      clientWidth,
      clientHeight,
    ].every(Number.isFinite) ||
    clientWidth <= 0 ||
    clientHeight <= 0
  ) {
    return null;
  }
  return {
    left: border.left + clientLeft,
    top: border.top + clientTop,
    width: clientWidth,
    height: clientHeight,
  };
}

/** Board とティッカーが共有する、画面上のタスク粒判定。 */
export function hitTestClientBoardDot(
  clientX: number,
  clientY: number,
  boardRect: BoardClientRect | null | undefined,
  dots: readonly BoardDotPlan[],
  draggableIds: ReadonlySet<number>,
): number | null {
  if (
    !boardRect ||
    draggableIds.size === 0 ||
    ![clientX, clientY, boardRect.left, boardRect.top, boardRect.width, boardRect.height].every(
      Number.isFinite,
    ) ||
    boardRect.width <= 0 ||
    boardRect.height <= 0 ||
    clientX < boardRect.left ||
    clientY < boardRect.top ||
    clientX > boardRect.left + boardRect.width ||
    clientY > boardRect.top + boardRect.height
  ) {
    return null;
  }
  const fit = designToHostTransform(boardRect.width, boardRect.height, BOARD_VIEW);
  const pt = clientToBoardPoint(clientX, clientY, boardRect);
  return hitTestBoardDot(pt, dots, draggableIds, { x: fit.scale, y: fit.scale });
}

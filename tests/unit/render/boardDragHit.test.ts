import { afterEach, describe, expect, it } from 'vitest';
import {
  clientPointHitsDraggableBoardDot,
  clientPointHitsRegisteredBoardDrag,
  registerBoardDragHitTest,
} from '../../../src/render/boardDragHit';
import { BOARD_VIEW } from '../../../src/render/boardScene';
import type { BoardDotPlan } from '../../../src/render/boardScene';

function dot(overrides: Partial<BoardDotPlan> & { id: number }): BoardDotPlan {
  return {
    lane: 'review',
    x: 700,
    y: 300,
    variant: 'normal',
    size: 'medium',
    fire: false,
    ...overrides,
  };
}

const identityRect = {
  left: 0,
  top: 0,
  width: BOARD_VIEW.w,
  height: BOARD_VIEW.h,
};

describe('clientPointHitsDraggableBoardDot', () => {
  const draggable = new Set([1]);

  it('設計座標へ写したクライアント点が粒上なら true', () => {
    const dots = [dot({ id: 1 })];
    expect(clientPointHitsDraggableBoardDot(700, 300, identityRect, dots, draggable)).toBe(true);
    expect(clientPointHitsDraggableBoardDot(720, 300, identityRect, dots, draggable)).toBe(false);
    expect(clientPointHitsDraggableBoardDot(700, 300, identityRect, dots, new Set())).toBe(false);
    expect(clientPointHitsDraggableBoardDot(700, 300, null, dots, draggable)).toBe(false);
  });
});

describe('registerBoardDragHitTest', () => {
  afterEach(() => {
    registerBoardDragHitTest(null);
  });

  it('Board が登録した座標ヒットをティッカーから参照できる', () => {
    expect(clientPointHitsRegisteredBoardDrag(1, 2)).toBe(false);
    registerBoardDragHitTest((x, y) => x === 10 && y === 20);
    expect(clientPointHitsRegisteredBoardDrag(10, 20)).toBe(true);
    expect(clientPointHitsRegisteredBoardDrag(0, 0)).toBe(false);
  });
});

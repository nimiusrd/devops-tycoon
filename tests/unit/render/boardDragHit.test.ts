import { afterEach, describe, expect, it } from 'vitest';
import {
  clientPointHitsDraggableBoardDot,
  clientPointHitsRegisteredBoardDrag,
  hasRegisteredBoardDragHitTest,
  hitTestClientBoardDot,
  registerBoardDragHitTest,
  registerPixiBoardDragHitTest,
} from '../../../src/render/boardDragHit';
import { BOARD_VIEW } from '../../../src/render/boardScene';
import type { BoardDotPlan } from '../../../src/render/boardScene';
import { presentBoardDot } from '../../../src/render/boardPixiView';

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

  it.each(['small', 'medium', 'large'] as const)(
    '320幅の盤面でも%s粒の判定を画面上の直径24pxまで広げる',
    (size) => {
      const rect = { left: 14, top: 200, width: 292, height: 119.2 };
      const dots = [dot({ id: 1, size, x: BOARD_VIEW.w / 2, y: BOARD_VIEW.h / 2 })];
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      for (const [dx, dy] of [
        [-11.9, 0],
        [11.9, 0],
        [0, -11.9],
        [0, 11.9],
        [8, 8],
      ]) {
        expect(clientPointHitsDraggableBoardDot(x + dx, y + dy, rect, dots, draggable)).toBe(true);
      }
      expect(clientPointHitsDraggableBoardDot(x + 12.1, y, rect, dots, draggable)).toBe(false);
      expect(clientPointHitsDraggableBoardDot(x + 9, y + 9, rect, dots, draggable)).toBe(false);
    },
  );

  it('非等比の盤面では両軸の最小判定を保ち、拡大された粒の領域も縮めない', () => {
    const rect = { left: 10, top: 20, width: BOARD_VIEW.w * 2, height: BOARD_VIEW.h / 5 };
    const dots = [dot({ id: 1, size: 'large', x: BOARD_VIEW.w / 2, y: BOARD_VIEW.h / 2 })];
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    expect(hitTestClientBoardDot(x + 45, y, rect, dots, draggable)).toBe(1);
    expect(hitTestClientBoardDot(x + 47, y, rect, dots, draggable)).toBeNull();
    expect(hitTestClientBoardDot(x, y + 11.9, rect, dots, draggable)).toBe(1);
    expect(hitTestClientBoardDot(x, y + 12.1, rect, dots, draggable)).toBeNull();
  });

  it('近接粒は最も近い対象を選び、対象外の粒は選ばない', () => {
    const rect = { left: 14, top: 200, width: 292, height: 119.2 };
    const cssScale = Math.min(rect.width / BOARD_VIEW.w, rect.height / BOARD_VIEW.h);
    const dots = [
      dot({ id: 1, clusterX: 700, clusterY: 300 }),
      dot({ id: 2, x: 730, clusterX: 700, clusterY: 300 }),
      dot({ id: 9 }),
    ];
    const presented = dots.map((entry) => presentBoardDot(entry, cssScale));
    const client = (designX: number, designY: number) => ({
      x: rect.left + (designX / BOARD_VIEW.w) * rect.width,
      y: rect.top + (designY / BOARD_VIEW.h) * rect.height,
    });
    const first = client(presented[0].x, presented[0].y);
    const second = client(presented[1].x, presented[1].y);
    const nearerSecond = client(
      presented[0].x + (presented[1].x - presented[0].x) * 0.62,
      presented[0].y,
    );
    expect(hitTestClientBoardDot(first.x, first.y, rect, dots, new Set([1, 2]))).toBe(1);
    expect(hitTestClientBoardDot(nearerSecond.x, nearerSecond.y, rect, dots, new Set([1, 2]))).toBe(
      2,
    );
    expect(hitTestClientBoardDot(second.x, second.y, rect, dots, new Set([1, 2]))).toBe(2);
    expect(clientPointHitsDraggableBoardDot(first.x, first.y, rect, dots, new Set([1, 2]))).toBe(
      true,
    );
    expect(clientPointHitsDraggableBoardDot(second.x, second.y, rect, dots, new Set([9]))).toBe(
      false,
    );
  });

  it.each([{ width: 0 }, { height: 0 }, { width: -1 }, { height: Infinity }, { left: NaN }])(
    '無効な盤面寸法・位置なら原点の粒にもヒットしない: %j',
    (invalid) => {
      expect(
        hitTestClientBoardDot(
          0,
          0,
          { ...identityRect, ...invalid },
          [dot({ id: 1, x: 0, y: 0 })],
          draggable,
        ),
      ).toBeNull();
    },
  );

  it('盤面外の点と不正なポインター座標ではヒットしない', () => {
    const dots = [dot({ id: 1, x: 0, y: 0 })];
    expect(hitTestClientBoardDot(-1, 0, identityRect, dots, draggable)).toBeNull();
    expect(hitTestClientBoardDot(0, NaN, identityRect, dots, draggable)).toBeNull();
    expect(hitTestClientBoardDot(0, 0, identityRect, dots, new Set())).toBeNull();
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

  it('DOM レンダラでは Pixi 用の拡張ヒットを登録しない', () => {
    registerPixiBoardDragHitTest(false, () => true);
    expect(clientPointHitsRegisteredBoardDrag(10, 20)).toBe(false);
    registerPixiBoardDragHitTest(true, (x, y) => x === 10 && y === 20);
    expect(hasRegisteredBoardDragHitTest()).toBe(true);
    expect(clientPointHitsRegisteredBoardDrag(10, 20)).toBe(true);
    registerPixiBoardDragHitTest(true, null);
    expect(hasRegisteredBoardDragHitTest()).toBe(false);
    expect(clientPointHitsRegisteredBoardDrag(10, 20)).toBe(false);
  });
});

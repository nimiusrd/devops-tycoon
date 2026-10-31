import { afterEach, describe, expect, it } from 'vitest';
import {
  boardCanvasHostRect,
  clientPointHitsDraggableBoardDot,
  clientPointHitsRegisteredBoardDrag,
  hasRegisteredBoardDragHitTest,
  hitTestClientBoardDot,
  registerBoardDragHitTest,
  registerPixiBoardDragHitTest,
} from '../../../src/render/boardDragHit';
import { clientToBoardPoint } from '../../../src/render/boardDragPlan';
import { BOARD_VIEW, planBoardScene } from '../../../src/render/boardScene';
import type { BoardDotPlan } from '../../../src/render/boardScene';
import { presentBoardDots } from '../../../src/render/boardPixiView';
import { designToHostTransform } from '../../../src/render/visualTokens';
import { makeTask } from '../helpers/sprintFixtures';

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

  it('縦横が合わない盤面は描画と同じ contain-fit で判定し、両軸の最小領域を保つ', () => {
    const rect = { left: 10, top: 20, width: BOARD_VIEW.w * 2, height: BOARD_VIEW.h / 5 };
    const fit = designToHostTransform(rect.width, rect.height, BOARD_VIEW);
    const dots = [dot({ id: 1, size: 'large', x: BOARD_VIEW.w / 2, y: BOARD_VIEW.h / 2 })];
    const x = rect.left + fit.x + (BOARD_VIEW.w / 2) * fit.scale;
    const y = rect.top + fit.y + (BOARD_VIEW.h / 2) * fit.scale;
    expect(fit.scale).toBeCloseTo(0.2);
    expect(hitTestClientBoardDot(x + 11.9, y, rect, dots, draggable)).toBe(1);
    expect(hitTestClientBoardDot(x + 12.1, y, rect, dots, draggable)).toBeNull();
    expect(hitTestClientBoardDot(x, y + 11.9, rect, dots, draggable)).toBe(1);
    expect(hitTestClientBoardDot(x, y + 12.1, rect, dots, draggable)).toBeNull();
  });

  it('近接粒は最も近い対象を選び、対象外の粒は選ばない', () => {
    const rect = { left: 14, top: 200, width: 292, height: 119.2 };
    const fit = designToHostTransform(rect.width, rect.height, BOARD_VIEW);
    const dots = [
      dot({ id: 1, clusterX: 700, clusterY: 300 }),
      dot({ id: 2, x: 730, clusterX: 700, clusterY: 300 }),
      dot({ id: 9 }),
    ];
    const presented = presentBoardDots(dots, fit.scale);
    const client = (designX: number, designY: number) => ({
      x: rect.left + fit.x + designX * fit.scale,
      y: rect.top + fit.y + designY * fit.scale,
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

describe('Review の山と枠線の内側', () => {
  // #978 の実測。390 幅の枠線込み 362×147.73 に対し、描画は内側 358×143.73。
  const phoneHost = { left: 16, top: 220, width: 358, height: 143.73 };
  // 320 幅の盤面（枠線込み 292×119.2）から 2px 枠を除いた内側。
  const phoneSeHost = { left: 14, top: 180, width: 288, height: 115.2 };

  function piledTasks() {
    const review = Array.from({ length: 15 }, (_, index) =>
      makeTask(index + 1, {
        lane: 'review',
        kind: index % 5 === 0 ? 'complex' : index % 3 === 0 ? 'routine' : 'normal',
      }),
    );
    return [...review, makeTask(29, { lane: 'coding', kind: 'normal' })];
  }

  it.each([
    ['390×844', phoneHost],
    ['320×568', phoneSeHost],
  ] as const)(
    '%s では山の粒も下になった Coding も、描いた中心から 1px 以内でその粒が選ばれる',
    (_label, host) => {
      const scene = planBoardScene(piledTasks());
      const fit = designToHostTransform(host.width, host.height, BOARD_VIEW);
      const borderScale = Math.min(
        (host.width + 4) / BOARD_VIEW.w,
        (host.height + 4) / BOARD_VIEW.h,
      );
      expect(fit.scale).not.toBeCloseTo(borderScale, 4);
      const presented = presentBoardDots(scene.dots, fit.scale);
      const review = presented.filter((entry) => entry.lane === 'review' && !entry.motion);
      const coding = presented.find((entry) => entry.id === 29);
      expect(review.length).toBeGreaterThanOrEqual(10);
      expect(coding).toBeDefined();
      const ids = new Set(presented.map((entry) => entry.id));
      for (const entry of [...review, coding!]) {
        const clientX = host.left + fit.x + entry.x * fit.scale;
        const clientY = host.top + fit.y + entry.y * fit.scale;
        const recovered = clientToBoardPoint(clientX, clientY, host);
        const offset = Math.hypot(
          (recovered.x - entry.x) * fit.scale,
          (recovered.y - entry.y) * fit.scale,
        );
        expect(offset, `粒 ${entry.id}`).toBeLessThanOrEqual(1);
        expect(
          hitTestClientBoardDot(clientX, clientY, host, scene.dots, ids),
          `粒 ${entry.id}`,
        ).toBe(entry.id);
      }
    },
  );

  it('枠線を含む矩形へ戻すと、端の粒の中心が描画から 1px を超えてずれる', () => {
    const border = {
      left: phoneHost.left - 2,
      top: phoneHost.top - 2,
      width: phoneHost.width + 4,
      height: phoneHost.height + 4,
    };
    const fit = designToHostTransform(phoneHost.width, phoneHost.height, BOARD_VIEW);
    const design = { x: 1006, y: 330 };
    const drawnX = phoneHost.left + fit.x + design.x * fit.scale;
    const drawnY = phoneHost.top + fit.y + design.y * fit.scale;
    const linearX = border.left + (design.x / BOARD_VIEW.w) * border.width;
    const linearY = border.top + (design.y / BOARD_VIEW.h) * border.height;
    expect(Math.hypot(linearX - drawnX, linearY - drawnY)).toBeGreaterThan(1);
    const recovered = clientToBoardPoint(drawnX, drawnY, phoneHost);
    expect(
      Math.hypot((recovered.x - design.x) * fit.scale, (recovered.y - design.y) * fit.scale),
    ).toBeLessThanOrEqual(1);
  });

  it('枠線の内側をキャンバス寸法にする', () => {
    const element = {
      getBoundingClientRect: () => ({
        left: phoneHost.left - 2,
        top: phoneHost.top - 2,
        width: phoneHost.width + 4,
        height: phoneHost.height + 4,
      }),
      clientLeft: 2,
      clientTop: 2,
      clientWidth: phoneHost.width,
      clientHeight: phoneHost.height,
    };
    expect(boardCanvasHostRect(element)).toEqual(phoneHost);
    expect(
      boardCanvasHostRect({ ...element, clientWidth: 0, clientHeight: phoneHost.height }),
    ).toBeNull();
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

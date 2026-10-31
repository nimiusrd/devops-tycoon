/**
 * スプリント盤面 Pixi レンダラ純ヘルパの検証（RI-11 / RI-07）。
 *
 * GPU を使わない数値関数のみを対象にする（実 WebGL は CI で回さない方針。
 * architecture §4.2）。実描画の見え方は @pixi の視覚回帰（Playwright）に分離する。
 */
import { describe, expect, it } from 'vitest';
import {
  actorTextureKey,
  boardAnimationElapsedMs,
  boardDotLayer,
  boardDotCssDiameter,
  boardDotPreviewRing,
  boardDotReadabilityMagnification,
  bobOffsetY,
  dotTextureKey,
  fireShakeOffset,
  fireShakePeriodMs,
  flowDriftOffset,
  flowDriftPeriodMs,
  hitTestBoardDot,
  lineDashSegments,
  planBoardDotsForRender,
  presentBoardDot,
  presentBoardDots,
  presentBoardEffectPoint,
  presentBoardReviewTrail,
  presentedDotHitsOtherStation,
  presentedDotLeavesBoard,
  presentedDotRadius,
} from '../../../src/render/boardPixiView';
import {
  BOARD_STATION_CENTERS,
  planBoardScene,
  type BoardDotPlan,
} from '../../../src/render/boardScene';
import type { Lane, Task } from '../../../src/sim/types';
import { VISUAL_TOKENS } from '../../../src/render/visualTokens';

const STATIONS = (Object.keys(BOARD_STATION_CENTERS) as Lane[]).map((lane) => ({
  lane,
  x: BOARD_STATION_CENTERS[lane].x,
  y: BOARD_STATION_CENTERS[lane].y,
}));

const FLOW = {
  kind: 'flow' as const,
  from: 'coding' as const,
  to: 'review' as const,
  t: 0.4,
  angleDeg: 28,
  aiAssisted: false,
  speedMul: 1,
};

function dot(overrides: Partial<BoardDotPlan> & { id: number }): BoardDotPlan {
  return {
    lane: 'review',
    x: 700,
    y: 300,
    variant: 'normal',
    size: 'medium', // 直径 26 → 半径 13
    fire: false,
    ...overrides,
  };
}

describe('boardAnimationElapsedMs', () => {
  it('通常時は経過時間を保ち、reduced motion は位相0へ固定する', () => {
    expect(boardAnimationElapsedMs(840, false)).toBe(840);
    expect(boardAnimationElapsedMs(840, true)).toBe(0);
  });
});

describe('planBoardDotsForRender', () => {
  it('上限超過でもドラッグ中・炎上・候補・流動中を優先し、最後に描画順へ戻す', () => {
    const dots = [
      dot({ id: 1 }),
      dot({ id: 2 }),
      dot({
        id: 3,
        motion: {
          kind: 'flow',
          from: 'coding',
          to: 'review',
          t: 0.4,
          angleDeg: 0,
          speedMul: 1,
          aiAssisted: false,
        },
      }),
      dot({ id: 4 }),
      dot({ id: 5, fire: true, variant: 'incident' }),
      dot({ id: 6 }),
    ];
    const plan = planBoardDotsForRender(dots, new Set([4]), 6, 4);

    expect(plan.requested).toBe(6);
    expect(plan.dropped).toBe(2);
    expect(plan.dots.map((entry) => entry.id)).toEqual([3, 5, 4, 6]);
    expect(plan.dots.map((entry) => boardDotLayer(entry, entry.id === 4, entry.id === 6))).toEqual([
      8, 8, 9, 12,
    ]);
  });

  it('同じ入力は同じ選択順になり、0予算では全件を切り捨てる', () => {
    const dots = Array.from({ length: 8 }, (_, index) => dot({ id: index + 1 }));
    expect(planBoardDotsForRender(dots, new Set(), null, 3)).toEqual(
      planBoardDotsForRender(dots, new Set(), null, 3),
    );
    expect(planBoardDotsForRender(dots, new Set(), null, 0)).toEqual({
      dots: [],
      requested: 8,
      dropped: 8,
    });
  });

  it('確定前の対象は予算で保持して候補より手前に描き、元のヒット順を変えない', () => {
    const dots = [dot({ id: 1 }), dot({ id: 2 }), dot({ id: 3, fire: true }), dot({ id: 4 })];
    const original = [...dots];
    const plan = planBoardDotsForRender(dots, new Set([1, 2]), 4, 3, 1);

    expect(plan.dots.map((entry) => entry.id)).toEqual([3, 1, 4]);
    expect(dots).toEqual(original);
    expect(hitTestBoardDot({ x: 700, y: 300 }, dots, new Set([1, 2]))).toBe(2);
    expect(boardDotLayer(dots[0], true, false, true)).toBeGreaterThan(
      boardDotLayer(dots[1], true, false),
    );
    expect(boardDotLayer(dots[0], true, false, true)).toBeLessThan(
      boardDotLayer(dots[3], false, true),
    );
    expect(planBoardDotsForRender(dots, new Set(), null, 1, 1).dots).toEqual([dots[0]]);
  });
});

describe('boardDotPreviewRing', () => {
  it.each([1, 0.675, 0.208])('縮尺 %s でも対象の輪郭幅と径を CSS px で確保する', (scale) => {
    for (const size of ['small', 'medium', 'large'] as const) {
      const ring = boardDotPreviewRing(size, scale);
      const tokens = VISUAL_TOKENS.dimensions.sprint.dotPreview;
      // 縮尺の往復計算による浮動小数点誤差だけを許容する。
      expect(ring.radius * 2 * scale + 1e-9).toBeGreaterThanOrEqual(tokens.minCssDiameter);
      expect(ring.strokeWidth * scale).toBeCloseTo(tokens.strokeCssWidth);
      expect(((ring.outlineWidth - ring.strokeWidth) * scale) / 2).toBeCloseTo(
        tokens.outlineCssWidth,
      );
    }
  });
});

describe('boardDotReadability', () => {
  const pile = { clusterX: 840, clusterY: 315 };

  it('広い盤面では倍率 1 で位置を変えず、狭い盤面では最小直径と 3px の隙間を確保する', () => {
    const dots = [
      dot({ id: 1, size: 'small', x: 840, y: 315, ...pile }),
      dot({ id: 2, size: 'small', x: 862, y: 315, ...pile }),
      dot({ id: 3, size: 'medium', x: 884, y: 315, ...pile }),
    ];
    expect(boardDotReadabilityMagnification(0.68)).toBe(1);
    expect(boardDotReadabilityMagnification(0.5)).toBe(1);
    expect(dots.map((entry) => presentBoardDot(entry, 0.68))).toEqual(dots);

    const narrowScale = 0.208;
    const magnification = boardDotReadabilityMagnification(narrowScale);
    expect(magnification).toBeGreaterThan(1);
    expect(boardDotCssDiameter('small', narrowScale)).toBeCloseTo(
      VISUAL_TOKENS.dimensions.sprint.taskDotMinCssDiameter,
    );
    expect(boardDotCssDiameter('medium', narrowScale)).toBeGreaterThan(
      boardDotCssDiameter('small', narrowScale),
    );
    const presented = dots.map((entry) => presentBoardDot(entry, narrowScale));
    const spacing = (presented[1].x - presented[0].x) * narrowScale;
    const smallGap = spacing - boardDotCssDiameter('small', narrowScale);
    expect(smallGap).toBeCloseTo(3);
    expect(presented[0].x).toBe(840);
    expect(presented[1].x).toBeGreaterThan(862);
  });

  it('基準点がない粒は拡大しても中心を動かさない', () => {
    const entry = dot({ id: 1, size: 'small', x: 100, y: 80 });
    expect(presentBoardDot(entry, 0.208)).toMatchObject({ x: 100, y: 80 });
  });

  it('山の中心でも隣の工程に入る大きい粒は、自分の工程の中心へ寄せる', () => {
    const scale = 0.2006980802792321;
    const entry = dot({
      id: 0,
      lane: 'done',
      size: 'large',
      x: 973,
      y: 330,
      clusterX: 1006,
      clusterY: 330,
    });
    const presented = presentBoardDot(entry, scale);
    expect(presented.x).toBeGreaterThan(1006);
    expect(presented.y).toBeGreaterThan(330);
    expect(presentedDotHitsOtherStation(entry, scale, STATIONS)).toBe(false);
    expect(presentedDotLeavesBoard(entry, scale)).toBe(false);
    expect(boardDotCssDiameter('large', scale)).toBeGreaterThan(
      VISUAL_TOKENS.dimensions.sprint.taskDotMinCssDiameter,
    );
  });

  it('別工程に入る静止粒は基準点へ戻し、見た目の直径は保つ', () => {
    const scale = 0.208;
    const anchor = { x: 840, y: 315 };
    const entry = dot({
      id: 9,
      size: 'small',
      lane: 'review',
      x: anchor.x + 44,
      y: anchor.y - 16,
      clusterX: anchor.x,
      clusterY: anchor.y,
    });
    const magnification = boardDotReadabilityMagnification(scale);
    const full = {
      x: anchor.x + 44 * magnification,
      y: anchor.y - 16 * magnification,
    };
    const presented = presentBoardDot(entry, scale);
    expect(Math.hypot(presented.x - anchor.x, presented.y - anchor.y)).toBeLessThan(
      Math.hypot(full.x - anchor.x, full.y - anchor.y),
    );
    expect(presentedDotHitsOtherStation(entry, scale, STATIONS)).toBe(false);
    expect(presentedDotLeavesBoard(entry, scale)).toBe(false);
    expect(boardDotCssDiameter('small', scale)).toBeCloseTo(
      VISUAL_TOKENS.dimensions.sprint.taskDotMinCssDiameter,
    );
  });

  it('同じ段の右端が別工程に当たっても、粒は別の中心に残る', () => {
    const scale = 0.208;
    const pile = { clusterX: 840, clusterY: 315 };
    const dots = [-44, -22, 0, 22, 44].map((dx, index) =>
      dot({
        id: index + 1,
        size: 'medium',
        lane: 'review',
        x: 840 + dx,
        y: 315,
        ...pile,
      }),
    );
    const presented = presentBoardDots(dots, scale);
    for (let i = 0; i < dots.length; i += 1) {
      const placed = {
        ...dots[i],
        x: presented[i].x,
        y: presented[i].y,
        clusterX: undefined,
        clusterY: undefined,
      };
      expect(presentedDotHitsOtherStation(placed, scale, STATIONS)).toBe(false);
      expect(presentedDotLeavesBoard(placed, scale)).toBe(false);
    }
    const right = presented.slice(-2);
    const gap = Math.hypot(right[0].x - right[1].x, right[0].y - right[1].y);
    // 独立に境界へ寄せると中心差は 0.001 CSS px 未満になり、奥の粒を選べない。
    expect(gap * scale).toBeGreaterThan(1);
    const ids = new Set(dots.map((entry) => entry.id));
    for (let i = 0; i < dots.length; i += 1) {
      expect(hitTestBoardDot(presented[i], dots, ids, { x: scale, y: scale })).toBe(dots[i].id);
    }
  });

  it('複数段の Review 山でも、各中心を押すとその粒が選ばれる', () => {
    const scale = 0.208;
    const perRow = 5;
    const count = 11;
    const dots = Array.from({ length: count }, (_, index) => {
      const row = Math.floor(index / perRow);
      const col = index % perRow;
      const rows = Math.ceil(count / perRow);
      const inRow = row === rows - 1 ? count - row * perRow : perRow;
      const ox = (col - (inRow - 1) / 2) * 22;
      const oy = -row * 16;
      return dot({
        id: index + 1,
        size: 'medium',
        lane: 'review',
        x: 840 + ox,
        y: 315 + oy,
        clusterX: 840,
        clusterY: 315,
      });
    });
    const presented = presentBoardDots(dots, scale);
    const ids = new Set(dots.map((entry) => entry.id));
    for (let i = 0; i < dots.length; i += 1) {
      const placed = {
        ...dots[i],
        x: presented[i].x,
        y: presented[i].y,
        clusterX: undefined,
        clusterY: undefined,
      };
      expect(presentedDotHitsOtherStation(placed, scale, STATIONS), `粒 ${dots[i].id}`).toBe(false);
      expect(presentedDotLeavesBoard(placed, scale), `粒 ${dots[i].id}`).toBe(false);
      expect(hitTestBoardDot(presented[i], dots, ids, { x: scale, y: scale })).toBe(dots[i].id);
    }
  });

  it('緊急対応の開始位置は、拡大後の粒の中心へ移る', () => {
    const scale = 0.208;
    const tasks: Task[] = Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      kind: 'normal',
      highValue: false,
      aiAssisted: false,
      lane: 'rework',
      progress: 0,
      reworkAttempts: 0,
      wasReworked: false,
      incident: true,
      debt: false,
      burnTicksLeft: 3,
    }));
    const planned = planBoardScene(tasks).dots;
    const raw = planned.find((entry) => Math.hypot(entry.x - 1006, entry.y - 142) < 0.5);
    expect(raw, 'Rework 最上段の中央').toBeDefined();
    const presented = presentBoardDots(planned, scale);
    const shown = presented[planned.indexOf(raw!)];
    const anchor = { x: raw!.x, y: raw!.y };
    expect(presentBoardEffectPoint(anchor, planned, presented, scale)).toEqual({
      x: shown.x,
      y: shown.y,
    });
    expect(Math.hypot(shown.x - anchor.x, shown.y - anchor.y) * scale).toBeGreaterThan(10);
    expect(presentBoardEffectPoint(anchor, planned, presented, 1)).toEqual(anchor);
    expect(presentBoardEffectPoint({ x: 10, y: 20 }, planned, presented, scale)).toEqual({
      x: 10,
      y: 20,
    });
  });

  it('盤面の外へ出るフロー粒は端の内側へ戻し、別工程の上は通す', () => {
    const scale = 0.208;
    const magnification = boardDotReadabilityMagnification(scale);
    const off = dot({
      id: 3,
      lane: 'coding',
      size: 'small',
      x: 0,
      y: 0,
      clusterX: 30,
      clusterY: 30,
      motion: FLOW,
    });
    const fullX = 30 + (0 - 30) * magnification;
    expect(fullX).toBeLessThan(0);
    const presented = presentBoardDot(off, scale);
    const radius = presentedDotRadius('small', scale);
    expect(presented.x - radius).toBeGreaterThanOrEqual(-0.5);
    expect(presented.y - radius).toBeGreaterThanOrEqual(-0.5);
    expect(presented.x).toBeGreaterThan(fullX);
    expect(presentedDotLeavesBoard(off, scale)).toBe(false);

    const crossing = dot({
      id: 4,
      lane: 'coding',
      size: 'small',
      x: 900,
      y: 280,
      clusterX: 860,
      clusterY: 280,
      motion: FLOW,
    });
    expect(presentBoardDot(crossing, scale).x).toBeCloseTo(860 + 40 * magnification);
    expect(presentedDotHitsOtherStation(crossing, scale, STATIONS)).toBe(false);
  });

  it('軌跡の根元を拡大後の粒の中心へ移す', () => {
    const dotOnFlow = dot({
      id: 4,
      lane: 'coding',
      size: 'small',
      x: 900,
      y: 280,
      clusterX: 860,
      clusterY: 280,
      motion: FLOW,
    });
    const trail = {
      taskId: 4,
      x: 900,
      y: 280,
      angleDeg: 28,
      progress: 0.4,
      speedMul: 1,
      length: 18,
      width: 3,
      tone: 'normal' as const,
    };
    const presented = presentBoardDot(dotOnFlow, 0.208);
    expect(presentBoardReviewTrail(trail, dotOnFlow, 0.208)).toMatchObject({
      x: presented.x,
      y: presented.y,
      angleDeg: 28,
      tone: 'normal',
    });
    expect(presented.x).not.toBe(trail.x);
    expect(presentBoardReviewTrail(trail, undefined, 0.208)).toBe(trail);
    expect(presentBoardReviewTrail({ ...trail, taskId: 99 }, dotOnFlow, 0.208).taskId).toBe(99);

    const still = dot({ id: 1, size: 'small', x: 100, y: 80 });
    const stillTrail = { ...trail, taskId: 1, x: 100, y: 80 };
    expect(presentBoardReviewTrail(stillTrail, still, 0.208)).toBe(stillTrail);
  });
});

describe('hitTestBoardDot', () => {
  const draggable = new Set([1, 2]);

  it('半径＋マージン内の draggable 粒を返す', () => {
    const dots = [dot({ id: 1, x: 700, y: 300 })];
    // 半径 13 + マージン 6 = 19px 以内。
    expect(hitTestBoardDot({ x: 700, y: 300 }, dots, draggable)).toBe(1);
    expect(hitTestBoardDot({ x: 718, y: 300 }, dots, draggable)).toBe(1);
    expect(hitTestBoardDot({ x: 720, y: 300 }, dots, draggable)).toBeNull();
  });

  it('実際の円が重なる場所では中心距離によらず手前の粒を優先する', () => {
    const dots = [dot({ id: 1, x: 700, y: 300 }), dot({ id: 2, x: 706, y: 300 })];
    expect(hitTestBoardDot({ x: 702, y: 300 }, dots, draggable)).toBe(2);
    expect(hitTestBoardDot({ x: 703, y: 300 }, dots, draggable)).toBe(2);
    expect(hitTestBoardDot({ x: 705, y: 300 }, dots, draggable)).toBe(2);
    // 手前の円外にある拡張領域は、奥の実際の円へのクリックを奪わない。
    expect(hitTestBoardDot({ x: 690, y: 300 }, dots, draggable)).toBe(1);
  });

  it.each([
    { scale: 0.675, size: 'medium', separation: 15, offset: 7.6 },
    { scale: 0.208, size: 'large', separation: 17.3, offset: 8.7 },
  ] as const)(
    '縮尺 $scale でも近い小粒が手前の $size 粒の実体を奪わない',
    ({ scale, size, separation, offset }) => {
      const dots = [
        dot({ id: 1, size: 'small', x: 700 + separation }),
        dot({ id: 2, size, x: 700 }),
      ];
      expect(
        hitTestBoardDot({ x: 700 + offset, y: 300 }, dots, draggable, { x: scale, y: scale }),
      ).toBe(2);
    },
  );

  it('円外の拡張領域が重なる場所は中心に近い粒、同距離なら手前の粒を優先する', () => {
    const dots = [dot({ id: 1, size: 'small', x: 700 }), dot({ id: 2, size: 'small', x: 706 })];
    expect(hitTestBoardDot({ x: 702, y: 310 }, dots, draggable)).toBe(1);
    expect(hitTestBoardDot({ x: 703, y: 310 }, dots, draggable)).toBe(2);
    expect(hitTestBoardDot({ x: 705, y: 310 }, dots, draggable)).toBe(2);
  });

  it('draggable でない粒は手前でも素通しする', () => {
    const dots = [dot({ id: 1, x: 700, y: 300 }), dot({ id: 9, x: 700, y: 300 })];
    expect(hitTestBoardDot({ x: 700, y: 300 }, dots, draggable)).toBe(1);
    expect(hitTestBoardDot({ x: 700, y: 300 }, dots, new Set<number>())).toBeNull();
  });

  it('近さは設計座標ではなく画面上の距離で比較する', () => {
    const dots = [
      dot({ id: 1, size: 'small', x: 100, y: 114 }),
      dot({ id: 2, size: 'small', x: 120, y: 100 }),
    ];
    expect(hitTestBoardDot({ x: 100, y: 100 }, dots, draggable, { x: 0.2, y: 1 })).toBe(2);
  });

  it('粒サイズで判定半径が変わる', () => {
    const small = [dot({ id: 1, size: 'small' })]; // 直径 16 → 半径 8 + 6 = 14
    expect(hitTestBoardDot({ x: 713, y: 300 }, small, draggable)).toBe(1);
    expect(hitTestBoardDot({ x: 715, y: 300 }, small, draggable)).toBeNull();
    const large = [dot({ id: 1, size: 'large' })]; // 直径 34 → 半径 17 + 6 = 23
    expect(hitTestBoardDot({ x: 722, y: 300 }, large, draggable)).toBe(1);
  });
});

describe('flowDriftOffset', () => {
  it('位相 0 は必ず (0,0)（freezeForScreenshot の決定論）', () => {
    expect(flowDriftOffset(0, 1, 0)).toEqual({ x: 0, y: 0 });
    expect(flowDriftOffset(45, 1.35, 0)).toEqual({ x: 0, y: 0 });
  });

  it('半周期で最大振幅（進行方向 5px ＋ 上 3px）に達する', () => {
    const half = flowDriftPeriodMs(1) / 2;
    const at = flowDriftOffset(0, 1, half);
    expect(at.x).toBeCloseTo(5, 5);
    expect(at.y).toBeCloseTo(-3, 5);
  });

  it('角度で進行方向成分が回る', () => {
    const half = flowDriftPeriodMs(1) / 2;
    const at = flowDriftOffset(90, 1, half);
    expect(at.x).toBeCloseTo(0, 5);
    expect(at.y).toBeCloseTo(5 - 3, 5);
  });

  it('speedMul で周期が縮む（AI 粒は速く見える）', () => {
    expect(flowDriftPeriodMs(1)).toBeCloseTo(1150, 5);
    expect(flowDriftPeriodMs(1.35)).toBeCloseTo(1150 / 1.35, 5);
    // 1 周期経過で位相 0 に戻る。
    const period = flowDriftPeriodMs(1.35);
    const at = flowDriftOffset(30, 1.35, period);
    expect(at.x).toBeCloseTo(0, 5);
    expect(at.y).toBeCloseTo(0, 5);
  });

  it('負の経過時間でも発散しない', () => {
    const at = flowDriftOffset(0, 1, -1150 / 2);
    expect(at.x).toBeCloseTo(5, 5);
    expect(at.y).toBeCloseTo(-3, 5);
  });
});

describe('bobOffsetY', () => {
  it('位相 0 で 0、半周期で -振幅', () => {
    expect(bobOffsetY(0)).toBe(0);
    expect(bobOffsetY(1200)).toBeCloseTo(-3, 5);
    expect(bobOffsetY(2400)).toBeCloseTo(0, 5);
  });

  it('周期・振幅を指定できる（キャラ bob 用）', () => {
    expect(bobOffsetY(500, 1000, 2)).toBeCloseTo(-2, 5);
    expect(bobOffsetY(100, 0)).toBe(0);
  });
});

describe('fireShake', () => {
  it('緊急度で周期が縮む（CSS burn-warn/burn-critical と同値）', () => {
    expect(fireShakePeriodMs(undefined)).toBe(250);
    expect(fireShakePeriodMs(0.8)).toBe(180);
    expect(fireShakePeriodMs(0.34)).toBe(120);
  });

  it('4 段階ステップで位相 0 は (0,0)', () => {
    expect(fireShakeOffset(0)).toEqual({ x: 0, y: 0 });
    expect(fireShakeOffset(250 * 0.25)).toEqual({ x: 0.7, y: -0.7 });
    expect(fireShakeOffset(250 * 0.5)).toEqual({ x: -0.7, y: 0.7 });
    expect(fireShakeOffset(250 * 0.75)).toEqual({ x: 0.7, y: 0.7 });
    expect(fireShakeOffset(250)).toEqual({ x: 0, y: 0 });
  });
});

describe('lineDashSegments', () => {
  it('offset 0 は原点から dash/gap で刻む', () => {
    const segs = lineDashSegments(0, 0, 30, 0, 6, 9, 0);
    expect(segs).toEqual([
      [
        { x: 0, y: 0 },
        { x: 6, y: 0 },
      ],
      [
        { x: 15, y: 0 },
        { x: 21, y: 0 },
      ],
    ]);
  });

  it('負の offset でパターンが進行方向へずれる', () => {
    const segs = lineDashSegments(0, 0, 30, 0, 6, 9, -3);
    // 始まりが +3 ずれ、先頭に前周期の尻尾（0..0+?）は無い（3 から dash 開始）。
    expect(segs[0]).toEqual([
      { x: 3, y: 0 },
      { x: 9, y: 0 },
    ]);
  });

  it('1 周期ぶんの offset で元に戻る（マーチングアンツの連続性）', () => {
    const a = lineDashSegments(0, 0, 100, 0, 6, 9, 0);
    const b = lineDashSegments(0, 0, 100, 0, 6, 9, -15);
    expect(b).toEqual(a);
  });

  it('斜め線・ゼロ長・不正 dash を処理する', () => {
    const diag = lineDashSegments(0, 0, 30, 40, 25, 25, 0);
    expect(diag[0][1].x).toBeCloseTo(15, 5);
    expect(diag[0][1].y).toBeCloseTo(20, 5);
    expect(lineDashSegments(5, 5, 5, 5, 6, 9)).toEqual([]);
    expect(lineDashSegments(0, 0, 10, 0, 0, 9)).toEqual([]);
  });
});

describe('テクスチャキャッシュキー', () => {
  it('variant×size / lane×mood で一意になる', () => {
    expect(dotTextureKey('ai', 'small')).toBe('dot:ai:small');
    expect(dotTextureKey('incident', 'large')).toBe('dot:incident:large');
    expect(actorTextureKey('review', 'panic')).toBe('actor:review:panic');
    expect(actorTextureKey('done', 'cheer')).toBe('actor:done:cheer');
  });
});

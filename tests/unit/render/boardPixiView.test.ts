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
  bobOffsetY,
  dotTextureKey,
  fireShakeOffset,
  fireShakePeriodMs,
  flowDriftOffset,
  flowDriftPeriodMs,
  hitTestBoardDot,
  lineDashSegments,
  planBoardDotsForRender,
} from '../../../src/render/boardPixiView';
import type { BoardDotPlan } from '../../../src/render/boardScene';

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

  it('重なりは後から描かれた粒（手前）を優先する', () => {
    const dots = [dot({ id: 1, x: 700, y: 300 }), dot({ id: 2, x: 706, y: 300 })];
    expect(hitTestBoardDot({ x: 702, y: 300 }, dots, draggable)).toBe(2);
  });

  it('draggable でない粒は手前でも素通しする', () => {
    const dots = [dot({ id: 1, x: 700, y: 300 }), dot({ id: 9, x: 700, y: 300 })];
    expect(hitTestBoardDot({ x: 700, y: 300 }, dots, draggable)).toBe(1);
    expect(hitTestBoardDot({ x: 700, y: 300 }, dots, new Set<number>())).toBeNull();
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

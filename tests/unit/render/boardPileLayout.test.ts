import { describe, expect, it } from 'vitest';
import { planBoardScene } from '../../../src/render/boardScene';
import {
  adjustReviewPileLayout,
  applyLanePileShift,
  boardPhoneContainmentScales,
  boardPhonePresentationScales,
  countReviewCrossStationOverlaps,
  findReviewPileShift,
  reviewPilePresentationScales,
} from '../../../src/render/boardPileLayout';
import { BOARD_STATION_CENTERS } from '../../../src/render/boardStationCenters';
import {
  presentBoardDots,
  presentedDotRadius,
  presentedDotHitsOtherStation,
  hitTestBoardDot,
} from '../../../src/render/boardPixiView';
import { RunEngine } from '../../../src/sim/run/engine';
import { splitPrCandidates } from '../../../src/sim/assignTask';
import { makeTask } from '../helpers/sprintFixtures';

function piledReviewWithCodingFlowTasks() {
  const review = Array.from({ length: 15 }, (_, index) =>
    makeTask(index + 1, {
      lane: 'review',
      kind: index % 5 === 0 ? 'complex' : index % 3 === 0 ? 'routine' : 'normal',
    }),
  );
  return [...review, makeTask(29, { lane: 'coding', kind: 'normal', progress: 0.48 })];
}

describe('boardPileLayout（Review 山の寄せ）', { timeout: 60_000 }, () => {
  it.each([0.48, 0.5])('フロー進捗 %s でも最適化前と同じ配置を選ぶ（#1167）', (progress) => {
    const tasks = piledReviewWithCodingFlowTasks();
    tasks[tasks.length - 1].progress = progress;
    const scene = planBoardScene(tasks);
    const anchor = scene.dots.find((dot) => dot.lane === 'review' && !dot.motion)!;
    expect([anchor.clusterX, anchor.clusterY]).toEqual([844, 209]);
    expect(countReviewCrossStationOverlaps(scene.dots)).toBe(0);
  });

  // 7c45b0d5 の実行結果。compact / extended / 解なしを含め、同点時の選択も固定する。
  it.each([
    {
      seed: 'qa-seed-1031',
      anchors: [
        [840, 95],
        [842, 187],
        [832, 107],
        [840, 123],
      ],
    },
    {
      seed: 'qa-seed-1030',
      anchors: [
        [832, 107],
        [840, 95],
        [840, 315],
        [832, 107],
      ],
    },
    {
      seed: 'devops-tycoon',
      anchors: [
        [922, 327],
        [840, 181],
        [840, 109],
        [832, 107],
      ],
    },
  ])('$seed の進行中も最適化前と同じ基準点を選ぶ（#1167）', ({ seed, anchors }) => {
    const engine = new RunEngine({ seed, difficulty: 'easy' });
    engine.startRun('easy', [], seed);
    engine.beginSetupSprint();
    const checkpoints = [20, 26, 30, 35];
    for (let step = 0; step <= 35; step += 1) {
      const index = checkpoints.indexOf(step);
      if (index >= 0) {
        const tasks = engine.snapshot().sprint!.tasks;
        const scene = planBoardScene(tasks);
        const anchor = scene.dots.find((dot) => dot.lane === 'review' && !dot.motion)!;
        expect([anchor.clusterX, anchor.clusterY], `step ${step}`).toEqual(anchors[index]);
        // 解がない状態も、同一入力の再探索で座標を変えない。
        expect(planBoardScene(tasks)).toEqual(scene);
      }
      engine.step(100);
    }
  });

  it('320/390 の見分け縮尺で他工程粒と交差しない Review 山を返す', { timeout: 120_000 }, () => {
    const scene = planBoardScene(piledReviewWithCodingFlowTasks());
    for (const scale of boardPhonePresentationScales()) {
      const presented = presentBoardDots(scene.dots, scale);
      const review = presented.filter((dot) => dot.lane === 'review' && !dot.motion);
      const others = presented.filter((dot) => dot.lane !== 'review');
      for (const left of review) {
        for (const right of others) {
          const dist = Math.hypot(left.x - right.x, left.y - right.y);
          expect(
            dist,
            `粒 ${left.id} と ${right.id}（scale ${scale.toFixed(3)}）`,
          ).toBeGreaterThanOrEqual(
            presentedDotRadius(left.size, scale) + presentedDotRadius(right.size, scale) - 0.01,
          );
        }
      }
    }
  });

  it('qa-seed-1030 の Review 分割候補は 320 倍率で各中心がその粒を返す（#1001）', () => {
    const engine = new RunEngine({ seed: 'qa-seed-1030', difficulty: 'easy' });
    engine.startRun('easy', [], 'qa-seed-1030');
    engine.beginSetupSprint();
    for (let guard = 0; guard < 5000; guard += 1) {
      const snapshot = engine.snapshot();
      if (snapshot.phase !== 'sprint') break;
      if (snapshot.sprint!.tasks.filter((task) => task.lane === 'review').length >= 10) break;
      engine.step(40);
    }
    const sprint = engine.snapshot().sprint!;
    const dots = planBoardScene(sprint.tasks).dots;
    const scale = boardPhonePresentationScales()[0];
    const presented = presentBoardDots(dots, scale);
    const ids = new Set(splitPrCandidates(sprint).map((task) => task.id));
    for (const taskId of ids) {
      const index = dots.findIndex((dot) => dot.id === taskId);
      const dot = presented[index];
      expect(hitTestBoardDot(dot, dots, ids, { x: scale, y: scale }), `粒 #${taskId}`).toBe(taskId);
    }
  });

  it('qa-seed-1030 で Review 10 件超の Coding フロー粒を、描画内タップで選べる', () => {
    const engine = new RunEngine({ seed: 'qa-seed-1030', difficulty: 'easy' });
    engine.startRun('easy', [], 'qa-seed-1030');
    engine.beginSetupSprint();
    for (let guard = 0; guard < 5000; guard += 1) {
      const snapshot = engine.snapshot();
      if (snapshot.phase !== 'sprint') break;
      if (snapshot.sprint!.tasks.filter((task) => task.lane === 'review').length >= 10) break;
      engine.step(40);
    }
    const scene = planBoardScene(engine.snapshot().sprint!.tasks);
    expect(countReviewCrossStationOverlaps(scene.dots)).toBe(0);
    const scale = boardPhonePresentationScales()[0];
    const presented = presentBoardDots(scene.dots, scale);
    const target = presented.find((dot) => dot.id === 29);
    expect(target).toBeDefined();
    const ids = new Set(scene.dots.map((dot) => dot.id));
    const offset = 0.3 * presentedDotRadius(target!.size, scale);
    expect(
      hitTestBoardDot({ x: target!.x + offset, y: target!.y }, scene.dots, ids, {
        x: scale,
        y: scale,
      }),
    ).toBe(29);
  });

  it(
    'findReviewPileShift は決定論的で、交差ゼロかつステーション中央に寄せる',
    { timeout: 120_000 },
    () => {
      const baseline = planBoardScene(piledReviewWithCodingFlowTasks()).dots;
      const anchor = baseline.find((dot) => dot.lane === 'review' && dot.clusterX !== undefined)!;
      const reset = applyLanePileShift(baseline, 'review', {
        dx: 840 - anchor.clusterX!,
        dy: 315 - anchor.clusterY!,
      });
      const disturbed = applyLanePileShift(reset, 'review', { dx: -60, dy: 0 });
      expect(countReviewCrossStationOverlaps(disturbed)).toBeGreaterThan(0);
      const shift = findReviewPileShift(disturbed);
      const adjusted = applyLanePileShift(disturbed, 'review', shift);
      expect(countReviewCrossStationOverlaps(adjusted)).toBe(0);
      expect(shift).toEqual(findReviewPileShift(disturbed));
      expect(adjustReviewPileLayout(baseline)).toEqual(adjustReviewPileLayout(baseline));
    },
  );

  it('devops-tycoon・候補16件でも武装時の最大縮尺で工程キャラにはみ出さない（#918）', () => {
    const engine = new RunEngine({ seed: 'devops-tycoon', difficulty: 'easy' });
    engine.startRun('easy', [], 'devops-tycoon');
    engine.beginSetupSprint();
    const countSplitCandidates = () => {
      const sprint = engine.snapshot().sprint!;
      return sprint.tasks.filter(
        (task) => (task.lane === 'review' || task.lane === 'coding') && !task.split,
      ).length;
    };
    for (let guard = 0; guard < 8000 && engine.snapshot().phase === 'sprint'; guard += 1) {
      if (countSplitCandidates() === 16) break;
      engine.step(80);
    }
    expect(countSplitCandidates()).toBe(16);
    const dots = planBoardScene(engine.snapshot().sprint!.tasks).dots;
    const stations = (Object.keys(BOARD_STATION_CENTERS) as const).map((lane) => ({
      lane,
      x: BOARD_STATION_CENTERS[lane].x,
      y: BOARD_STATION_CENTERS[lane].y,
    }));
    for (const scale of boardPhoneContainmentScales()) {
      for (const dot of dots) {
        if (dot.motion) continue;
        expect(
          presentedDotHitsOtherStation(dot, scale, stations),
          `粒 ${dot.id}（scale ${scale.toFixed(3)}）`,
        ).toBe(false);
      }
    }
  });

  it('320/390/1024 で Review 山の提示重心がステーション中央へ近い（#994）', () => {
    const scene = planBoardScene(piledReviewWithCodingFlowTasks());
    expect(countReviewCrossStationOverlaps(scene.dots)).toBe(0);
    const stationX = BOARD_STATION_CENTERS.review.x;
    for (const scale of reviewPilePresentationScales()) {
      const presented = presentBoardDots(scene.dots, scale).filter(
        (dot) => dot.lane === 'review' && !dot.motion,
      );
      const centroidX = presented.reduce((sum, dot) => sum + dot.x, 0) / presented.length;
      expect(
        Math.abs(centroidX - stationX) * scale,
        `scale ${scale.toFixed(3)} の横ずれ（CSS px）`,
      ).toBeLessThan(3);
    }
  });
});

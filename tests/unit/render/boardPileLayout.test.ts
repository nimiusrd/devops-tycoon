import { describe, expect, it } from 'vitest';
import { planBoardScene } from '../../../src/render/boardScene';
import {
  adjustReviewPileLayout,
  applyLanePileShift,
  boardPhonePresentationScales,
  countReviewCrossStationOverlaps,
  findReviewPileShift,
  reviewPilePresentationScales,
} from '../../../src/render/boardPileLayout';
import { BOARD_STATION_CENTERS } from '../../../src/render/boardStationCenters';
import {
  presentBoardDots,
  presentedDotRadius,
  hitTestBoardDot,
} from '../../../src/render/boardPixiView';
import { RunEngine } from '../../../src/sim/run/engine';
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
  it('320/390 の見分け縮尺で他工程粒と交差しない Review 山を返す', () => {
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

  it('findReviewPileShift は決定論的で、交差ゼロかつステーション中央に寄せる', () => {
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
      ).toBeLessThan(2.5);
    }
  });
});

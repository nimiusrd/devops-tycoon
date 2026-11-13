import { describe, expect, it } from 'vitest';
import { planBoardScene } from '../../../src/render/boardScene';
import {
  adjustReviewPileLayout,
  applyLanePileShift,
  boardPhonePresentationScales,
  countReviewCrossStationOverlaps,
  findReviewPileShift,
} from '../../../src/render/boardPileLayout';
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

describe('boardPileLayout（Review 山の寄せ）', () => {
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

  it('findReviewPileShift は決定論的で、必要最小の移動を返す', () => {
    const baseline = planBoardScene(piledReviewWithCodingFlowTasks()).dots;
    const disturbed = applyLanePileShift(baseline, 'review', { dx: -60, dy: 36 });
    expect(countReviewCrossStationOverlaps(disturbed)).toBeGreaterThan(0);
    const shift = findReviewPileShift(disturbed);
    const adjusted = applyLanePileShift(disturbed, 'review', shift);
    expect(countReviewCrossStationOverlaps(adjusted)).toBe(0);
    expect(findReviewPileShift(disturbed)).toEqual(shift);
    expect(adjustReviewPileLayout(baseline)).toEqual(adjustReviewPileLayout(baseline));
  });
});

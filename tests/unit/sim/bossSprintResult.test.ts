/**
 * 四半期末（スプリント 6）も結果画面を一度だけ出し、確認後に四半期レビューへ進む（#989）。
 * スプリント 1〜5 は従来どおりドラフトへ進む。
 */
import { describe, expect, it } from 'vitest';
import { RunEngine } from '../../../src/sim/run/engine';
import { E2E_MISSED_ADJUSTABLE_SEED } from '../../../src/sim/run/quarterReviewSeeds';
import type { RunState } from '../../../src/sim/run/types';
import { advance } from '../helpers/runFlow';

/** スプリントを抜けた結果／レビュー／決着で止める。結果の確認は呼び出し側が行う。 */
function driveToSprintBoundary(engine: RunEngine): RunState {
  let guard = 0;
  while (guard < 8_000) {
    guard += 1;
    const state = engine.snapshot();
    if (state.status !== 'playing') return state;
    if (
      state.phase === 'result' ||
      state.phase === 'quarterReview' ||
      state.phase === 'lost' ||
      state.phase === 'won'
    ) {
      return state;
    }
    if (!advance(engine)) return engine.snapshot();
  }
  return engine.snapshot();
}

describe('四半期末のスプリント結果（#989）', () => {
  it('スプリント 1〜5 はドラフトへ、スプリント 6 は結果を一度出してから四半期レビューへ進む', () => {
    const engine = new RunEngine({ seed: E2E_MISSED_ADJUSTABLE_SEED, difficulty: 'easy' });
    engine.startRun();

    for (let sprint = 1; sprint <= 5; sprint += 1) {
      const ended = driveToSprintBoundary(engine);
      expect(ended.phase, `sprint ${sprint}`).toBe('result');
      expect(ended.sprintsPlayed).toBe(sprint);
      expect(ended.currentSprintKind).not.toBe('boss');
      expect(ended.quarterReview).toBeNull();
      expect(ended.reviewHistory).toEqual([]);
      expect(ended.lastResult).not.toBeNull();

      engine.step(100_000);
      expect(engine.snapshot().phase).toBe('result');

      const points = ended.evolution.points;
      engine.acknowledgeResult();
      const after = engine.snapshot();
      expect(after.phase).toBe('draft');
      expect(after.evolution.points).toBe(points);
      expect(after.draft?.length).toBeGreaterThan(0);
      expect(after.quarterReview).toBeNull();
    }

    const boss = driveToSprintBoundary(engine);
    expect(boss.phase).toBe('result');
    expect(boss.sprintsPlayed).toBe(6);
    expect(boss.quarterNumber).toBe(1);
    expect(boss.currentSprintKind).toBe('boss');
    expect(boss.lastResult).not.toBeNull();
    expect(boss.quarterReview).not.toBeNull();
    expect(boss.reviewHistory).toHaveLength(1);
    expect(boss.trendHistory).toHaveLength(1);
    expect(boss.draft).toBeNull();

    engine.step(100_000);
    const held = engine.snapshot();
    expect(held.phase).toBe('result');
    expect(held.reviewHistory).toEqual(boss.reviewHistory);
    expect(held.quarterReview).toEqual(boss.quarterReview);

    const saved = engine.exportPersistState();
    expect(saved?.phase).toBe('result');
    const restored = new RunEngine({ seed: 'issue-989-restore', difficulty: 'normal' });
    restored.hydratePersistState(saved!);
    expect(restored.snapshot().phase).toBe('result');
    restored.step(100_000);
    expect(restored.snapshot().phase).toBe('result');
    restored.acknowledgeResult();
    expect(restored.snapshot().phase).toBe('quarterReview');
    expect(restored.snapshot().reviewHistory).toHaveLength(1);
    restored.acknowledgeResult();
    expect(restored.snapshot().phase).toBe('quarterReview');
    expect(restored.snapshot().reviewHistory).toHaveLength(1);

    const points = boss.evolution.points;
    engine.acknowledgeResult();
    const review = engine.snapshot();
    expect(review.phase).toBe('quarterReview');
    expect(review.sprintsPlayed).toBe(6);
    expect(review.quarterNumber).toBe(1);
    expect(review.draft).toBeNull();
    expect(review.evolution.points).toBe(points);
    expect(review.reviewHistory).toEqual(boss.reviewHistory);
    expect(review.quarterReview).toEqual(boss.quarterReview);
    expect(review.lastResult).toEqual(boss.lastResult);

    engine.acknowledgeResult();
    engine.step(100_000);
    const again = engine.snapshot();
    expect(again.phase).toBe('quarterReview');
    expect(again.reviewHistory).toHaveLength(1);
    expect(again.trendHistory).toHaveLength(1);
  }, 20_000);
});

/**
 * Issue #476: Easy は出荷点が大きく、炎上があっても健全比が S 境界を超えやすい。
 * 評価 S は炎上・延焼ゼロを要求し、障害付きの高出荷は A にする。
 */
import { describe, expect, it } from 'vitest';
import { SPRINT_BALANCE } from '../../../src/data/balance';
import { RunEngine } from '../../../src/sim/run/engine';
import { DEFAULT_SEED } from '../../../src/sim/seed';
import { advance } from '../helpers/runFlow';

describe('Easy スプリント評価 (#476)', () => {
  it('seed devops-tycoon の無介入 Sprint 1 は炎上があると S にならない', () => {
    const engine = new RunEngine({ seed: DEFAULT_SEED, difficulty: 'easy' });
    engine.startRun('easy', [], DEFAULT_SEED, { kind: 'normal', scenario: 'default' });
    let guard = 0;
    while (
      engine.snapshot().phase !== 'result' &&
      engine.snapshot().status === 'playing' &&
      guard < 8_000
    ) {
      guard += 1;
      if (!advance(engine)) break;
    }

    const result = engine.snapshot().lastResult;
    expect(result).not.toBeNull();
    expect(result?.done).toBe(58);
    expect(result?.incidents).toBeGreaterThan(0);
    expect(result?.gradeRatio).toBeGreaterThanOrEqual(SPRINT_BALANCE.gradeThresholdS.value);
    expect(result?.grade).toBe('A');
  });
});

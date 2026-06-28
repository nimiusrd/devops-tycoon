import { describe, expect, it } from 'vitest';
import { RunEngine } from '../../src/sim/run/engine';
import {
  E2E_MISSED_ADJUSTABLE_SEED,
  E2E_SHUTDOWN_SEED,
} from '../../src/sim/run/quarterReviewSeeds';
import type { RunState } from '../../src/sim/run/types';
import { playUntil } from './helpers/runFlow';

function playToReview(seed: string, difficulty: RunState['difficulty'] = 'easy'): RunState {
  const e = new RunEngine({ seed, difficulty });
  e.startRun();
  return playUntil(e, 'quarterReview');
}

describe('四半期レビュー E2E seed', () => {
  it('missed_adjustable 用 seed が決定論的', () => {
    const s = playToReview(E2E_MISSED_ADJUSTABLE_SEED);
    expect(s.phase).toBe('quarterReview');
    expect(s.quarterReview?.outcome).toBe('missed_adjustable');
    expect(s.quarterReview?.bossCleared).toBe(false);
  });

  it('shutdown 用 seed が決定論的', () => {
    const s = playToReview(E2E_SHUTDOWN_SEED, 'nightmare');
    expect(s.phase).toBe('quarterReview');
    expect(['shutdown', 'reorg_required', 'missed_crisis']).toContain(s.quarterReview?.outcome);
  });
});

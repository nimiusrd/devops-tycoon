import { describe, expect, it } from 'vitest';
import { RunEngine } from '../../src/sim/run/engine';
import {
  E2E_MISSED_ADJUSTABLE_SEED,
  E2E_SHUTDOWN_SEED,
} from '../../src/sim/run/quarterReviewSeeds';
import type { RunState } from '../../src/sim/run/types';

function playToReview(seed: string, difficulty: RunState['difficulty'] = 'easy'): RunState {
  const e = new RunEngine({ seed, difficulty });
  e.startRun();
  let s = e.snapshot();
  let guard = 0;
  while (s.status === 'playing' && s.phase !== 'quarterReview' && guard < 40_000) {
    guard += 1;
    switch (s.phase) {
      case 'map':
        e.enterNode(s.available[0]);
        break;
      case 'sprint':
        e.step(1_000_000);
        break;
      case 'result':
        e.acknowledgeResult();
        break;
      case 'draft':
        e.skipDraft();
        break;
      case 'evolution':
        e.finishEvolution();
        break;
      case 'event':
        e.chooseEvent(0);
        break;
      case 'shop':
        e.leaveShop();
        break;
      case 'rest':
        e.restChoose('heal');
        break;
      default:
        guard = 40_000;
        break;
    }
    s = e.snapshot();
  }
  return s;
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

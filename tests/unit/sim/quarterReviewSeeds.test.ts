import { describe, expect, it } from 'vitest';
import { RunEngine } from '../../../src/sim/run/engine';
import { isTerminalFailure } from '../../../src/sim/run/quarterReview';
import {
  E2E_MISSED_ADJUSTABLE_SEED,
  E2E_SHUTDOWN_SEED,
  E2E_TERMINAL_SEEDS,
  type TerminalQuarterSeed,
} from '../../../src/sim/run/quarterReviewSeeds';
import type { RunState } from '../../../src/sim/run/types';
import { advance, playUntil } from '../helpers/runFlow';

function playToReview(seed: string, difficulty: RunState['difficulty'] = 'easy'): RunState {
  const e = new RunEngine({ seed, difficulty });
  e.startRun();
  return playUntil(e, 'quarterReview');
}

/** missed_adjustable を通過しつつ、終端レビューまで進める。 */
function playToTerminalReview(entry: TerminalQuarterSeed): RunState {
  const e = new RunEngine({ seed: entry.seed, difficulty: entry.difficulty });
  e.startRun();
  let s = playUntil(e, 'quarterReview', {}, 80_000);
  let guard = 0;
  while (s.status === 'playing' && s.phase === 'quarterReview' && guard < 20) {
    guard += 1;
    const outcome = s.quarterReview?.outcome;
    if (outcome && isTerminalFailure(outcome)) return s;
    if (!advance(e)) break;
    s = e.snapshot();
    if (s.status === 'playing' && s.phase !== 'quarterReview') {
      s = playUntil(e, 'quarterReview', {}, 80_000);
    }
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

  it('shutdown 用互換 seed が継続不能のいずれかになる', () => {
    const s = playToReview(E2E_SHUTDOWN_SEED, 'hard');
    expect(s.phase).toBe('quarterReview');
    expect(['shutdown', 'reorg_required', 'missed_crisis']).toContain(s.quarterReview?.outcome);
  });

  it.each(E2E_TERMINAL_SEEDS)(
    '継続不能 $outcome 用 seed（$seed / $difficulty）が決定論的',
    (entry) => {
      const s = playToTerminalReview(entry);
      expect(s.phase).toBe('quarterReview');
      expect(s.quarterNumber).toBe(entry.quarterNumber);
      expect(s.quarterReview?.outcome).toBe(entry.outcome);
    },
  );
});

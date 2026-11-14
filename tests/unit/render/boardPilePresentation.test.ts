import { describe, expect, it } from 'vitest';
import {
  BoardPilePresentation,
  PILE_PRESENTATION,
} from '../../../src/render/boardPilePresentation';

describe('BoardPilePresentation', () => {
  it('武装・解除を 175ms で ease-out 補間し、reduced では即時に切り替える', () => {
    const motion = new BoardPilePresentation();
    motion.sync(false, 0, false);
    expect(motion.strengthAt(0)).toBe(0);

    motion.sync(true, 100, false);
    expect(motion.strengthAt(100)).toBe(0);
    const mid = motion.strengthAt(100 + PILE_PRESENTATION.travelMs / 2);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.7);
    expect(motion.strengthAt(100 + PILE_PRESENTATION.travelMs)).toBeCloseTo(1, 5);

    motion.sync(false, 1000, false);
    expect(motion.strengthAt(1000)).toBeCloseTo(1, 5);
    expect(motion.strengthAt(1000 + PILE_PRESENTATION.travelMs)).toBeCloseTo(0, 5);

    motion.sync(true, 0, true);
    expect(motion.strengthAt(0)).toBe(1);
    motion.sync(false, 50, true);
    expect(motion.strengthAt(50)).toBe(0);
  });
});

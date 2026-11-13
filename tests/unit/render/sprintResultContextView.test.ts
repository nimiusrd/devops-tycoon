import { describe, expect, it } from 'vitest';
import { planSprintResultContextLine } from '../../../src/render/sprintResultContextView';
import { reviewFreezeWatchPeak } from '../../../src/render/reviewFreezeCopy';

describe('sprintResultContextView（#1011）', () => {
  const base = {
    sprintsPerQuarter: 6,
    runReviewQueuePeak: 0,
    sprintReviewQueueMax: 0,
  };

  it('スプリント5以外では行を出さない', () => {
    expect(
      planSprintResultContextLine({ ...base, sprintsPlayed: 4, sprintReviewQueueMax: 40 }),
    ).toEqual({ show: false });
  });

  it('スプリント5で watch 以上なら凍結予兆を1行出す', () => {
    const peak = reviewFreezeWatchPeak();
    const line = planSprintResultContextLine({
      ...base,
      sprintsPlayed: 5,
      runReviewQueuePeak: peak,
      sprintReviewQueueMax: 10,
    });
    expect(line.show).toBe(true);
    if (line.show) {
      expect(line.kind).toBe('reviewFreeze');
      expect(line.text).toContain('レビュー凍結');
    }
  });
});

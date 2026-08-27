import { describe, expect, it } from 'vitest';
import { findNextReplayKeyframeIndex } from '../../../src/state/replayJump';

describe('findNextReplayKeyframeIndex', () => {
  const keyframes = [
    { phase: 'setup' as const },
    { phase: 'result' as const },
    { phase: 'draft' as const },
    { phase: 'result' as const },
    { phase: 'draft' as const },
    { phase: 'won' as const },
  ];

  it('現在位置より後の最初の対象 phase を返す', () => {
    expect(findNextReplayKeyframeIndex(keyframes, 1, 'draft')).toBe(2);
    expect(findNextReplayKeyframeIndex(keyframes, 2, 'draft')).toBe(4);
    expect(findNextReplayKeyframeIndex(keyframes, 3, 'draft')).toBe(4);
  });

  it('後ろに対象が無ければ null', () => {
    expect(findNextReplayKeyframeIndex(keyframes, 4, 'draft')).toBeNull();
    expect(findNextReplayKeyframeIndex(keyframes, 1, 'quarterReview')).toBeNull();
    expect(findNextReplayKeyframeIndex([{ phase: 'result' }], 0, 'draft')).toBeNull();
  });

  it('currentIndex が負なら先頭から探す', () => {
    expect(findNextReplayKeyframeIndex(keyframes, -1, 'draft')).toBe(2);
    expect(findNextReplayKeyframeIndex(keyframes, Number.NaN, 'setup')).toBe(0);
  });
});

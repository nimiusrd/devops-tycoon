import { describe, expect, it } from 'vitest';
import {
  REVIEW_HELL_ENTERED_MESSAGE,
  REVIEW_HELL_EXITED_MESSAGE,
  reviewHellLiveMessage,
} from '../../../src/render/reviewHellAlert';

describe('reviewHellLiveMessage', () => {
  it('初期が外なら読まず、入ったときと出たときに1回ずつ返す', () => {
    expect(reviewHellLiveMessage(null, false)).toBeNull();
    expect(reviewHellLiveMessage(false, false)).toBeNull();
    expect(reviewHellLiveMessage(false, true)).toBe(REVIEW_HELL_ENTERED_MESSAGE);
    expect(reviewHellLiveMessage(true, true)).toBeNull();
    expect(reviewHellLiveMessage(true, false)).toBe(REVIEW_HELL_EXITED_MESSAGE);
    expect(reviewHellLiveMessage(false, false)).toBeNull();
  });

  it('最初から入っているときは入った旨を1回だけ返す', () => {
    expect(reviewHellLiveMessage(null, true)).toBe(REVIEW_HELL_ENTERED_MESSAGE);
    expect(reviewHellLiveMessage(true, true)).toBeNull();
  });
});

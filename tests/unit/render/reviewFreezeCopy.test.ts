import { describe, expect, it } from 'vitest';
import { LOSE_LABEL } from '../../../src/render/runOutcomeLabels';
import {
  REVIEW_FREEZE_LOSE_EVENT_PHRASE,
  REVIEW_FREEZE_LOSE_NAME,
  planReviewFreezeRiskLine,
  reviewFreezePeakCap,
  reviewFreezeWatchPeak,
  reviewQueueHudCopy,
} from '../../../src/render/reviewFreezeCopy';
import { REVIEW_FREEZE_PEAK } from '../../../src/sim/outcome';
import { formatEventOutcomeTags } from '../../../src/render/eventOutcomeView';

describe('reviewFreezeCopy（#1011）', () => {
  it('敗北ラベルが全画面で同じ名前を指す', () => {
    expect(REVIEW_FREEZE_LOSE_NAME).toBe('レビュー凍結');
    expect(LOSE_LABEL.reviewFreeze.label).toBe(REVIEW_FREEZE_LOSE_NAME);
    expect(
      formatEventOutcomeTags({ forceLose: 'reviewFreeze' })
        .map((tag) => tag.label)
        .join(''),
    ).toContain(REVIEW_FREEZE_LOSE_EVENT_PHRASE);
  });

  it('HUD 上限は loseReviewFreezePeak と一致する', () => {
    expect(reviewFreezePeakCap()).toBe(REVIEW_FREEZE_PEAK);
    expect(reviewQueueHudCopy(35)).toMatchObject({
      detail: `レビュー待ち 35 / ${REVIEW_FREEZE_PEAK}`,
    });
    expect(reviewQueueHudCopy(36)).toMatchObject({
      detail: `あと ${REVIEW_FREEZE_PEAK - 36} 件で${REVIEW_FREEZE_LOSE_NAME}`,
    });
    expect(reviewQueueHudCopy(47)).toMatchObject({
      detail: `あと 1 件で${REVIEW_FREEZE_LOSE_NAME}`,
    });
  });

  it('watch 未満では凍結予兆行を出さない', () => {
    expect(planReviewFreezeRiskLine(reviewFreezeWatchPeak() - 1)).toEqual({ show: false });
    expect(planReviewFreezeRiskLine(reviewFreezeWatchPeak()).show).toBe(true);
  });
});

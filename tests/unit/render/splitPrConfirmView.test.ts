import { describe, expect, it } from 'vitest';
import {
  boardDotSplitConfirmRing,
  formatSplitPrConfirmAnnouncement,
  planSplitPrConfirmFromEffect,
  publishSplitPrConfirmAnnouncement,
  splitPrConfirmAnnouncementKey,
  splitPrConfirmDurationMs,
} from '../../../src/render/splitPrConfirmView';
import { VISUAL_TOKENS } from '../../../src/render/visualTokens';

describe('PR 分割確認（#1020）', () => {
  it('強調は 150〜200ms', () => {
    const ms = splitPrConfirmDurationMs();
    expect(ms).toBeGreaterThanOrEqual(150);
    expect(ms).toBeLessThanOrEqual(200);
    expect(ms).toBe(VISUAL_TOKENS.dimensions.sprint.dotSplitConfirm.durationMs);
  });

  it('読み上げ文は PR 番号を含む', () => {
    expect(formatSplitPrConfirmAnnouncement(32)).toBe('PR #32 を分割しました');
  });

  it('splitPr の affectedTaskId から cue を導く', () => {
    expect(
      planSplitPrConfirmFromEffect('splitPr', { actionId: 'splitPr', affectedTaskIds: [7] }, 2),
    ).toEqual({ taskId: 7, nonce: 2 });
    expect(planSplitPrConfirmFromEffect('assignTask', { actionId: 'assignTask' }, 1)).toBeNull();
  });

  it('同一キーでは読み上げを繰り返さない', () => {
    const cue = { taskId: 3, nonce: 1 };
    const key = splitPrConfirmAnnouncementKey(cue);
    expect(publishSplitPrConfirmAnnouncement(null, cue)).toEqual({
      lastSpokenKey: key,
      text: 'PR #3 を分割しました',
    });
    expect(publishSplitPrConfirmAnnouncement(key, cue)).toBeNull();
  });

  it('inset リングは粒半径を増やさない', () => {
    const preview = boardDotSplitConfirmRing('medium', 0.25);
    expect(preview.radius).toBeLessThan(26 / 2);
    expect(preview.strokeWidth).toBeGreaterThan(0);
  });
});

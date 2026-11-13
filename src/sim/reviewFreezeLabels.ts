/**
 * レビュー凍結（reviewFreeze）の共有ラベル（#1011）。
 * 閾値の正本は `src/sim/outcome.ts`。
 */
import { REVIEW_FREEZE_PEAK } from './outcome';

export const REVIEW_FREEZE_LOSE_NAME = 'レビュー凍結';

export const REVIEW_FREEZE_LOSE_EVENT_PHRASE = `${REVIEW_FREEZE_LOSE_NAME}でラン終了`;

export function reviewFreezePeakCap(): number {
  return REVIEW_FREEZE_PEAK;
}

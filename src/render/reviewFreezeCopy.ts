/**
 * レビュー凍結の UI コピー（HUD・結果画面の1行）。
 */
import { OUTCOME_BALANCE } from '../data/balance';
import { REVIEW_FREEZE_LOSE_NAME, reviewFreezePeakCap } from '../sim/reviewFreezeLabels';
import { REVIEW_FREEZE_PEAK } from '../sim/outcome';
import type { StatusMetricTone } from './status';

export {
  REVIEW_FREEZE_LOSE_EVENT_PHRASE,
  REVIEW_FREEZE_LOSE_NAME,
  reviewFreezePeakCap,
} from '../sim/reviewFreezeLabels';

export function reviewFreezeWatchPeak(): number {
  return Math.round(REVIEW_FREEZE_PEAK * OUTCOME_BALANCE.reviewFreezeWatchRatio.value);
}

export function reviewFreezeDangerPeak(): number {
  return REVIEW_FREEZE_PEAK - OUTCOME_BALANCE.reviewFreezeDangerOffset.value;
}

const NEAR_FREEZE_REMAINING_MAX = 12;

export interface ReviewQueueHudCopy {
  tone: StatusMetricTone;
  detail: string;
  warningChip?: string;
}

/**
 * ライブ Review 待ち件数の HUD 文言（#1011）。
 * 36 件（watch）未満は `N / cap`、以降は残り件数で凍結名を出す。
 */
export function reviewQueueHudCopy(liveQueue: number): ReviewQueueHudCopy {
  const cap = reviewFreezePeakCap();
  const queue = Math.max(0, Math.round(liveQueue));
  const remaining = cap - queue;
  if (queue < reviewFreezeWatchPeak()) {
    return { tone: 'good', detail: `レビュー待ち ${queue} / ${cap}` };
  }
  if (queue >= cap) {
    return {
      tone: 'danger',
      detail: `${REVIEW_FREEZE_LOSE_NAME}（${queue} / ${cap}）`,
      warningChip: `${REVIEW_FREEZE_LOSE_NAME}危険`,
    };
  }
  const nearDanger = remaining <= NEAR_FREEZE_REMAINING_MAX;
  const tone: StatusMetricTone =
    queue >= reviewFreezeDangerPeak() ? 'danger' : nearDanger ? 'watch' : 'watch';
  return {
    tone,
    detail: nearDanger
      ? `あと ${remaining} 件で${REVIEW_FREEZE_LOSE_NAME}`
      : `レビュー待ち ${queue} / ${cap}`,
    warningChip:
      queue >= reviewFreezeDangerPeak()
        ? `${REVIEW_FREEZE_LOSE_NAME}危険`
        : `${REVIEW_FREEZE_LOSE_NAME}注意`,
  };
}

/**
 * スプリントピークベースの凍結予兆チップ（既存 watch/danger 帯。ピークは累積指標）。
 */
export function reviewFreezePeakHudCopy(reviewQueuePeak: number): {
  tone: StatusMetricTone;
  detail: string;
  warningChip?: string;
} {
  const peakWatch = reviewQueuePeak >= reviewFreezeWatchPeak();
  const peakDanger = reviewQueuePeak >= reviewFreezeDangerPeak();
  if (!peakWatch) {
    return { tone: 'good', detail: `Review待ちピーク ${Math.round(reviewQueuePeak)}` };
  }
  if (peakDanger) {
    return {
      tone: 'danger',
      detail: '凍結危険・AIスロットルやPR分割でピークを下げる',
      warningChip: `${REVIEW_FREEZE_LOSE_NAME}危険`,
    };
  }
  return {
    tone: 'watch',
    detail: '凍結注意・渋滞ピークが限界に近い',
    warningChip: `${REVIEW_FREEZE_LOSE_NAME}注意`,
  };
}

export interface ReviewFreezeRiskLine {
  show: true;
  text: string;
  /** 大きいほど危険（#1014 との共有行で優先比較に使う）。 */
  severity: number;
}

export type ReviewFreezeRiskPlan = ReviewFreezeRiskLine | { show: false };

/** ボス前・スプリント5結果など、1行の凍結予兆。 */
export function planReviewFreezeRiskLine(reviewQueuePeak: number): ReviewFreezeRiskPlan {
  const peak = Math.max(0, Math.round(reviewQueuePeak));
  const cap = reviewFreezePeakCap();
  if (peak < reviewFreezeWatchPeak() || peak >= cap) return { show: false };
  const remaining = cap - peak;
  const danger = peak >= reviewFreezeDangerPeak();
  const text =
    remaining <= NEAR_FREEZE_REMAINING_MAX
      ? `レビュー待ちピーク ${peak}／${cap}。あと ${remaining} 件で${REVIEW_FREEZE_LOSE_NAME}。`
      : `レビュー待ちピーク ${peak}／${cap}。${REVIEW_FREEZE_LOSE_NAME}に近づいている。`;
  return { show: true, text, severity: danger ? 20 + peak : 10 + peak };
}

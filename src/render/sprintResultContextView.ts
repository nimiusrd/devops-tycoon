/**
 * スプリント結果画面の共有1行（#1011 凍結予兆 / #1014 四半期目標は別 issue）。
 * 危険度の高い行だけを出す。表示可否は画面を開いた時点の入力で決める（#966）。
 */
import {
  planReviewFreezeRiskLine,
  reviewFreezeDangerPeak,
  type ReviewFreezeRiskPlan,
} from './reviewFreezeCopy';

export interface SprintResultContextInput {
  sprintsPlayed: number;
  sprintsPerQuarter: number;
  /** ラン通算の Review ピーク（`RunTotals.reviewQueuePeak`）。 */
  runReviewQueuePeak: number;
  /** 今終えたスプリントの Review ピーク。 */
  sprintReviewQueueMax: number;
}

export type SprintResultContextLine =
  | {
      show: true;
      text: string;
      tone: 'watch' | 'danger';
      kind: 'reviewFreeze';
    }
  | { show: false };

function pickReviewFreezeLine(input: SprintResultContextInput): ReviewFreezeRiskPlan {
  const peak = Math.max(input.runReviewQueuePeak, input.sprintReviewQueueMax);
  return planReviewFreezeRiskLine(peak);
}

/** スプリント5（ボス直前）の結果だけ、凍結予兆行を検討する。 */
export function planSprintResultContextLine(
  input: SprintResultContextInput,
): SprintResultContextLine {
  const penultimate = input.sprintsPerQuarter - 1;
  if (input.sprintsPlayed !== penultimate) return { show: false };
  const freeze = pickReviewFreezeLine(input);
  if (!freeze.show) return { show: false };
  const peak = Math.max(input.runReviewQueuePeak, input.sprintReviewQueueMax);
  return {
    show: true,
    text: freeze.text,
    tone: peak >= reviewFreezeDangerPeak() ? 'danger' : 'watch',
    kind: 'reviewFreeze',
  };
}

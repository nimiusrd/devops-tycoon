/**
 * スプリント結果画面の共有1行（#1011 凍結予兆 / #1014 四半期目標）。
 * 危険度の高い行だけを出す。表示可否は画面を開いた時点の入力で決める（#966）。
 */
import { companyOrgFromTeams } from '../sim/orgscale';
import { measureGoalProgress } from '../sim/run/quarterReview';
import type { OrgState, QuarterGoal, RunTotals, TeamRunState } from '../sim/run/types';
import { planQuarterGoalProgressLine } from './quarterGoalProgressCopy';
import {
  planReviewFreezeRiskLine,
  reviewFreezeDangerPeak,
  type ReviewFreezeRiskPlan,
} from './reviewFreezeCopy';

export interface SprintResultContextInput {
  quarterNumber: number;
  /** 当四半期で直近に完了したスプリント番号（1 起点）。 */
  sprintIndexInQuarter: number;
  sprintsPerQuarter: number;
  quarterGoal: QuarterGoal;
  quarterTotals: RunTotals;
  org: OrgState;
  teams: readonly TeamRunState[];
  /** ラン通算の Review ピーク（`RunTotals.reviewQueuePeak`）。 */
  runReviewQueuePeak: number;
  /** 今終えたスプリントの Review ピーク。 */
  sprintReviewQueueMax: number;
}

export type SprintResultContextLine =
  | {
      show: true;
      text: string;
      tone: 'watch' | 'danger' | 'neutral';
      kind: 'reviewFreeze' | 'quarterGoal';
    }
  | { show: false };

type CandidateLine =
  | {
      show: true;
      text: string;
      tone: 'watch' | 'danger' | 'neutral';
      kind: 'reviewFreeze' | 'quarterGoal';
      severity: number;
    }
  | { show: false };

function pickReviewFreezeLine(input: SprintResultContextInput): ReviewFreezeRiskPlan {
  const peak = Math.max(input.runReviewQueuePeak, input.sprintReviewQueueMax);
  return planReviewFreezeRiskLine(peak);
}

function freezeCandidate(input: SprintResultContextInput): CandidateLine {
  const penultimate = input.sprintsPerQuarter - 1;
  if (input.sprintIndexInQuarter !== penultimate) return { show: false };
  const freeze = pickReviewFreezeLine(input);
  if (!freeze.show) return { show: false };
  const peak = Math.max(input.runReviewQueuePeak, input.sprintReviewQueueMax);
  return {
    show: true,
    text: freeze.text,
    tone: peak >= reviewFreezeDangerPeak() ? 'danger' : 'watch',
    kind: 'reviewFreeze',
    severity: freeze.severity,
  };
}

function quarterGoalCandidate(input: SprintResultContextInput): CandidateLine {
  const companyOrg = companyOrgFromTeams(input.teams, input.org);
  const progress = measureGoalProgress({
    goal: input.quarterGoal,
    org: companyOrg,
    totals: input.quarterTotals,
  });
  const line = planQuarterGoalProgressLine({
    quarterNumber: input.quarterNumber,
    sprintIndexInQuarter: input.sprintIndexInQuarter,
    sprintsPerQuarter: input.sprintsPerQuarter,
    progress,
  });
  if (!line.show) return { show: false };
  return {
    show: true,
    text: line.text,
    tone: line.tone === 'danger' ? 'danger' : 'neutral',
    kind: 'quarterGoal',
    severity: line.severity,
  };
}

/** スプリント結果を開いた時点で出す共有1行。 */
export function planSprintResultContextLine(
  input: SprintResultContextInput,
): SprintResultContextLine {
  const candidates = [quarterGoalCandidate(input), freezeCandidate(input)].filter(
    (line): line is Extract<CandidateLine, { show: true }> => line.show,
  );
  if (candidates.length === 0) return { show: false };
  const best = candidates.reduce((a, b) => (b.severity >= a.severity ? b : a));
  return {
    show: true,
    text: best.text,
    tone: best.tone,
    kind: best.kind,
  };
}

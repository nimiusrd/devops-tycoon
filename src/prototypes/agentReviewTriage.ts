/**
 * R&D用のAIレビュー事前トリアージ。実在モデルの能力・料金や品質改善率ではない。
 * 通常のレビュー承認を省略せず、固定の仮想工数だけを比較する。
 */
import type { AgentWorkflowState } from './agentWorkflowDat';

export type ReviewAssistance = 'human' | 'ai-precheck';

/** AI事前トリアージの初期設定に人間が使う時間（期間あたり1回）。 */
export const AI_TRIAGE_SETUP_MINUTES = 6;
/** 定型PRの4件に1件だけ、誤検知の再確認が必要という固定仮定。 */
export const AI_TRIAGE_FALSE_POSITIVE_MINUTES = 8;
/** AIが苦手な密結合PRは自動化利益がなく、結果確認だけに時間がかかる仮定。 */
export const AI_TRIAGE_COUPLED_OVERHEAD_MINUTES = 4;

export interface ReviewTriageJob {
  job: AgentWorkflowState;
  falsePositive: boolean;
  eligible: boolean;
}

export function configureReviewTriage(
  state: AgentWorkflowState,
  policy: ReviewAssistance,
  taskIndex: number,
): ReviewTriageJob {
  if (!Number.isInteger(taskIndex) || taskIndex < 0) {
    throw new Error('Review triage taskIndex must be a non-negative integer');
  }
  if (policy !== 'human' && policy !== 'ai-precheck') {
    throw new Error('Unknown review policy');
  }
  if (policy === 'human') return { job: state, falsePositive: false, eligible: false };

  const next = structuredClone(state);
  if (next.workload === 'routine') {
    const falsePositive = taskIndex % 4 === 3;
    next.coefficients.baseReviewMinutes =
      next.coefficients.baseReviewMinutes / 2 +
      (falsePositive ? AI_TRIAGE_FALSE_POSITIVE_MINUTES : 0);
    next.coefficients.asynchronousReviewContextMinutes /= 2;
    return { job: next, falsePositive, eligible: true };
  }

  next.coefficients.baseReviewMinutes += AI_TRIAGE_COUPLED_OVERHEAD_MINUTES;
  return { job: next, falsePositive: false, eligible: false };
}

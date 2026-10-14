/**
 * DATの削減を完成タスク数と混同しないための、隔離された期間容量モデル。
 *
 * 最初にAuthorの工数予算でPRを生成し、次にReviewerの工数予算でFIFO処理する。
 * 人間のアクティブ工数だけを予算から消費し、AIの処理時間・待機時間は消費しない。
 * 通常ランのRunEngineやタスク・カードには未接続。
 */
import {
  applyAgentWorkflow,
  chooseAgentWorkflowInput,
  createAgentWorkflow,
  type AgentMode,
  type AgentWorkflowState,
  type ApprovalPolicy,
  type Workload,
} from './agentWorkflowDat';
import {
  AI_TRIAGE_SETUP_MINUTES,
  configureReviewTriage,
  type ReviewAssistance,
} from './agentReviewTriage';

export interface AgentDatCapacity {
  workload: Workload;
  mode: AgentMode;
  approvalPolicy: ApprovalPolicy;
  taskCount: number;
  authorBudgetMinutes: number;
  reviewerBudgetMinutes: number;
  /** AIは事前判定のみ。最終確認は常に人間が行う。省略時はhuman。 */
  reviewAssistance?: ReviewAssistance;
  seed?: string;
}

export interface AgentDatPipelineResult {
  taskCount: number;
  startedTasks: number;
  createdPrs: number;
  completedTasks: number;
  waitingReview: number;
  waitingRework: number;
  codingInProgress: number;
  unstartedTasks: number;
  authorMinutesSpent: number;
  reviewerMinutesSpent: number;
  totalHumanMinutesSpent: number;
  agentRuntimeMinutes: number;
  approvalCount: number;
  humanTouchesBeforePr: number;
  reviewSetupMinutesSpent: number;
  aiReviewedPrs: number;
  aiFalsePositiveChecks: number;
}

/** 上限は1期間の比較が軽量かつ有限になるためのR&D専用制約。 */
function validateCapacity(input: AgentDatCapacity): void {
  if (
    input.reviewAssistance !== undefined &&
    input.reviewAssistance !== 'human' &&
    input.reviewAssistance !== 'ai-precheck'
  ) {
    throw new Error('Unknown review assistance');
  }
  if (!Number.isInteger(input.taskCount) || input.taskCount < 0 || input.taskCount > 500) {
    throw new Error('taskCount must be an integer from 0 through 500');
  }
  if (
    !Number.isFinite(input.authorBudgetMinutes) ||
    input.authorBudgetMinutes < 0 ||
    !Number.isFinite(input.reviewerBudgetMinutes) ||
    input.reviewerBudgetMinutes < 0
  ) {
    throw new Error('Human DAT budgets must be finite and non-negative');
  }
}

function applyWithinBudget(
  state: AgentWorkflowState,
  budget: number,
  alreadySpent: number,
  kind: 'authorDat' | 'reviewerDat',
): AgentWorkflowState | null {
  const next = applyAgentWorkflow(state, chooseAgentWorkflowInput(state));
  if (next === state) throw new Error('DAT pipeline operation did not progress');
  const cost = next[kind] - state[kind];
  // 予算を超える操作は丸ごと保留し、作業時間・ログ・成果を一切消費しない。
  if (alreadySpent + cost > budget) return null;
  return next;
}

export function simulateAgentDatPipeline(input: AgentDatCapacity): AgentDatPipelineResult {
  validateCapacity(input);
  const jobs: AgentWorkflowState[] = [];
  let authorMinutesSpent = 0;
  let reviewerMinutesSpent = 0;
  let reviewSetupMinutesSpent = 0;
  let aiReviewedPrs = 0;
  let aiFalsePositiveChecks = 0;
  const reviewAssistance = input.reviewAssistance ?? 'human';

  // 指示からPR完成までの作業。途中で予算切れなら1件を作業中に留める。
  for (let i = 0; i < input.taskCount; i += 1) {
    let state = configureReviewTriage(
      createAgentWorkflow(
        `${input.seed ?? 'DAT-pipeline'}:${i}`,
        input.workload,
        input.mode,
        input.approvalPolicy,
      ),
      reviewAssistance,
      i,
    ).job;
    while (state.stage === 'ready' || state.stage === 'coding') {
      const next = applyWithinBudget(
        state,
        input.authorBudgetMinutes,
        authorMinutesSpent,
        'authorDat',
      );
      if (next === null) break;
      authorMinutesSpent += next.authorDat - state.authorDat;
      state = next;
    }
    if (state.stage === 'ready') break;
    jobs.push(state);
    if (state.stage === 'coding') break;
  }

  // AI事前トリアージは人間のセットアップ工数を先に消費する。予算不足ならレビューできない。
  if (reviewAssistance === 'ai-precheck' && jobs.some((job) => job.stage === 'review')) {
    if (input.reviewerBudgetMinutes >= AI_TRIAGE_SETUP_MINUTES) {
      reviewSetupMinutesSpent = AI_TRIAGE_SETUP_MINUTES;
      reviewerMinutesSpent += reviewSetupMinutesSpent;
    }
  }

  // 最初に到着した全PRをFIFO登録し、修正後の再レビューは末尾へ送る。
  const reviewQueue = jobs.flatMap((job, index) => (job.stage === 'review' ? [index] : []));
  while (reviewQueue.length > 0) {
    if (reviewAssistance === 'ai-precheck' && reviewSetupMinutesSpent === 0) break;
    const index = reviewQueue.shift()!;
    const state = jobs[index]!;
    const reviewed = applyWithinBudget(
      state,
      input.reviewerBudgetMinutes,
      reviewerMinutesSpent,
      'reviewerDat',
    );
    if (!reviewed) break; // 先頭の予算が足りなければ後続案件も追い越さない。
    reviewerMinutesSpent += reviewed.reviewerDat - state.reviewerDat;
    if (reviewAssistance === 'ai-precheck' && state.stage === 'review') {
      // AI事前トリアージは最初のレビューに一度だけ適用する。
      aiReviewedPrs += 1;
      if (input.workload === 'routine' && index % 4 === 3) aiFalsePositiveChecks += 1;
    }

    if (reviewed.stage === 'rework') {
      const fixed = applyWithinBudget(
        reviewed,
        input.authorBudgetMinutes,
        authorMinutesSpent,
        'authorDat',
      );
      if (fixed) {
        authorMinutesSpent += fixed.authorDat - reviewed.authorDat;
        jobs[index] = fixed;
        reviewQueue.push(index); // 差戻し後の再レビューは後続PRの後。
      } else {
        jobs[index] = reviewed;
      }
    } else {
      jobs[index] = reviewed;
    }
  }

  const createdPrs = jobs.filter((job) => job.stepIndex === 3).length;
  const completedTasks = jobs.filter((job) => job.stage === 'done').length;
  const waitingReview = jobs.filter(
    (job) => job.stage === 'review' || job.stage === 'rereview',
  ).length;
  const waitingRework = jobs.filter((job) => job.stage === 'rework').length;
  const codingInProgress = jobs.filter((job) => job.stage === 'coding').length;

  return {
    taskCount: input.taskCount,
    startedTasks: jobs.length,
    createdPrs,
    completedTasks,
    waitingReview,
    waitingRework,
    codingInProgress,
    unstartedTasks: input.taskCount - jobs.length,
    authorMinutesSpent,
    reviewerMinutesSpent,
    totalHumanMinutesSpent: authorMinutesSpent + reviewerMinutesSpent,
    agentRuntimeMinutes: jobs.reduce((sum, job) => sum + job.agentRuntimeMinutes, 0),
    approvalCount: jobs.reduce((sum, job) => sum + job.approvalCount, 0),
    humanTouchesBeforePr: jobs.reduce((sum, job) => sum + job.humanTouchesBeforePr, 0),
    reviewSetupMinutesSpent,
    aiReviewedPrs,
    aiFalsePositiveChecks,
  };
}

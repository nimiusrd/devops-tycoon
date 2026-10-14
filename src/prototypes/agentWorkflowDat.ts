/**
 * 非同期型/伴走型と承認ポリシーを独立に比較する、DATの隔離試作。
 * 値は仮定した人間のアクティブ時間（分）。AIの処理時間はDATへ加算しない。
 */
export type AgentMode = 'companion' | 'asynchronous';
export type ApprovalPolicy = 'each-step' | 'preauthorized';
export type Workload = 'routine' | 'coupled';
export type WorkflowStage = 'ready' | 'coding' | 'review' | 'rework' | 'rereview' | 'done';
export type WorkflowInput = {
  type: 'start' | 'approve' | 'continue' | 'review' | 'fix' | 'view';
};

export interface DatCoefficients {
  instructionMinutes: number;
  supervisionMinutesPerStep: number;
  approvalMinutesPerStep: number;
  agentMinutesPerStep: number;
  baseReviewMinutes: number;
  asynchronousReviewContextMinutes: number;
  asynchronousReworkAuthorMinutes: number;
  asynchronousReworkReviewMinutes: number;
}

export interface AgentWorkflowState {
  version: 1;
  seed: string;
  workload: Workload;
  mode: AgentMode;
  approvalPolicy: ApprovalPolicy;
  coefficients: DatCoefficients;
  stage: WorkflowStage;
  stepIndex: number;
  approvalCount: number;
  humanTouchesBeforePr: number;
  authorDat: number;
  reviewerDat: number;
  agentRuntimeMinutes: number;
  reworkRounds: number;
  events: string[];
  inputs: WorkflowInput[];
}

const STEPS = ['edit', 'test', 'pr'] as const;
const COEFFICIENTS: Record<Workload, DatCoefficients> = {
  routine: {
    instructionMinutes: 6,
    supervisionMinutesPerStep: 1,
    approvalMinutesPerStep: 3,
    agentMinutesPerStep: 6,
    baseReviewMinutes: 12,
    asynchronousReviewContextMinutes: 4,
    asynchronousReworkAuthorMinutes: 0,
    asynchronousReworkReviewMinutes: 0,
  },
  coupled: {
    instructionMinutes: 6,
    supervisionMinutesPerStep: 1,
    approvalMinutesPerStep: 3,
    agentMinutesPerStep: 6,
    baseReviewMinutes: 24,
    asynchronousReviewContextMinutes: 8,
    asynchronousReworkAuthorMinutes: 35,
    asynchronousReworkReviewMinutes: 14,
  },
};

export function createAgentWorkflow(
  seed: string,
  workload: Workload,
  mode: AgentMode,
  approvalPolicy: ApprovalPolicy,
  overrides: Partial<DatCoefficients> = {},
): AgentWorkflowState {
  const coefficients = { ...COEFFICIENTS[workload], ...overrides };
  if (Object.values(coefficients).some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('DAT coefficients must be finite and non-negative');
  }
  return {
    version: 1,
    seed,
    workload,
    mode,
    approvalPolicy,
    coefficients,
    stage: 'ready',
    stepIndex: 0,
    approvalCount: 0,
    humanTouchesBeforePr: 0,
    authorDat: 0,
    reviewerDat: 0,
    agentRuntimeMinutes: 0,
    reworkRounds: 0,
    events: [],
    inputs: [],
  };
}

function completeSteps(state: AgentWorkflowState, count: number): void {
  for (let i = 0; i < count && state.stepIndex < STEPS.length; i += 1) {
    state.events.push(`${STEPS[state.stepIndex]}:complete`);
    state.stepIndex += 1;
    state.agentRuntimeMinutes += state.coefficients.agentMinutesPerStep;
  }
  if (state.stepIndex === STEPS.length) {
    state.stage = 'review';
    state.events.push('pr:created');
  }
}

function record(state: AgentWorkflowState, input: WorkflowInput): AgentWorkflowState {
  // 呼び出し側のオブジェクト変更で保存済み入力ログが書き換わらないよう複製する。
  state.inputs.push({ ...input });
  return state;
}

/** 無効な入力、閲覧、完了後の操作は無消費。状態と入力ログは不変に扱う。 */
export function applyAgentWorkflow(
  state: AgentWorkflowState,
  input: WorkflowInput,
): AgentWorkflowState {
  if (input.type === 'view') return state;
  if (input.type === 'start') {
    if (state.stage !== 'ready') return state;
    const next = structuredClone(state);
    next.stage = 'coding';
    next.authorDat += next.coefficients.instructionMinutes;
    next.humanTouchesBeforePr += 1;
    next.events.push('instruction');
    // 自動実行と事前許可が揃えば、初回指示の1ターンでPR作成まで進む。
    if (next.mode === 'asynchronous' && next.approvalPolicy === 'preauthorized') {
      completeSteps(next, STEPS.length);
    }
    return record(next, input);
  }
  if (input.type === 'approve') {
    if (state.stage !== 'coding' || state.approvalPolicy !== 'each-step') return state;
    const next = structuredClone(state);
    next.approvalCount += 1;
    next.humanTouchesBeforePr += 1;
    next.authorDat += next.coefficients.approvalMinutesPerStep;
    if (next.mode === 'companion') {
      next.authorDat += next.coefficients.supervisionMinutesPerStep;
    }
    next.events.push('human:approve');
    completeSteps(next, 1);
    return record(next, input);
  }
  if (input.type === 'continue') {
    if (
      state.stage !== 'coding' ||
      state.mode !== 'companion' ||
      state.approvalPolicy !== 'preauthorized'
    ) {
      return state;
    }
    const next = structuredClone(state);
    next.humanTouchesBeforePr += 1;
    next.authorDat += next.coefficients.supervisionMinutesPerStep;
    next.events.push('human:continue');
    completeSteps(next, 1);
    return record(next, input);
  }
  if (input.type === 'review') {
    if (state.stage !== 'review' && state.stage !== 'rereview') return state;
    const next = structuredClone(state);
    if (next.stage === 'rereview') {
      next.reviewerDat += next.coefficients.asynchronousReworkReviewMinutes;
      next.stage = 'done';
      next.events.push('review:accepted');
    } else {
      next.reviewerDat += next.coefficients.baseReviewMinutes;
      if (next.mode === 'asynchronous') {
        next.reviewerDat += next.coefficients.asynchronousReviewContextMinutes;
      }
      const rework =
        next.mode === 'asynchronous' &&
        (next.coefficients.asynchronousReworkAuthorMinutes > 0 ||
          next.coefficients.asynchronousReworkReviewMinutes > 0);
      next.stage = rework ? 'rework' : 'done';
      if (rework) next.reworkRounds += 1;
      next.events.push(rework ? 'review:changes-requested' : 'review:accepted');
    }
    return record(next, input);
  }
  if (input.type === 'fix') {
    if (state.stage !== 'rework') return state;
    const next = structuredClone(state);
    next.authorDat += next.coefficients.asynchronousReworkAuthorMinutes;
    next.stage = 'rereview';
    next.events.push('human:rework');
    return record(next, input);
  }
  return state;
}

/** PR作成とレビューを通過した完了タスクを混同しない。 */
export function summarizeAgentWorkflow(state: AgentWorkflowState) {
  const prCreated = state.stepIndex === STEPS.length;
  const done = state.stage === 'done';
  const totalHumanDat = state.authorDat + state.reviewerDat;
  return {
    prCreated,
    completedTasks: done ? 1 : 0,
    approvalCount: state.approvalCount,
    humanTouchesBeforePr: state.humanTouchesBeforePr,
    authorDat: state.authorDat,
    reviewerDat: state.reviewerDat,
    totalHumanDat,
    agentRuntimeMinutes: state.agentRuntimeMinutes,
    reworkRounds: state.reworkRounds,
    // 待機・並列化・AI利用料金は除いた、1タスク当たりの理論的な人時効率。
    // 未完了またはDATゼロでは率を算定できない（ゼロ能力と取り違えない）。
    tasksPerHumanHour:
      done && totalHumanDat > 0 ? Number((60 / totalHumanDat).toFixed(2)) : null,
  };
}

export function chooseAgentWorkflowInput(state: AgentWorkflowState): WorkflowInput {
  switch (state.stage) {
    case 'ready':
      return { type: 'start' };
    case 'coding':
      return { type: state.approvalPolicy === 'each-step' ? 'approve' : 'continue' };
    case 'review':
    case 'rereview':
      return { type: 'review' };
    case 'rework':
      return { type: 'fix' };
    case 'done':
      return { type: 'view' };
  }
}

export function compareAgentWorkflows(seed = 'DAT-probe') {
  return (['routine', 'coupled'] as const).flatMap((workload) =>
    (['companion', 'asynchronous'] as const).flatMap((mode) =>
      (['each-step', 'preauthorized'] as const).map((approvalPolicy) => {
        const initial = createAgentWorkflow(seed, workload, mode, approvalPolicy);
        let state = initial;
        let guard = 0;
        while (state.stage !== 'done') {
          if (++guard > 12) throw new Error(`${workload}:${mode}:${approvalPolicy}`);
          const next = applyAgentWorkflow(state, chooseAgentWorkflowInput(state));
          if (next === state) throw new Error('Workflow did not progress');
          state = next;
        }
        return {
          workload,
          mode,
          approvalPolicy,
          initial,
          inputs: state.inputs,
          result: summarizeAgentWorkflow(state),
        };
      }),
    ),
  );
}

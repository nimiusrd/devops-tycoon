import { applyAction } from '../sim/actions';
import { createOrgState } from '../sim/org';
import { createRng, createRngFromState, getRngState } from '../sim/rng';
import { createSprint, igniteTask, resolveSprintConfig, stepSprint } from '../sim/sprint';
import type { OrgState, SprintState } from '../sim/types';

/** RI-265: 架空ケース専用。通常のラン、解説ログ、保存、報酬へは接続しない。 */
export type AuditorCause = 'review-capacity' | 'uncontained-fire';
export type AuditorPlan = 'review' | 'contain' | 'broad';
export const AUDITOR_PLANS: readonly AuditorPlan[] = ['review', 'contain', 'broad'];
const CAUSES: readonly AuditorCause[] = ['review-capacity', 'uncontained-fire'];

export interface AuditorRules {
  deadline: number;
  taskCount: number;
  healthyCapacity: number;
  impairedCapacity: number;
  budget: number;
  costs: Record<AuditorPlan, number>;
}
export const AUDITOR_RULES: AuditorRules = {
  deadline: 3,
  taskCount: 6,
  healthyCapacity: 4,
  impairedCapacity: 0.1,
  budget: 4,
  costs: { review: 2, contain: 2, broad: 4 },
};

export interface AuditorSpec {
  seed: string;
  /** 作問者が明示生成した原因。実ランからの推定ラベルではない。 */
  generatedCause: AuditorCause;
  evidence: 'controlled' | 'observational';
  rules: AuditorRules;
}
export interface AuditorSimulation {
  org: OrgState;
  sprint: SprintState;
  tick: number;
  rngState: number;
  plan: AuditorPlan | null;
  /** 施策を適用済みなら、tick 0 でも二重適用を拒む。 */
  applied: boolean;
  inputs: string[];
}

function validateSpec(spec: AuditorSpec) {
  const r = spec.rules;
  if (
    typeof spec.seed !== 'string' ||
    !spec.seed ||
    !CAUSES.includes(spec.generatedCause) ||
    !['controlled', 'observational'].includes(spec.evidence) ||
    !Number.isInteger(r.deadline) ||
    r.deadline < 1 ||
    r.deadline > 30 ||
    !Number.isInteger(r.taskCount) ||
    r.taskCount < 1 ||
    r.taskCount > 30 ||
    !Number.isFinite(r.healthyCapacity) ||
    r.healthyCapacity <= 0 ||
    r.healthyCapacity > 10 ||
    !Number.isFinite(r.impairedCapacity) ||
    r.impairedCapacity < 0 ||
    r.impairedCapacity >= r.healthyCapacity ||
    !Number.isSafeInteger(r.budget) ||
    r.budget < 0 ||
    AUDITOR_PLANS.some((plan) => !Number.isSafeInteger(r.costs[plan]) || r.costs[plan] < 1)
  )
    throw new Error('Invalid auditor case');
}

export function createAuditorSpec(
  seed: string,
  generatedCause: AuditorCause,
  evidence: AuditorSpec['evidence'] = 'controlled',
  rules: AuditorRules = AUDITOR_RULES,
): AuditorSpec {
  const spec = structuredClone({ seed, generatedCause, evidence, rules });
  validateSpec(spec);
  return spec;
}

export function createAuditorSimulation(spec: AuditorSpec): AuditorSimulation {
  validateSpec(spec);
  const org = createOrgState('default', false);
  org.seniorHp = 100;
  const rng = createRng(`${spec.seed}:sprint`);
  const sprint = createSprint(
    resolveSprintConfig('default', {
      taskCount: spec.rules.taskCount,
      maxTicks: spec.rules.deadline,
      minCompleteTick: 0,
      focusMax: 8,
    }),
    org,
    rng,
  );
  // createSprintの既定係数は共有定数なので、試作用の上書き前に必ず分離する。
  sprint.cardEffects = { ...sprint.cardEffects };
  // 完成済み実装のレビューから始める。タスクの価値抽選と通常の再レビュー乱数は保持する。
  for (const task of sprint.tasks) {
    task.kind = 'routine';
    task.lane = 'review';
  }
  sprint.cardEffects.reviewCapacityMul = spec.rules.healthyCapacity;
  if (spec.generatedCause === 'review-capacity') {
    sprint.cardEffects.reviewCapacityMul = spec.rules.impairedCapacity;
  } else {
    igniteTask(sprint.tasks[0], sprint, 0);
  }
  return {
    org,
    sprint,
    tick: 0,
    rngState: getRngState(rng),
    plan: null,
    applied: false,
    inputs: [],
  };
}

/** 外部改善予算と、実simの集中力・HP消費は別々に記録する。 */
export function applyAuditorPlan(
  state: AuditorSimulation,
  spec: AuditorSpec,
  plan: AuditorPlan,
): AuditorSimulation {
  if (state.applied || state.tick !== 0 || state.sprint.complete || !AUDITOR_PLANS.includes(plan))
    return state;
  const next = structuredClone(state);
  if (plan === 'review' || plan === 'broad') {
    next.sprint.cardEffects.reviewCapacityMul = spec.rules.healthyCapacity;
  }
  if (plan === 'contain' || plan === 'broad') {
    const rng = createRngFromState(next.rngState);
    const outcome = applyAction('firefight', next.sprint, next.org, rng, 0);
    next.rngState = getRngState(rng);
    next.inputs.push(`firefight:${outcome.ok ? 'applied' : outcome.reason}`);
  }
  next.plan = plan;
  next.applied = true;
  next.inputs.unshift(`plan:${plan}`);
  return next;
}

export function tickAuditorSimulation(state: AuditorSimulation): AuditorSimulation {
  if (state.sprint.complete) return state;
  const next = structuredClone(state);
  const rng = createRngFromState(next.rngState);
  next.tick += 1;
  stepSprint(next.sprint, next.org, rng, next.tick);
  next.rngState = getRngState(rng);
  next.inputs.push('tick');
  return next;
}

export function summarizeAuditorSimulation(state: AuditorSimulation) {
  return {
    outcome: !state.sprint.complete
      ? 'running'
      : state.sprint.metrics.timedOut
        ? 'deadline-missed'
        : 'cleared',
    completed: state.sprint.metrics.completedCount,
    delivered: state.sprint.metrics.delivered,
    incidents: state.sprint.metrics.incidentCount,
    focusSpent: state.sprint.metrics.focusSpent,
    seniorHp: state.org.seniorHp,
    morale: state.org.morale,
    techDebt: state.org.techDebt,
    timeline: structuredClone(state.sprint.timeline),
    inputs: [...state.inputs],
    rngState: state.rngState,
  };
}

function publicResult(result: ReturnType<typeof summarizeAuditorSimulation>) {
  return {
    outcome: result.outcome,
    completed: result.completed,
    delivered: result.delivered,
    incidents: result.incidents,
    focusSpent: result.focusSpent,
    seniorHp: result.seniorHp,
    morale: result.morale,
    techDebt: result.techDebt,
    timeline: result.timeline,
  };
}

export function runAuditorSimulation(spec: AuditorSpec, plan: AuditorPlan | null = null) {
  let state = createAuditorSimulation(spec);
  if (plan !== null) state = applyAuditorPlan(state, spec, plan);
  while (!state.sprint.complete) state = tickAuditorSimulation(state);
  return summarizeAuditorSimulation(state);
}

function trialsOf(spec: AuditorSpec) {
  return AUDITOR_PLANS.map((plan) => ({
    id: `trial:${plan}`,
    plan,
    cost: spec.rules.costs[plan],
    affordable: spec.rules.costs[plan] <= spec.rules.budget,
    result: runAuditorSimulation(spec, plan),
  }));
}

export interface AuditorAnswer {
  cause: AuditorCause | 'insufficient';
  plan: AuditorPlan;
  evidenceIds: string[];
}
export interface AuditorSession {
  kind: 'RI-265-auditor';
  version: 1;
  spec: AuditorSpec;
  answer: AuditorAnswer | null;
}
export function createAuditorSession(spec: AuditorSpec): AuditorSession {
  validateSpec(spec);
  return { kind: 'RI-265-auditor', version: 1, spec: structuredClone(spec), answer: null };
}

/** 作問者の原因・内部状態・未公開trialは投影しない。全て新しい値を返す読み取りAPI。 */
export function viewAuditorCase(session: AuditorSession) {
  const { spec } = session;
  const initial = createAuditorSimulation(spec);
  return {
    fictional: true,
    rules: structuredClone(spec.rules),
    choices: AUDITOR_PLANS.map((plan) => ({
      plan,
      cost: spec.rules.costs[plan],
      affordable: spec.rules.costs[plan] <= spec.rules.budget,
    })),
    logs: [
      {
        id: 'observation:initial',
        kind: 'observation',
        reviewQueue: initial.sprint.tasks.filter((task) => task.lane === 'review').length,
        burning: initial.sprint.tasks.filter((task) => task.incident).length,
      },
      {
        id: 'observation:result',
        kind: 'observation',
        result: publicResult(runAuditorSimulation(spec)),
      },
    ],
    controlledTrials:
      spec.evidence === 'controlled'
        ? trialsOf(spec).map((trial) => ({ ...trial, result: publicResult(trial.result) }))
        : [],
    submitted: session.answer !== null,
  };
}

/** 回答の提出だけを記録する。架空ケースの過去・通常ランの資源は変更しない。 */
export function submitAuditorAnswer(
  session: AuditorSession,
  answer: AuditorAnswer,
): AuditorSession {
  if (
    session.answer !== null ||
    !AUDITOR_PLANS.includes(answer.plan) ||
    ![...CAUSES, 'insufficient'].includes(answer.cause) ||
    session.spec.rules.costs[answer.plan] > session.spec.rules.budget ||
    !Array.isArray(answer.evidenceIds) ||
    new Set(answer.evidenceIds).size !== answer.evidenceIds.length
  )
    return session;
  const view = viewAuditorCase(session);
  const ids = [...view.logs, ...view.controlledTrials].map((entry) => entry.id);
  if (answer.evidenceIds.some((id) => !ids.includes(id))) return session;
  return { ...session, answer: structuredClone(answer) };
}

/** 答え合わせは提出後のみ。原因の生成事実と介入で確認できた範囲を区別する。 */
export function auditorFeedback(session: AuditorSession) {
  if (!session.answer) return null;
  const { spec, answer } = session;
  const baseline = runAuditorSimulation(spec);
  const trials = trialsOf(spec);
  const review = trials.find((trial) => trial.plan === 'review')!;
  const contain = trials.find((trial) => trial.plan === 'contain')!;
  const supportedCause: AuditorCause | null =
    baseline.outcome !== 'deadline-missed'
      ? null
      : review.result.outcome === 'cleared' && contain.result.outcome !== 'cleared'
        ? 'review-capacity'
        : contain.result.outcome === 'cleared' && review.result.outcome !== 'cleared'
          ? 'uncontained-fire'
          : null;
  // 対照の両方が必要。結果ログや単一trialだけでは排他的な主因を証明しない。
  const requiredEvidence = ['observation:result', 'trial:review', 'trial:contain'];
  const available = spec.evidence === 'controlled' ? requiredEvidence : ['observation:result'];
  const missingEvidence = requiredEvidence.filter(
    (id) => !available.includes(id) || !answer.evidenceIds.includes(id),
  );
  const availableSupport =
    supportedCause !== null && requiredEvidence.every((id) => available.includes(id));
  const justified = availableSupport && missingEvidence.length === 0;
  const minimumCost = Math.min(
    ...trials
      .filter((trial) => trial.affordable && trial.result.outcome === 'cleared')
      .map((trial) => trial.cost),
  );
  const selected = trials.find((trial) => trial.plan === answer.plan)!;
  const spent = spec.rules.costs[answer.plan];
  return {
    generatedCause: spec.generatedCause,
    supportedCause,
    causalClaim: justified ? 'supported-in-generated-model' : 'insufficient-evidence',
    answerSupported:
      answer.cause === 'insufficient'
        ? !availableSupport
        : justified && answer.cause === supportedCause,
    missingEvidence,
    inconclusiveInterventions: supportedCause === null,
    selected,
    trials,
    minimumEffectivePlans: Number.isFinite(minimumCost)
      ? trials
          .filter(
            (trial) =>
              trial.affordable && trial.result.outcome === 'cleared' && trial.cost === minimumCost,
          )
          .map((trial) => trial.plan)
      : [],
    budgetSpent: spent,
    budgetRemaining: spec.rules.budget - spent,
    avoidableSpend:
      selected.result.outcome === 'cleared' && Number.isFinite(minimumCost)
        ? spent - minimumCost
        : null,
    foregonePlans: trials
      .filter(
        (trial) =>
          trial.plan !== answer.plan && trial.affordable && trial.cost > spec.rules.budget - spent,
      )
      .map((trial) => ({ plan: trial.plan, cost: trial.cost, result: trial.result })),
  };
}

/** 正本は生成条件＋回答。派生simを再生成するため、通常セーブのhydrateには渡さない。 */
export function restoreAuditorSession(json: string): AuditorSession {
  const data = JSON.parse(json) as AuditorSession;
  if (data.kind !== 'RI-265-auditor' || data.version !== 1)
    throw new Error('Invalid auditor session');
  const session = createAuditorSession(data.spec);
  if (data.answer === null) return session;
  const restored = submitAuditorAnswer(session, data.answer);
  if (restored === session) throw new Error('Invalid auditor answer');
  return restored;
}

export function compareAuditorCases() {
  const seeds = Array.from({ length: 8 }, (_, i) => `RI-265:${i}`);
  const factors = [
    { factor: 'control', rules: AUDITOR_RULES },
    ...[2, 4].map((deadline) => ({
      factor: `deadline:${deadline}`,
      rules: { ...AUDITOR_RULES, deadline },
    })),
    ...[2, 6].map((healthyCapacity) => ({
      factor: `capacity:${healthyCapacity}`,
      rules: { ...AUDITOR_RULES, healthyCapacity },
    })),
    ...[1, 2].map((budget) => ({
      factor: `budget:${budget}`,
      rules: { ...AUDITOR_RULES, budget },
    })),
    {
      factor: 'broad-cost:2',
      rules: { ...AUDITOR_RULES, costs: { ...AUDITOR_RULES.costs, broad: 2 } },
    },
  ];
  return factors.flatMap(({ factor, rules }) =>
    seeds.flatMap((seed) =>
      CAUSES.map((cause) => {
        const spec = createAuditorSpec(seed, cause, 'controlled', rules);
        return {
          factor,
          spec,
          initial: createAuditorSimulation(spec),
          baseline: runAuditorSimulation(spec),
          trials: trialsOf(spec),
        };
      }),
    ),
  );
}

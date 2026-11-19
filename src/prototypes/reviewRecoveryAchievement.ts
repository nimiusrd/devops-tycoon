import { ANDON_STABILITY_REVIEW_MIN, ANDON_TICKS, applyAction, tasksInLane } from '../sim/actions';
import { createOrgState } from '../sim/org';
import { createRng } from '../sim/rng';
import { createSprint, resolveSprintConfig, stepSprint } from '../sim/sprint';
import type { SprintState } from '../sim/types';
import { CURRENT_RUN_RULESET } from '../state/runPersistence';

export const REVIEW_RECOVERY_CRITERIA = {
  crisisMinimum: ANDON_STABILITY_REVIEW_MIN,
  recoveryMaximum: 5,
  sustainTicks: 3,
  observationTicks: 40,
} as const;

const TASK_COUNT = 24;
const TRACE_KIND = 'ri282-review-recovery';
type Choice = 'andon' | 'wait';

interface RecoverySample {
  tick: number;
  reviewQueue: number;
  backlog: number;
  openCodingSlot: boolean;
  originalReviewDone: number;
}

interface RecoveryTrace {
  kind: typeof TRACE_KIND;
  version: 1;
  ruleset: typeof CURRENT_RUN_RULESET;
  decision: { action: 'andon'; untilTick: number } | { action: 'wait' };
  observations: RecoverySample[];
}

function observe(sprint: SprintState, originalReview: ReadonlySet<number>, tick: number) {
  return {
    tick,
    reviewQueue: tasksInLane(sprint, 'review').length,
    backlog: tasksInLane(sprint, 'backlog').length,
    openCodingSlot: tasksInLane(sprint, 'coding').length < sprint.config.codingSlots,
    originalReviewDone: tasksInLane(sprint, 'done').filter(({ id }) => originalReview.has(id))
      .length,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= TASK_COUNT;
}

function readTrace(value: unknown): Pick<RecoveryTrace, 'decision' | 'observations'> | null {
  const { observationTicks } = REVIEW_RECOVERY_CRITERIA;
  if (
    !isObject(value) ||
    value.kind !== TRACE_KIND ||
    value.version !== 1 ||
    !isObject(value.ruleset) ||
    value.ruleset.version !== CURRENT_RUN_RULESET.version ||
    value.ruleset.fingerprint !== CURRENT_RUN_RULESET.fingerprint ||
    !isObject(value.decision) ||
    (value.decision.action !== 'wait' &&
      !(value.decision.action === 'andon' && value.decision.untilTick === ANDON_TICKS)) ||
    !Array.isArray(value.observations) ||
    value.observations.length !== observationTicks + 1
  ) {
    return null;
  }
  const decision: RecoveryTrace['decision'] =
    value.decision.action === 'andon'
      ? { action: 'andon', untilTick: ANDON_TICKS }
      : { action: 'wait' };
  const observations: RecoverySample[] = [];
  for (const [tick, sample] of value.observations.entries()) {
    if (
      !isObject(sample) ||
      sample.tick !== tick ||
      !isCount(sample.reviewQueue) ||
      !isCount(sample.backlog) ||
      !isCount(sample.originalReviewDone) ||
      typeof sample.openCodingSlot !== 'boolean' ||
      sample.reviewQueue + sample.backlog + sample.originalReviewDone > TASK_COUNT
    ) {
      return null;
    }
    const previous = observations[tick - 1];
    const initialQueue = observations[0]?.reviewQueue ?? sample.reviewQueue;
    if (
      sample.originalReviewDone > initialQueue ||
      (!previous && sample.originalReviewDone !== 0)
    ) {
      return null;
    }
    if (previous) {
      const paused = decision.action === 'andon' && previous.tick < decision.untilTick;
      if (
        sample.originalReviewDone < previous.originalReviewDone ||
        sample.backlog > previous.backlog ||
        (paused && sample.backlog !== previous.backlog)
      ) {
        return null;
      }
    }
    observations.push({
      tick,
      reviewQueue: sample.reviewQueue,
      backlog: sample.backlog,
      openCodingSlot: sample.openCodingSlot,
      originalReviewDone: sample.originalReviewDone,
    });
  }
  return { decision, observations };
}

/** 試作記録から出来事の順を確認する。自然回復や介入の因果効果は推定しない。 */
export function assessReviewRecovery(value: unknown) {
  const trace = readTrace(value);
  if (!trace) return { status: 'unassessed' } as const;
  const { crisisMinimum, recoveryMaximum, sustainTicks } = REVIEW_RECOVERY_CRITERIA;
  const { decision, observations } = trace;
  const first = observations[0]!;
  const last = observations[observations.length - 1]!;
  const recovered =
    first.reviewQueue >= crisisMinimum &&
    last.originalReviewDone >= Math.ceil(first.reviewQueue / 2) &&
    observations.slice(-sustainTicks).every(({ reviewQueue }) => reviewQueue <= recoveryMaximum);
  const pausedIntakeTicks =
    decision.action === 'andon'
      ? observations
          .slice(0, decision.untilTick)
          .filter((before) => before.backlog > 0 && before.openCodingSlot)
          .map(({ tick }) => tick)
      : [];
  const status = recovered && pausedIntakeTicks.length > 0 ? 'recorded' : 'not-recorded';
  return { status, recovered, pausedIntakeTicks } as const;
}

/** 同じ開始盤面で、tick 0 のアンドン1回と待機を比較するための隔離実験。 */
export function simulateReviewRecovery(seed: string, choice: Choice) {
  const org = createOrgState('default', true);
  const rng = createRng(seed);
  const { observationTicks } = REVIEW_RECOVERY_CRITERIA;
  const sprint = createSprint(
    resolveSprintConfig('default', {
      taskCount: TASK_COUNT,
      focusMax: 9,
      minCompleteTick: observationTicks,
      maxTicks: observationTicks + 1,
    }),
    org,
    rng,
  );
  const originalReview = new Set<number>();
  for (const task of sprint.tasks.slice(0, 12)) {
    task.lane = 'review';
    task.aiAssisted = true;
    originalReview.add(task.id);
  }
  const observations = [observe(sprint, originalReview, 0)];
  const initial = {
    org: { ...org },
    tasks: structuredClone(sprint.tasks),
    config: { ...sprint.config },
  };
  let decision: RecoveryTrace['decision'] = { action: 'wait' };
  let moraleCost = 0;
  if (choice === 'andon') {
    const { effect } = applyAction('andon', sprint, org, rng, 0);
    if (effect?.modifier?.kind !== 'andon') throw new Error('比較用のアンドンが発動しません');
    decision = { action: 'andon', untilTick: effect.modifier.untilTick };
    moraleCost = effect.moraleCost ?? 0;
  }
  for (let tick = 0; tick < observationTicks; tick += 1) {
    stepSprint(sprint, org, rng, tick);
    observations.push(observe(sprint, originalReview, tick + 1));
  }
  const trace: RecoveryTrace = {
    kind: TRACE_KIND,
    version: 1,
    ruleset: { ...CURRENT_RUN_RULESET },
    decision,
    observations,
  };
  return {
    seed,
    initial,
    trace,
    result: assessReviewRecovery(trace),
    outcome: {
      delivered: sprint.metrics.delivered,
      incidents: sprint.metrics.incidentCount,
      focusSpent: sprint.metrics.focusSpent,
      moraleCost,
      morale: org.morale,
      seniorHp: org.seniorHp,
    },
  };
}

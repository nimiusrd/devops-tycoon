import { describe, expect, it } from 'vitest';
import { ALL_ACTION_IDS, applyAction } from '../sim/actions';
import { assignMember, createInitialRoster, foldFormationEffects } from '../sim/member/roster';
import { IDENTITY_CARD_EFFECTS, taskValue } from '../sim/model';
import { createOrgState } from '../sim/org';
import { createRng, createRngFromState, getRngState } from '../sim/rng';
import { createSprint, resolveSprintConfig, stepSprint } from '../sim/sprint';
import type { ActionId, TaskKind } from '../sim/types';
import { applyPriorityReview, checkPriorityReview, PRIORITY_REVIEW } from './memberIntervention';
import type { MemberInterventionState } from './memberIntervention';

const REVIEWER = 'm2';
const TASK_COUNT = 8;
const DEADLINE = 2;
const TARGET = { memberId: REVIEWER, taskId: TASK_COUNT - 1 };

function makeTrial(seed: string) {
  const roster = createInitialRoster(createRng(`${seed}:roster`));
  const intervention: MemberInterventionState = { roster, priorityReviewUsedBy: [] };
  return { intervention, org: createOrgState('default', false) };
}

type Trial = ReturnType<typeof makeTrial>;

function makeWindow(trial: Trial, seed: string, taskId: number, priorityKind: TaskKind) {
  const rng = createRng(seed);
  const formation = foldFormationEffects(trial.intervention.roster);
  const config = resolveSprintConfig('default', {
    taskCount: TASK_COUNT,
    focusMax: 5,
    maxTicks: DEADLINE,
    minCompleteTick: 0,
  });
  const sprint = createSprint(config, trial.org, rng, {
    ...IDENTITY_CARD_EFFECTS,
    ...formation.effects,
  });
  for (const task of sprint.tasks) {
    task.lane = 'review';
    task.highValue = task.id === taskId;
    task.kind = task.highValue ? priorityKind : 'routine';
  }
  return { sprint, rng, target: { memberId: REVIEWER, taskId } };
}

function fixture() {
  const trial = makeTrial('RI-215:unit');
  return { ...trial, ...makeWindow(trial, 'RI-215:unit:race', TARGET.taskId, 'normal') };
}

function reviewerStamina(trial: Trial): number {
  return trial.intervention.roster.members.find(({ id }) => id === REVIEWER)!.stamina;
}

type Choice = ActionId | 'priority' | 'wait';

function playWindow(trial: Trial, seed: string, taskId: number, kind: TaskKind, choice: Choice) {
  const { target, sprint, rng } = makeWindow(trial, seed, taskId, kind);
  if (choice === 'priority') {
    expect(applyPriorityReview(trial.intervention, sprint, trial.org, rng, 0, target)).toEqual({
      ok: true,
    });
  } else if (choice !== 'wait') {
    const outcome = applyAction(choice, sprint, trial.org, rng, 0);
    if (choice === 'firefight' || choice === 'assignTask') {
      expect(outcome).toEqual({ ok: false, reason: 'no-target' });
    } else {
      expect(outcome.ok).toBe(true);
    }
  }
  for (let tick = 1; tick <= DEADLINE; tick += 1) stepSprint(sprint, trial.org, rng, tick);

  const priority = sprint.tasks.find(({ id }) => id === target.taskId)!;
  return {
    priorityShipped: Number(priority.lane === 'done'),
    priorityBaseValue: priority.lane === 'done' ? taskValue(priority) : 0,
    done: sprint.metrics.doneCount,
    delivered: sprint.metrics.delivered,
    focus: sprint.metrics.focusSpent,
  };
}

const SEEDS = Array.from({ length: 8 }, (_, index) => `RI-215:${index + 1}`);

function comparePlan(early: Choice, later: Choice, lateTaskId: number) {
  const totals = {
    early: 0,
    later: 0,
    priorityValue: 0,
    done: 0,
    delivered: 0,
    focus: 0,
    stamina: 0,
    literacy: 0,
  };
  for (const seed of SEEDS) {
    const trial = makeTrial(seed);
    const startStamina = reviewerStamina(trial);
    const startLiteracy = trial.org.aiLiteracy;
    const first = playWindow(trial, `${seed}:early`, TARGET.taskId, 'normal', early);
    const second = playWindow(trial, `${seed}:later`, lateTaskId, 'complex', later);
    totals.early += first.priorityShipped;
    totals.later += second.priorityShipped;
    totals.priorityValue += first.priorityBaseValue + second.priorityBaseValue;
    totals.done += first.done + second.done;
    totals.delivered += first.delivered + second.delivered;
    totals.focus += first.focus + second.focus;
    totals.stamina += startStamina - reviewerStamina(trial);
    totals.literacy += trial.org.aiLiteracy - startLiteracy;
  }
  return `${early}→${later} | ${totals.early} | ${totals.later} | ${totals.priorityValue} | ${totals.done} | ${totals.delivered} | ${totals.focus} | ${totals.stamina} | ${totals.literacy}`;
}

describe('RI-215 メンバー固有の優先レビュー', () => {
  it('発動前に本人と対象を読み取り、点火でも発動費用を払う', () => {
    const { intervention, sprint, org, rng } = fixture();
    const beforeRng = getRngState(rng);
    expect(checkPriorityReview(intervention, sprint, TARGET)).toMatchObject({
      ok: true,
      member: { id: REVIEWER, traits: [PRIORITY_REVIEW.trait] },
      task: { id: TARGET.taskId, lane: 'review', highValue: true },
    });
    expect(getRngState(rng)).toBe(beforeRng);
    const stamina = reviewerStamina({ intervention, org });
    const seniorHp = org.seniorHp;

    expect(applyPriorityReview(intervention, sprint, org, () => 0, 0, TARGET)).toEqual({
      ok: true,
    });

    expect(sprint.tasks[TARGET.taskId]).toMatchObject({ lane: 'rework', incident: true });
    expect(sprint.tasks.slice(0, -1).every(({ lane }) => lane === 'review')).toBe(true);
    expect(sprint.metrics).toMatchObject({
      interventionsUsed: 1,
      focusSpent: 3,
      stabilizingGrants: 0,
    });
    expect(sprint.focus).toBe(2);
    expect(sprint.comboGauge).toBe(0);
    expect(org.seniorHp).toBeLessThan(seniorHp);
    expect(reviewerStamina({ intervention, org })).toBe(stamina - PRIORITY_REVIEW.staminaCost);
    expect(intervention.priorityReviewUsedBy).toEqual([REVIEWER]);
  });

  const invalidCases = [
    { reason: 'missing-member', change: () => ({ ...TARGET, memberId: 'unknown' }) },
    {
      reason: 'on-leave',
      change: ({ intervention }: ReturnType<typeof fixture>) => {
        intervention.roster.members.find(({ id }) => id === REVIEWER)!.onLeave = true;
        return TARGET;
      },
    },
    {
      reason: 'ineligible-member',
      change: ({ intervention }: ReturnType<typeof fixture>) => {
        intervention.roster = assignMember(intervention.roster, REVIEWER, 'bench');
        return TARGET;
      },
    },
    {
      reason: 'ineligible-member',
      change: ({ intervention }: ReturnType<typeof fixture>) => {
        intervention.roster = assignMember(intervention.roster, 'm0', 'review');
        return { ...TARGET, memberId: 'm0' };
      },
    },
    { reason: 'no-target', change: () => undefined },
    { reason: 'no-target', change: () => ({ ...TARGET, taskId: 999 }) },
    { reason: 'no-target', change: () => ({ ...TARGET, taskId: 0 }) },
    {
      reason: 'no-target',
      change: ({ sprint }: ReturnType<typeof fixture>) => {
        sprint.tasks[TARGET.taskId].lane = 'coding';
        return TARGET;
      },
    },
    {
      reason: 'no-focus',
      change: ({ sprint }: ReturnType<typeof fixture>) => {
        sprint.focus = 2;
        return TARGET;
      },
    },
    {
      reason: 'no-stamina',
      change: ({ intervention }: ReturnType<typeof fixture>) => {
        intervention.roster.members.find(({ id }) => id === REVIEWER)!.stamina = 11;
        return TARGET;
      },
    },
    {
      reason: 'complete',
      change: ({ sprint }: ReturnType<typeof fixture>) => {
        sprint.complete = true;
        return TARGET;
      },
    },
  ];

  it.each(invalidCases)('不成立の $reason は盤面・資源・乱数を変えない', ({ change, reason }) => {
    const state = fixture();
    const target = change(state);
    const { intervention, org, sprint, rng } = state;
    const before = structuredClone({ intervention, org, sprint });
    const beforeRng = getRngState(rng);

    expect(applyPriorityReview(intervention, sprint, org, rng, 0, target)).toEqual({
      ok: false,
      reason,
    });
    expect({ intervention, org, sprint }).toEqual(before);
    expect(getRngState(rng)).toBe(beforeRng);
  });

  it('再配置・JSON再開・次のスプリントを経ても本人の使用済み記録を引き継ぐ', () => {
    const { intervention, sprint, org, rng } = fixture();
    expect(applyPriorityReview(intervention, sprint, org, rng, 0, TARGET).ok).toBe(true);
    const save = JSON.stringify({ intervention, sprint, org, rngState: getRngState(rng) });
    const restored = JSON.parse(save) as {
      intervention: MemberInterventionState;
      sprint: typeof sprint;
      org: typeof org;
      rngState: number;
    };
    stepSprint(sprint, org, rng, 1);
    stepSprint(restored.sprint, restored.org, createRngFromState(restored.rngState), 1);
    expect(restored.sprint).toEqual(sprint);
    expect(restored.org).toEqual(org);
    restored.intervention.roster = assignMember(restored.intervention.roster, REVIEWER, 'coding');
    restored.intervention.roster = assignMember(restored.intervention.roster, REVIEWER, 'review');
    const next = makeWindow(restored, 'RI-215:next', TARGET.taskId, 'complex');
    const before = structuredClone({
      trial: restored.intervention,
      sprint: next.sprint,
      org: restored.org,
    });

    expect(
      applyPriorityReview(
        restored.intervention,
        next.sprint,
        restored.org,
        next.rng,
        0,
        next.target,
      ),
    ).toEqual({ ok: false, reason: 'already-used' });
    expect({ trial: restored.intervention, sprint: next.sprint, org: restored.org }).toEqual(
      before,
    );
  });

  it.each([TARGET.taskId, 0])(
    '後半の高価値PRが ID %i の条件で実シムの結果を比較する',
    (lateTaskId) => {
      const comparisons = [
        comparePlan('wait', 'wait', lateTaskId),
        comparePlan('priority', 'interruptReview', lateTaskId),
        comparePlan('interruptReview', 'priority', lateTaskId),
        ...ALL_ACTION_IDS.map((action) => comparePlan(action, action, lateTaskId)),
      ];
      expect(comparisons.join('\n')).toMatchSnapshot();
    },
  );
});

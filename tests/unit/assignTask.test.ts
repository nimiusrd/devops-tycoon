/**
 * タスク差配の純関数テスト（RI-30）。
 */
import { describe, expect, it } from 'vitest';
import { applyAction, ASSIGN_MORALE_COST, ASSIGN_PROGRESS } from '../../src/sim/actions';
import {
  applyAssignTaskEffect,
  assignableTasks,
  canMoveToLane,
  computeAssignMoraleCost,
  defaultAssignee,
  isIdealAssignment,
  resolveAssignTaskTarget,
  resolveSplitPrTarget,
} from '../../src/sim/assignTask';
import { createOrgState } from '../../src/sim/org';
import { createSprint, resolveSprintConfig } from '../../src/sim/sprint';
import type { OrgState, SprintState, Task } from '../../src/sim/types';

const rng = () => 0.5;

const makeTask = (id: number, overrides: Partial<Task> = {}): Task => ({
  id,
  kind: 'normal',
  highValue: false,
  aiAssisted: false,
  lane: 'coding',
  progress: 0.1,
  reworkAttempts: 0,
  wasReworked: false,
  incident: false,
  debt: false,
  ...overrides,
});

function makeSprint(org: OrgState, tasks: Task[]): SprintState {
  const sprint = createSprint(resolveSprintConfig('default'), org, rng);
  sprint.tasks = tasks;
  return sprint;
}

describe('ideal / 偏重', () => {
  it('routine→ai / complex→senior が理想', () => {
    expect(isIdealAssignment('routine', 'ai')).toBe(true);
    expect(isIdealAssignment('complex', 'senior')).toBe(true);
    expect(isIdealAssignment('routine', 'senior')).toBe(false);
    expect(isIdealAssignment('complex', 'ai')).toBe(false);
    expect(isIdealAssignment('normal', 'ai')).toBe(true);
  });

  it('理想差配は士気コスト半減、ミスマッチはフル+streak', () => {
    expect(computeAssignMoraleCost('routine', 'ai', 0)).toBe(
      Math.max(1, Math.floor(ASSIGN_MORALE_COST / 2)),
    );
    expect(computeAssignMoraleCost('complex', 'ai', 0)).toBe(ASSIGN_MORALE_COST);
    expect(computeAssignMoraleCost('complex', 'ai', 2)).toBe(ASSIGN_MORALE_COST + 2);
  });
});

describe('resolve / canMove', () => {
  it('target 省略時は Coding の complex 優先', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [
      makeTask(0, { kind: 'normal' }),
      makeTask(1, { kind: 'complex' }),
    ]);
    expect(resolveAssignTaskTarget(sprint)?.id).toBe(1);
  });

  it('target 指定時は backlog/coding のみ', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [
      makeTask(0, { lane: 'review' }),
      makeTask(1, { lane: 'backlog' }),
    ]);
    expect(resolveAssignTaskTarget(sprint, { taskId: 0 })).toBeUndefined();
    expect(resolveAssignTaskTarget(sprint, { taskId: 1 })?.id).toBe(1);
  });

  it('WIP 満杯時は backlog→coding 不可', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [
      makeTask(0, { lane: 'backlog' }),
      ...Array.from({ length: sprintSlots(org) }, (_, i) => makeTask(i + 1, { lane: 'coding' })),
    ]);
    const backlog = sprint.tasks[0]!;
    expect(canMoveToLane(sprint, backlog, 'coding')).toBe(false);
  });

  it('同一レーンは許可し、不正レーン・review 移動・非対象レーンからの移動は拒否する', () => {
    const org = createOrgState('default', true);
    const coding = makeTask(0, { lane: 'coding' });
    const backlog = makeTask(1, { lane: 'backlog' });
    const review = makeTask(2, { lane: 'review' });
    const done = makeTask(3, { lane: 'done' });
    const sprint = makeSprint(org, [coding, backlog, review, done]);

    expect(canMoveToLane(sprint, coding, 'coding')).toBe(true);
    expect(canMoveToLane(sprint, backlog, 'coding')).toBe(true);
    expect(canMoveToLane(sprint, coding, 'done')).toBe(false);
    expect(canMoveToLane(sprint, coding, 'review')).toBe(false);
    expect(canMoveToLane(sprint, review, 'coding')).toBe(false);
    expect(canMoveToLane(sprint, done, 'coding')).toBe(false);
  });
});

function sprintSlots(org: OrgState): number {
  return createSprint(resolveSprintConfig('default'), org, rng).config.codingSlots;
}

describe('applyAssignTaskEffect / applyAction', () => {
  it('理想差配は低コスト、ミスマッチは高コスト', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [makeTask(0, { kind: 'routine', lane: 'coding' })]);
    const ideal = applyAssignTaskEffect(sprint, org, {
      taskId: 0,
      assignee: 'ai',
    });
    expect(ideal).not.toBe(false);
    if (ideal) {
      expect(ideal.moraleCost).toBe(Math.max(1, Math.floor(ASSIGN_MORALE_COST / 2)));
    }
  });

  it('target 付き applyAction は指定タスクを進める', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [
      makeTask(0, { lane: 'coding', progress: 0.1 }),
      makeTask(1, { lane: 'coding', progress: 0.1, kind: 'complex' }),
    ]);
    const outcome = applyAction('assignTask', sprint, org, rng, 0, { taskId: 0 });
    expect(outcome.ok).toBe(true);
    expect(outcome.effect?.affectedTaskIds).toEqual([0]);
    expect(sprint.tasks[0]!.progress).toBeGreaterThan(0.1);
  });

  it('target 省略は後方互換の自動選択', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [
      makeTask(0, { lane: 'coding', kind: 'normal' }),
      makeTask(1, { lane: 'coding', kind: 'complex' }),
    ]);
    const outcome = applyAction('assignTask', sprint, org, rng, 0);
    expect(outcome.ok).toBe(true);
    expect(outcome.effect?.affectedTaskIds).toEqual([1]);
  });

  it('assignableTasks は Coding と上げられる Backlog のみ', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [
      makeTask(0, { lane: 'backlog' }),
      makeTask(1, { lane: 'coding' }),
      makeTask(2, { lane: 'review' }),
    ]);
    expect(assignableTasks(sprint).map((t) => t.id)).toEqual([0, 1]);
  });

  it('Coding WIP 満杯時は Backlog を差配対象にしない', () => {
    const org = createOrgState('default', true);
    const slots = sprintSlots(org);
    const sprint = makeSprint(org, [
      makeTask(0, { lane: 'backlog' }),
      ...Array.from({ length: slots }, (_, i) => makeTask(i + 1, { lane: 'coding' })),
    ]);
    expect(assignableTasks(sprint).every((t) => t.lane === 'coding')).toBe(true);
    expect(assignableTasks(sprint).some((t) => t.id === 0)).toBe(false);
  });

  it('target 省略の splitPr は同格なら Review を Coding より優先する', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [
      makeTask(0, { lane: 'coding', kind: 'normal' }),
      makeTask(1, { lane: 'review', kind: 'normal' }),
    ]);
    expect(resolveSplitPrTarget(sprint)?.id).toBe(1);

    const bothComplex = makeSprint(org, [
      makeTask(0, { lane: 'coding', kind: 'complex' }),
      makeTask(1, { lane: 'review', kind: 'complex' }),
    ]);
    expect(resolveSplitPrTarget(bothComplex)?.id).toBe(1);
  });

  it('target 指定の splitPr は存在・未分割・Review/Coding の条件を満たすタスクだけ返す', () => {
    const org = createOrgState('default', true);
    const coding = makeTask(0, { lane: 'coding', split: false });
    const review = makeTask(1, { lane: 'review', split: false });
    const split = makeTask(2, { lane: 'review', split: true });
    const rework = makeTask(3, { lane: 'rework', split: false });
    const sprint = makeSprint(org, [coding, review, split, rework]);

    expect(resolveSplitPrTarget(sprint, { taskId: 99 })).toBeUndefined();
    expect(resolveSplitPrTarget(sprint, { taskId: 2 })).toBeUndefined();
    expect(resolveSplitPrTarget(sprint, { taskId: 3 })).toBeUndefined();
    expect(resolveSplitPrTarget(sprint, { taskId: 0 })).toBe(coding);
    expect(resolveSplitPrTarget(sprint, { taskId: 1 })).toBe(review);
  });

  it('AI 無効時の明示 AI 指定は失敗しレーンを動かさない', () => {
    const org = createOrgState('default', false);
    const sprint = makeSprint(org, [makeTask(0, { lane: 'backlog', kind: 'routine' })]);
    expect(applyAssignTaskEffect(sprint, org, { taskId: 0, lane: 'coding', assignee: 'ai' })).toBe(
      false,
    );
    expect(sprint.tasks[0]!.lane).toBe('backlog');
  });

  it('defaultAssignee は kind に従う', () => {
    const org = createOrgState('default', true);
    const aiDisabled = createOrgState('default', false);
    expect(defaultAssignee(makeTask(0, { kind: 'routine' }), org)).toBe('ai');
    expect(defaultAssignee(makeTask(0, { kind: 'routine' }), aiDisabled)).toBe('senior');
    expect(defaultAssignee(makeTask(0, { kind: 'complex' }), org)).toBe('senior');
    expect(defaultAssignee(makeTask(0, { kind: 'normal', aiAssisted: true }), org)).toBe('ai');
    expect(defaultAssignee(makeTask(0, { kind: 'normal', aiAssisted: true }), aiDisabled)).toBe(
      'senior',
    );
    expect(defaultAssignee(makeTask(0, { kind: 'normal', aiAssisted: false }), org)).toBe('senior');
  });

  it('Backlog ドロップは拒否し、Backlog タスクは Coding へ上げて加速する', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [makeTask(0, { lane: 'backlog', progress: 0 })]);
    expect(applyAssignTaskEffect(sprint, org, { taskId: 0, lane: 'backlog' })).toBe(false);
    const ok = applyAssignTaskEffect(sprint, org, { taskId: 0, assignee: 'senior' });
    expect(ok).not.toBe(false);
    expect(sprint.tasks[0]!.lane).toBe('coding');
    expect(sprint.tasks[0]!.progress).toBe(ASSIGN_PROGRESS);
  });

  it('明示レーン移動は Coding への移動だけ成功し、失敗時はレーンを保持する', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [makeTask(0, { lane: 'backlog', progress: 0.2 })]);

    const moved = applyAssignTaskEffect(sprint, org, {
      taskId: 0,
      lane: 'coding',
      assignee: 'senior',
    });
    expect(moved).toEqual({ affectedTaskIds: [0], moraleCost: 1 });
    expect(sprint.tasks[0]!.lane).toBe('coding');
    expect(sprint.tasks[0]!.progress).toBeCloseTo(0.2 + ASSIGN_PROGRESS);

    const rejected = makeSprint(org, [makeTask(1, { lane: 'coding' })]);
    expect(applyAssignTaskEffect(rejected, org, { taskId: 1, lane: 'review' })).toBe(false);
    expect(rejected.tasks[0]!.lane).toBe('coding');
  });

  it('Coding WIP 満杯では Backlog 自動引き上げも失敗する', () => {
    const org = createOrgState('default', true);
    const slots = sprintSlots(org);
    const sprint = makeSprint(org, [
      makeTask(0, { lane: 'backlog', progress: 0 }),
      ...Array.from({ length: slots }, (_, i) => makeTask(i + 1, { lane: 'coding' })),
    ]);

    expect(applyAssignTaskEffect(sprint, org, { taskId: 0, assignee: 'senior' })).toBe(false);
    expect(sprint.tasks[0]!.lane).toBe('backlog');
    expect(sprint.tasks[0]!.progress).toBe(0);
  });

  it('AI 割当への切替で依存度が上がる', () => {
    const org = createOrgState('default', true);
    const before = org.aiDependency;
    const sprint = makeSprint(org, [
      makeTask(0, { lane: 'coding', kind: 'routine', aiAssisted: false }),
    ]);
    applyAssignTaskEffect(sprint, org, { taskId: 0, assignee: 'ai' });
    expect(org.aiDependency).toBeGreaterThan(before);
    expect(sprint.tasks[0]!.aiAssisted).toBe(true);
  });

  it('AI 割当済みの維持では依存度を増やさず、senior 指定では AI 支援を外す', () => {
    const org = createOrgState('default', true);
    org.aiDependency = 40;
    const sprint = makeSprint(org, [
      makeTask(0, { lane: 'coding', kind: 'routine', aiAssisted: true }),
      makeTask(1, { lane: 'coding', kind: 'normal', aiAssisted: true }),
    ]);

    expect(applyAssignTaskEffect(sprint, org, { taskId: 0, assignee: 'ai' })).not.toBe(false);
    expect(org.aiDependency).toBe(40);
    expect(sprint.tasks[0]!.aiAssisted).toBe(true);

    expect(applyAssignTaskEffect(sprint, org, { taskId: 1, assignee: 'senior' })).not.toBe(false);
    expect(org.aiDependency).toBe(40);
    expect(sprint.tasks[1]!.aiAssisted).toBe(false);
  });

  it('AI 無効時は既定担当が senior になり、ミスマッチ streak は増減する', () => {
    const org = createOrgState('default', false);
    org.morale = 10;
    const sprint = makeSprint(org, [
      makeTask(0, { lane: 'coding', kind: 'routine' }),
      makeTask(1, { lane: 'coding', kind: 'complex' }),
      makeTask(2, { lane: 'coding', kind: 'complex' }),
    ]);
    sprint.metrics.assignmentSkew = { mismatchStreak: 2 };

    const mismatch = applyAssignTaskEffect(sprint, org, { taskId: 0 });
    expect(mismatch).toEqual({ affectedTaskIds: [0], moraleCost: ASSIGN_MORALE_COST + 2 });
    expect(sprint.metrics.assignmentSkew).toEqual({ mismatchStreak: 3 });

    const ideal = applyAssignTaskEffect(sprint, org, { taskId: 1, assignee: 'senior' });
    expect(ideal).toEqual({
      affectedTaskIds: [1],
      moraleCost: Math.max(1, Math.floor(ASSIGN_MORALE_COST / 2)),
    });
    expect(sprint.metrics.assignmentSkew).toEqual({ mismatchStreak: 0 });

    org.morale = 1;
    const clamped = applyAssignTaskEffect(sprint, org, { taskId: 2, assignee: 'senior' });
    expect(clamped).toEqual({ affectedTaskIds: [2], moraleCost: 1 });
    expect(org.morale).toBe(0);
  });
});

/**
 * codingCount < slots かつ tasks.length >= slots の混在盤面。
 * filter を外す MethodExpression（codingCount = tasks.length）だと WIP 満杯扱いになり殺せる。
 */
function mixedNearCapacity(org: OrgState): {
  sprint: SprintState;
  backlog: Task;
  slots: number;
} {
  const slots = sprintSlots(org);
  expect(slots).toBeGreaterThanOrEqual(2);
  // Coding 1 + Backlog (slots - 1) = slots
  const backlog = makeTask(0, { lane: 'backlog' });
  const coding = makeTask(1, { lane: 'coding' });
  const extraBacklog = Array.from({ length: slots - 2 }, (_, i) =>
    makeTask(i + 2, { lane: 'backlog' }),
  );
  const sprint = makeSprint(org, [backlog, coding, ...extraBacklog]);
  return { sprint, backlog: sprint.tasks[0]!, slots };
}

describe('RI-91-B6 assignTask survived mutants', () => {
  describe('computeAssignMoraleCost exact', () => {
    it('理想差配は半減のリテラル 1（routine/ai・complex/senior）', () => {
      expect(ASSIGN_MORALE_COST).toBe(3);
      expect(computeAssignMoraleCost('routine', 'ai', 0)).toBe(1);
      expect(computeAssignMoraleCost('complex', 'senior', 0)).toBe(1);
      // streak は理想時に無視される。
      expect(computeAssignMoraleCost('routine', 'ai', 9)).toBe(1);
    });

    it.each([
      { streak: 0, expected: 3 },
      { streak: 1, expected: 4 },
      { streak: 2, expected: 5 },
      { streak: 3, expected: 6 },
      { streak: 4, expected: 6 },
      { streak: 10, expected: 6 },
    ])('ミスマッチはフル+$streak → $expected（cap 3）', ({ streak, expected }) => {
      expect(ASSIGN_MORALE_COST).toBe(3);
      expect(computeAssignMoraleCost('complex', 'ai', streak)).toBe(expected);
      expect(computeAssignMoraleCost('routine', 'senior', streak)).toBe(expected);
    });
  });

  describe('assignableTasks / canMoveToLane filter MethodExpression', () => {
    it('空 tasks では差配対象も WIP カウントも 0', () => {
      const org = createOrgState('default', true);
      const sprint = makeSprint(org, []);
      expect(assignableTasks(sprint)).toEqual([]);
      expect(sprint.tasks.filter((t) => t.lane === 'coding')).toHaveLength(0);
    });

    it('coding 未満・総数=slots の混在では Backlog を上げられる', () => {
      const org = createOrgState('default', true);
      const { sprint, backlog, slots } = mixedNearCapacity(org);
      const codingCount = sprint.tasks.filter((t) => t.lane === 'coding').length;
      expect(codingCount).toBe(1);
      expect(sprint.tasks).toHaveLength(slots);
      expect(codingCount).toBeLessThan(slots);
      expect(sprint.tasks.length).toBeGreaterThanOrEqual(slots);

      const ids = assignableTasks(sprint).map((t) => t.id);
      expect(ids).toContain(backlog.id);
      expect(ids).toContain(1);
      expect(canMoveToLane(sprint, backlog, 'coding')).toBe(true);
    });

    it('coding 0・Backlog だけで slots 以上でも引き上げ可（filter 無しは拒否）', () => {
      const org = createOrgState('default', true);
      const slots = sprintSlots(org);
      const sprint = makeSprint(
        org,
        Array.from({ length: slots }, (_, i) => makeTask(i, { lane: 'backlog' })),
      );
      expect(sprint.tasks.filter((t) => t.lane === 'coding')).toHaveLength(0);
      expect(sprint.tasks).toHaveLength(slots);

      const assignable = assignableTasks(sprint);
      expect(assignable).toHaveLength(slots);
      expect(assignable.every((t) => t.lane === 'backlog')).toBe(true);
      expect(canMoveToLane(sprint, sprint.tasks[0]!, 'coding')).toBe(true);
    });

    it('Coding WIP 満杯では Backlog を上げられない', () => {
      const org = createOrgState('default', true);
      const slots = sprintSlots(org);
      const backlog = makeTask(0, { lane: 'backlog' });
      const sprint = makeSprint(org, [
        backlog,
        ...Array.from({ length: slots }, (_, i) => makeTask(i + 1, { lane: 'coding' })),
      ]);

      expect(assignableTasks(sprint).map((t) => t.id)).not.toContain(0);
      expect(assignableTasks(sprint).every((t) => t.lane === 'coding')).toBe(true);
      expect(canMoveToLane(sprint, backlog, 'coding')).toBe(false);
    });
  });
});

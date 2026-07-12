/**
 * タスク差配の純関数テスト（RI-30）。
 */
import { describe, expect, it } from 'vitest';
import { applyAction, ASSIGN_MORALE_COST } from '../../src/sim/actions';
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
    expect(defaultAssignee(makeTask(0, { kind: 'routine' }), org)).toBe('ai');
    expect(defaultAssignee(makeTask(0, { kind: 'complex' }), org)).toBe('senior');
  });

  it('Backlog ドロップは拒否し、Backlog タスクは Coding へ上げて加速する', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [makeTask(0, { lane: 'backlog', progress: 0 })]);
    expect(applyAssignTaskEffect(sprint, org, { taskId: 0, lane: 'backlog' })).toBe(false);
    const ok = applyAssignTaskEffect(sprint, org, { taskId: 0, assignee: 'senior' });
    expect(ok).not.toBe(false);
    expect(sprint.tasks[0]!.lane).toBe('coding');
    expect(sprint.tasks[0]!.progress).toBeGreaterThan(0);
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
});

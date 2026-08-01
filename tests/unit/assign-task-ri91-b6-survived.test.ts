/**
 * RI-91-B6: src/sim/assignTask.ts の Survived mutation を潰す。
 * 共有の assignTask.test.ts は触らず、単位専用ファイルで exact 断言する。
 */
import { describe, expect, it } from 'vitest';
import { ASSIGN_MORALE_COST } from '../../src/sim/actions';
import { assignableTasks, canMoveToLane, computeAssignMoraleCost } from '../../src/sim/assignTask';
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

function sprintSlots(org: OrgState): number {
  return createSprint(resolveSprintConfig('default'), org, rng).config.codingSlots;
}

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

/**
 * 盤面ドラッグ計画のテスト（RI-30）。
 */
import { describe, expect, it } from 'vitest';
import { hitTestDropLane, planBoardDrag } from '../../src/render/boardDragPlan';
import { createOrgState } from '../../src/sim/org';
import { createSprint, resolveSprintConfig } from '../../src/sim/sprint';
import type { Task } from '../../src/sim/types';

const rng = () => 0.5;

const makeTask = (id: number, overrides: Partial<Task> = {}): Task => ({
  id,
  kind: 'normal',
  highValue: false,
  aiAssisted: false,
  lane: 'coding',
  progress: 0,
  reworkAttempts: 0,
  wasReworked: false,
  incident: false,
  debt: false,
  ...overrides,
});

describe('planBoardDrag', () => {
  it('assignTask は backlog/coding をドラッグ可能にする', () => {
    const org = createOrgState('default', true);
    const sprint = createSprint(resolveSprintConfig('default'), org, rng);
    sprint.tasks = [
      makeTask(0, { lane: 'backlog' }),
      makeTask(1, { lane: 'coding' }),
      makeTask(2, { lane: 'review' }),
    ];
    const plan = planBoardDrag(sprint, 'assignTask');
    expect(plan?.draggableTaskIds).toEqual([0, 1]);
    expect(plan?.dropLanes).toEqual(['coding']);
  });

  it('splitPr は未 split の review/coding を対象にする', () => {
    const org = createOrgState('default', true);
    const sprint = createSprint(resolveSprintConfig('default'), org, rng);
    sprint.tasks = [
      makeTask(0, { lane: 'coding', split: true }),
      makeTask(1, { lane: 'review' }),
      makeTask(2, { lane: 'backlog' }),
    ];
    const plan = planBoardDrag(sprint, 'splitPr');
    expect(plan?.draggableTaskIds).toEqual([1]);
  });

  it('assignTask 計画に担当指定を載せられる', () => {
    const org = createOrgState('default', true);
    const sprint = createSprint(resolveSprintConfig('default'), org, rng);
    sprint.tasks = [makeTask(0, { lane: 'coding' })];
    const plan = planBoardDrag(sprint, 'assignTask', 'senior');
    expect(plan?.assignee).toBe('senior');
  });

  it('対象なしなら null', () => {
    const org = createOrgState('default', true);
    const sprint = createSprint(resolveSprintConfig('default'), org, rng);
    sprint.tasks = [makeTask(0, { lane: 'done' })];
    expect(planBoardDrag(sprint, 'assignTask')).toBeNull();
  });

  it('山の overflow に隠れた候補だけでは null（自動対象フォールバック用）', () => {
    const org = createOrgState('default', true);
    const sprint = createSprint(resolveSprintConfig('default'), org, rng);
    // Coding cap=12。13 件目以降は +N に隠れ、描画粒が無い。
    sprint.tasks = Array.from({ length: 13 }, (_, i) =>
      makeTask(i, { lane: 'coding', split: false, progress: 0 }),
    );
    const plan = planBoardDrag(sprint, 'splitPr');
    // 可視粒だけが対象。先頭 12 は見えるので null ではないが、隠れた ID は含まない。
    expect(plan).not.toBeNull();
    expect(plan!.draggableTaskIds).not.toContain(12);
    expect(plan!.draggableTaskIds.length).toBeLessThanOrEqual(12);

    // 可視をすべて split 済みにすると、残りは overflow だけ → null。
    for (const id of plan!.draggableTaskIds) {
      sprint.tasks.find((t) => t.id === id)!.split = true;
    }
    expect(planBoardDrag(sprint, 'splitPr')).toBeNull();
  });
});

describe('hitTestDropLane', () => {
  it('coding ステーション近傍をヒットする', () => {
    expect(hitTestDropLane(622, 251, ['backlog', 'coding'])).toBe('coding');
    expect(hitTestDropLane(0, 0, ['backlog', 'coding'])).toBeNull();
  });
});

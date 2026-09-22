import { describe, expect, it } from 'vitest';
import { planActionTargetPickerView } from '../../../src/render/actionTargetPickerView';
import { createOrgState } from '../../../src/sim/org';
import { makeSprint, makeTask } from '../helpers/sprintFixtures';

describe('planActionTargetPickerView（RI-146）', () => {
  it('差配候補は Backlog/Coding を含め、確定 target は coding レーンになる', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [
      makeTask(1, { lane: 'coding', kind: 'complex' }),
      makeTask(2, { lane: 'backlog', kind: 'routine' }),
      makeTask(3, { lane: 'review', kind: 'normal' }),
    ]);

    const view = planActionTargetPickerView(sprint, org, 'assignTask');
    expect(view?.title).toBe('差配するタスクを選ぶ');
    expect(view?.options.map((o) => o.taskId)).toEqual([1, 2]);
    expect(view?.options[0]).toMatchObject({
      label: 'タスク #1',
      detail: '実装・複雑',
      canSelect: true,
      target: { taskId: 1, lane: 'coding' },
    });
    expect(view?.options[1]).toMatchObject({
      detail: '待機・定型',
      target: { taskId: 2, lane: 'coding' },
    });
  });

  it('担当 AI 指定を target に載せ、AI無効時は選択不可にする', () => {
    const org = createOrgState('default', false);
    const sprint = makeSprint(org, [makeTask(4, { lane: 'coding', kind: 'routine' })]);
    sprint.focus = 6;

    const enabled = planActionTargetPickerView(
      sprint,
      createOrgState('default', true),
      'assignTask',
      { assignee: 'ai' },
    );
    expect(enabled?.options[0]?.target).toEqual({ taskId: 4, lane: 'coding', assignee: 'ai' });
    expect(enabled?.options[0]?.canSelect).toBe(true);

    const disabled = planActionTargetPickerView(sprint, org, 'assignTask', { assignee: 'ai' });
    expect(disabled?.options[0]).toMatchObject({
      canSelect: false,
      blockMessage: 'AI無効',
      target: { taskId: 4, lane: 'coding', assignee: 'ai' },
    });
  });

  it('PR分割は Review→Coding の候補順で、一時停止・集中力不足を理由表示する', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [
      makeTask(10, { lane: 'coding', kind: 'normal', split: false }),
      makeTask(11, { lane: 'review', kind: 'complex', split: false }),
      makeTask(12, { lane: 'review', kind: 'normal', split: true }),
    ]);
    sprint.focus = 6;

    const view = planActionTargetPickerView(sprint, org, 'splitPr');
    expect(view?.title).toBe('分割するPRを選ぶ');
    expect(view?.options.map((o) => o.taskId)).toEqual([11, 10]);
    expect(view?.options[0]?.target).toEqual({ taskId: 11 });

    const paused = planActionTargetPickerView(sprint, org, 'splitPr', { paused: true });
    expect(paused?.options.every((o) => o.canSelect === false)).toBe(true);
    expect(paused?.options[0]?.blockMessage).toBe('一時停止中');

    sprint.focus = 0;
    const noFocus = planActionTargetPickerView(sprint, org, 'splitPr');
    expect(noFocus?.options[0]).toMatchObject({
      canSelect: false,
      blockMessage: '集中力不足',
    });
  });

  it('候補が無いときは null を返す', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [makeTask(1, { lane: 'done' })]);
    expect(planActionTargetPickerView(sprint, org, 'assignTask')).toBeNull();
    expect(planActionTargetPickerView(sprint, org, 'splitPr')).toBeNull();
  });
});

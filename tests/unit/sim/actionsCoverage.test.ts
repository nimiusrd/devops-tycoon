import { describe, expect, it } from 'vitest';
import {
  FIREFIGHT_STABILITY_BURN_TICKS,
  hasActionTarget,
  isFirefightUrgent,
  mostUrgentIncident,
} from '../../../src/sim/actions';
import { createOrgState } from '../../../src/sim/org';
import { burningTask, makeSprint, makeTask } from '../helpers/sprintFixtures';

describe('緊急対応の必要性の読み取り', () => {
  it('炎上がない盤面では通常の手戻りを緊急対応の対象にしない', () => {
    const sprint = makeSprint(createOrgState(), [makeTask(1, { lane: 'rework' })]);

    expect(isFirefightUrgent(sprint)).toBe(false);
    expect(mostUrgentIncident(sprint)).toBeUndefined();
  });

  it('タイマーのない単発炎上を延焼間近とはみなさず、期限のある火を先に選ぶ', () => {
    const untimed = makeTask(1, { lane: 'rework', incident: true });
    const sprint = makeSprint(createOrgState(), [untimed]);

    expect(isFirefightUrgent(sprint)).toBe(false);
    expect(mostUrgentIncident(sprint)).toBe(untimed);

    const timed = burningTask(2, FIREFIGHT_STABILITY_BURN_TICKS);
    sprint.tasks.push(timed);
    expect(mostUrgentIncident(sprint)).toBe(timed);
    expect(isFirefightUrgent(sprint)).toBe(true);
  });
});

describe('介入対象の組織情報が不足している場合', () => {
  it('明示した差配先は組織情報なしでは承認せず、読み取り時に盤面を変更しない', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [makeTask(1, { lane: 'coding', kind: 'routine' })]);
    const target = { taskId: 1, assignee: 'ai' as const };
    const before = structuredClone({ sprint, org });

    expect(hasActionTarget('assignTask', sprint, target)).toBe(false);
    expect(hasActionTarget('assignTask', sprint, target, org)).toBe(true);
    expect({ sprint, org }).toEqual(before);
  });

  it('組織情報があっても AI が無効なら AI 差配を拒否し、シニア差配は認める', () => {
    const org = createOrgState('default', false);
    const sprint = makeSprint(org, [makeTask(1, { lane: 'coding' })]);
    const before = structuredClone({ sprint, org });

    expect(hasActionTarget('assignTask', sprint, { taskId: 1, assignee: 'ai' }, org)).toBe(false);
    expect(hasActionTarget('assignTask', sprint, { taskId: 1, assignee: 'senior' }, org)).toBe(
      true,
    );
    expect({ sprint, org }).toEqual(before);
  });

  it('自動選択の候補表示は組織情報を要求せず、差配可能なタスクの有無を返す', () => {
    const org = createOrgState();
    const sprint = makeSprint(org, [makeTask(1, { lane: 'backlog' })]);

    expect(hasActionTarget('assignTask', sprint)).toBe(true);
    sprint.tasks[0].lane = 'review';
    expect(hasActionTarget('assignTask', sprint)).toBe(false);
  });
});

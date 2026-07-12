import { describe, expect, it } from 'vitest';
import { BURN_TICKS } from '../../src/sim/model';
import { createOrgState } from '../../src/sim/org';
import { createSprint, resolveSprintConfig } from '../../src/sim/sprint';
import type { ActionId, OrgState, SprintState, Task } from '../../src/sim/types';
import {
  countActionTargets,
  deriveActionAvailability,
  formatInterventionFailure,
  planActionBarView,
} from '../../src/render/actionBarView';

const rng = () => 0.99;

const makeTask = (id: number, overrides: Partial<Task> = {}): Task => ({
  id,
  kind: 'normal',
  highValue: false,
  aiAssisted: false,
  lane: 'review',
  progress: 0,
  reworkAttempts: 0,
  wasReworked: false,
  incident: false,
  debt: false,
  ...overrides,
});

const burningTask = (id: number, burnTicksLeft = BURN_TICKS): Task =>
  makeTask(id, { lane: 'rework', incident: true, burnTicksLeft, reworkAttempts: 1 });

function makeSprint(org: OrgState, tasks: Task[]): SprintState {
  const sprint = createSprint(resolveSprintConfig('default'), org, rng);
  sprint.tasks = tasks;
  return sprint;
}

/** actions.test.ts の NO_TARGET_CASES と整合する fixture。 */
const NO_TARGET_CASES: { id: ActionId; tasks: Task[]; message: string }[] = [
  { id: 'interruptReview', tasks: [], message: 'Review が空' },
  {
    id: 'splitPr',
    tasks: [makeTask(0, { split: true, lane: 'coding' })],
    message: '分割対象なし',
  },
  { id: 'firefight', tasks: [makeTask(0, { lane: 'review' })], message: '炎上なし' },
  { id: 'assignTask', tasks: [makeTask(0, { lane: 'review' })], message: '差配対象なし' },
];

describe('countActionTargets（RI-51）', () => {
  it('interruptReview は Review 件数を上限 4 でカウントする', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(
      org,
      Array.from({ length: 6 }, (_, i) => makeTask(i)),
    );
    expect(countActionTargets(sprint, 'interruptReview')).toBe(4);
  });

  it('firefight は炎上件数を返す', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [burningTask(0), burningTask(1), makeTask(2)]);
    expect(countActionTargets(sprint, 'firefight')).toBe(2);
  });

  it('splitPr は未 split 候補数を返す', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [
      makeTask(0, { lane: 'coding', split: true }),
      makeTask(1, { lane: 'review' }),
      makeTask(2, { lane: 'coding' }),
    ]);
    expect(countActionTargets(sprint, 'splitPr')).toBe(2);
  });

  it('assignTask は backlog/coding の件数を返し、それ以外は 0', () => {
    const org = createOrgState('default', true);
    expect(
      countActionTargets(makeSprint(org, [makeTask(0, { lane: 'coding' })]), 'assignTask'),
    ).toBe(1);
    expect(
      countActionTargets(
        makeSprint(org, [makeTask(0, { lane: 'backlog' }), makeTask(1, { lane: 'coding' })]),
        'assignTask',
      ),
    ).toBe(2);
    expect(
      countActionTargets(makeSprint(org, [makeTask(0, { lane: 'review' })]), 'assignTask'),
    ).toBe(0);
  });

  it('pairReview は Review 件数を上限 2 でカウントする', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [makeTask(0), makeTask(1), makeTask(2)]);
    expect(countActionTargets(sprint, 'pairReview')).toBe(2);
  });

  it('常時発動系は 0 を返す', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, []);
    for (const id of ['aiThrottle', 'overtime', 'andon'] as const) {
      expect(countActionTargets(sprint, id)).toBe(0);
    }
  });
});

describe('deriveActionAvailability（RI-51）', () => {
  it.each(NO_TARGET_CASES)(
    '$id は対象なしで no-target かつ理由を返す',
    ({ id, tasks, message }) => {
      const org = createOrgState('default', true);
      const sprint = makeSprint(org, tasks);
      const availability = deriveActionAvailability(sprint, id);
      expect(availability.canActivate).toBe(false);
      expect(availability.blockReason).toBe('no-target');
      expect(availability.blockMessage).toBe(message);
    },
  );

  it('pairReview は Review 0 件でも発動可能', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, []);
    const availability = deriveActionAvailability(sprint, 'pairReview');
    expect(availability.canActivate).toBe(true);
    expect(availability.targetBadge).toBe('PR 0');
  });

  it('常時発動系は対象不要で発動可能', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, []);
    for (const id of ['aiThrottle', 'overtime', 'andon'] as const) {
      const availability = deriveActionAvailability(sprint, id);
      expect(availability.canActivate).toBe(true);
      expect(availability.targetBadge).toBeUndefined();
    }
  });

  it('クールダウン中は cooldown で無効', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [makeTask(0)]);
    sprint.cooldowns.interruptReview = 10;
    const availability = deriveActionAvailability(sprint, 'interruptReview');
    expect(availability.canActivate).toBe(false);
    expect(availability.blockReason).toBe('cooldown');
  });

  it('集中力不足は no-focus で無効', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [makeTask(0)]);
    sprint.focus = 1;
    const availability = deriveActionAvailability(sprint, 'interruptReview');
    expect(availability.canActivate).toBe(false);
    expect(availability.blockReason).toBe('no-focus');
  });

  it('対象ありの interruptReview はバッジと canActivate を返す', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [makeTask(0), makeTask(1), makeTask(2)]);
    const availability = deriveActionAvailability(sprint, 'interruptReview');
    expect(availability.canActivate).toBe(true);
    expect(availability.targetBadge).toBe('PR 3');
  });

  it('firefight は炎上バッジを返す', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [burningTask(0), burningTask(1)]);
    const availability = deriveActionAvailability(sprint, 'firefight');
    expect(availability.canActivate).toBe(true);
    expect(availability.targetBadge).toBe('🔥2');
  });

  it('disabled 時は complete で無効', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [makeTask(0)]);
    const availability = deriveActionAvailability(sprint, 'interruptReview', true);
    expect(availability.canActivate).toBe(false);
    expect(availability.blockReason).toBe('complete');
  });
});

describe('planActionBarView（RI-51）', () => {
  it('8 アクション分の利用可否を返す', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [makeTask(0)]);
    const plan = planActionBarView(sprint);
    expect(plan).toHaveLength(8);
    expect(plan.map((p) => p.actionId)).toEqual([
      'interruptReview',
      'splitPr',
      'firefight',
      'assignTask',
      'aiThrottle',
      'pairReview',
      'overtime',
      'andon',
    ]);
  });
});

describe('formatInterventionFailure（RI-51）', () => {
  it('no-target はアクション別の短文を返す', () => {
    expect(formatInterventionFailure('no-target', 'firefight')).toBe('炎上なし');
  });

  it('その他の理由は汎用文言を返す', () => {
    expect(formatInterventionFailure('cooldown')).toBe('クールダウン中');
  });
});

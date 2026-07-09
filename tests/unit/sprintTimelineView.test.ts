import { describe, expect, it } from 'vitest';
import {
  extractInterventionMarkers,
  planSprintTimeline,
} from '../../src/render/sprintTimelineView';
import { applyAction } from '../../src/sim/actions';
import { createOrgState } from '../../src/sim/org';
import {
  createSprint,
  resolveSprintConfig,
  stepSprint,
  summarizeSprint,
} from '../../src/sim/sprint';
import type { OrgState, SprintEvent, SprintState, Task, TimelineSample } from '../../src/sim/types';

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

function makeSprint(org: OrgState, tasks: Task[]): SprintState {
  const sprint = createSprint(resolveSprintConfig('default'), org, () => 0.5);
  sprint.tasks = tasks;
  return sprint;
}

describe('sprintTimelineView（RI-53）', () => {
  const samples: TimelineSample[] = [
    { tick: 0, reviewQueue: 2, burningCount: 0, combo: 0, seniorHp: 80 },
    { tick: 5, reviewQueue: 6, burningCount: 1, combo: 2, seniorHp: 70 },
    { tick: 10, reviewQueue: 3, burningCount: 0, combo: 4, seniorHp: 65 },
  ];

  const events: SprintEvent[] = [
    {
      tick: 5,
      kind: 'intervention',
      combo: 2,
      effect: {
        actionId: 'interruptReview',
        focusCost: 3,
        gaugeGain: 0.34,
        reviewedCount: 4,
        hpCost: 3,
      },
    },
  ];

  it('空タイムラインは empty を返す', () => {
    const view = planSprintTimeline([], []);
    expect(view.empty).toBe(true);
    expect(view.series).toHaveLength(0);
    expect(view.markers).toHaveLength(0);
  });

  it('4 系列の path と介入マーカーを導出する', () => {
    const view = planSprintTimeline(samples, events);
    expect(view.empty).toBe(false);
    expect(view.series).toHaveLength(4);
    expect(view.series.every((s) => s.d.startsWith('M '))).toBe(true);
    expect(view.tickStart).toBe(0);
    expect(view.tickEnd).toBe(10);
    expect(view.markers).toHaveLength(1);
    expect(view.markers[0].actionId).toBe('interruptReview');
    expect(view.markers[0].x).toBeGreaterThan(0);
  });

  it('介入マーカーは timeline の tick 範囲に合わせて x を置く', () => {
    const markers = extractInterventionMarkers(events, samples, 320);
    expect(markers).toHaveLength(1);
    // tick 5 は 0..10 の中点 → pad.left + 0.5 * innerW
    expect(markers[0].x).toBeCloseTo(8 + 0.5 * (320 - 16), 5);
  });
});

describe('SprintState.timeline 記録（RI-53）', () => {
  it('createSprint は空の timeline で始まる', () => {
    const org = createOrgState('default', true);
    const sprint = createSprint(resolveSprintConfig('default'), org, () => 0.5);
    expect(sprint.timeline).toEqual([]);
  });

  it('stepSprint ごとに 1 サンプルを append する', () => {
    const org = createOrgState('default', false);
    const sprint = makeSprint(org, [makeTask(0, { lane: 'coding', progress: 0.9 })]);
    stepSprint(sprint, org, () => 0.99, 0);
    expect(sprint.timeline).toHaveLength(1);
    expect(sprint.timeline[0]).toMatchObject({
      tick: 0,
      reviewQueue: expect.any(Number),
      burningCount: expect.any(Number),
      combo: expect.any(Number),
      seniorHp: expect.any(Number),
    });
  });

  it('summarizeSprint が timeline と events をリザルトへコピーする', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [
      makeTask(0),
      makeTask(1),
      makeTask(2),
      makeTask(3),
      makeTask(4, { lane: 'done' }),
    ]);
    applyAction('interruptReview', sprint, org, () => 0.99, 3);
    stepSprint(sprint, org, () => 0.99, 3);
    // 残りを Done にして完了させる（リザルト集計用）。
    for (const t of sprint.tasks) {
      if (t.lane !== 'done') {
        t.lane = 'done';
        t.incident = false;
      }
    }
    sprint.complete = true;
    sprint.metrics.doneCount = sprint.tasks.length;

    const result = summarizeSprint(sprint, org);
    expect(result.timeline.length).toBeGreaterThan(0);
    expect(result.events.some((e) => e.kind === 'intervention')).toBe(true);
    // リザルトは interventionEvents 由来（ring buffer とは別参照）。
    expect(result.events).not.toBe(sprint.events);
    expect(result.events).not.toBe(sprint.interventionEvents);
  });
});

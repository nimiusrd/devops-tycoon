import { describe, expect, it } from 'vitest';
import { BURN_TICKS } from '../../src/sim/model';
import {
  createFireSnapshot,
  detectFireEvents,
  positionFireEffects,
  type FireSnapshot,
} from '../../src/render/fireEffects';
import type { Lane, SprintMetrics, Task } from '../../src/sim/types';

const baseMetrics = (): SprintMetrics => ({
  delivered: 0,
  doneCount: 0,
  reworkCount: 0,
  incidentCount: 0,
  contained: 0,
  spread: 0,
  aiAssistedCompleted: 0,
  completedCount: 0,
  reviewQueueMax: 0,
  combo: 0,
  maxCombo: 0,
  seniorHpStart: 80,
  interventionsUsed: 0,
  focusSpent: 0,
  actionCounts: {},
});

const snapTask = (
  id: number,
  lane: Lane,
  overrides: Partial<{ incident: boolean; debt: boolean; burnTicksLeft: number }> = {},
) => ({
  id,
  lane,
  incident: overrides.incident ?? false,
  debt: overrides.debt ?? false,
  burnTicksLeft: overrides.burnTicksLeft,
});

const snap = (
  tasks: ReturnType<typeof snapTask>[],
  metrics: Partial<SprintMetrics> = {},
): FireSnapshot => ({
  tasks,
  spread: metrics.spread ?? 0,
  contained: metrics.contained ?? 0,
  incidentCount: metrics.incidentCount ?? 0,
});

const makeTask = (id: number, lane: Lane, overrides: Partial<Task> = {}): Task => ({
  id,
  kind: 'normal',
  highValue: false,
  aiAssisted: false,
  lane,
  progress: 0,
  reworkAttempts: 0,
  wasReworked: false,
  incident: false,
  debt: false,
  ...overrides,
});

describe('detectFireEvents（RI-06）', () => {
  it('延焼で spread イベントを検出する', () => {
    const prev = snap(
      [snapTask(0, 'rework', { incident: true, burnTicksLeft: 1 }), snapTask(1, 'review')],
      { spread: 0, incidentCount: 1 },
    );
    const next = snap(
      [
        snapTask(0, 'rework', { debt: true }),
        snapTask(1, 'rework', { incident: true, burnTicksLeft: BURN_TICKS }),
      ],
      { spread: 1, incidentCount: 2 },
    );
    expect(detectFireEvents(prev, next)).toEqual([{ kind: 'spread', fromTaskId: 0, toTaskId: 1 }]);
  });

  it('Review 落ちの点火で ignite イベントを検出する', () => {
    const prev = snap([snapTask(0, 'review')], { incidentCount: 0 });
    const next = snap([snapTask(0, 'rework', { incident: true, burnTicksLeft: BURN_TICKS })], {
      incidentCount: 1,
    });
    expect(detectFireEvents(prev, next)).toEqual([{ kind: 'ignite', taskId: 0 }]);
  });

  it('緊急対応の鎮火で extinguish(firefight) を検出する', () => {
    const prev = snap([snapTask(0, 'rework', { incident: true, burnTicksLeft: 20 })], {
      contained: 0,
    });
    const next = snap([snapTask(0, 'review')], { contained: 1 });
    expect(detectFireEvents(prev, next)).toEqual([
      { kind: 'extinguish', taskId: 0, source: 'firefight' },
    ]);
  });

  it('自動鎮火で extinguish(auto) を検出する', () => {
    const prev = snap([snapTask(0, 'rework', { incident: true, burnTicksLeft: 1 })], {
      contained: 0,
    });
    const next = snap([snapTask(0, 'rework')], { contained: 1 });
    expect(detectFireEvents(prev, next)).toEqual([
      { kind: 'extinguish', taskId: 0, source: 'auto' },
    ]);
  });

  it('変化がなければ空配列', () => {
    const s = snap([snapTask(0, 'coding')]);
    expect(detectFireEvents(s, s)).toEqual([]);
  });
});

describe('createFireSnapshot / positionFireEffects', () => {
  it('スプリント状態からスナップショットを作れる', () => {
    const tasks = [makeTask(1, 'rework', { incident: true, burnTicksLeft: 10 })];
    const metrics = { ...baseMetrics(), spread: 2, contained: 1, incidentCount: 3 };
    const snap = createFireSnapshot(tasks, metrics);
    expect(snap.spread).toBe(2);
    expect(snap.tasks[0].incident).toBe(true);
  });

  it('spread イベントに座標を付与できる', () => {
    const tasks = [
      makeTask(0, 'rework', { debt: true }),
      makeTask(1, 'rework', { incident: true, burnTicksLeft: BURN_TICKS }),
    ];
    const positioned = positionFireEffects([{ kind: 'spread', fromTaskId: 0, toTaskId: 1 }], tasks);
    expect(positioned).toHaveLength(1);
    expect(positioned[0].kind).toBe('spread');
    if (positioned[0].kind === 'spread') {
      expect(positioned[0].fromX).toBeGreaterThan(0);
      expect(positioned[0].toX).toBeGreaterThan(0);
    }
  });
});

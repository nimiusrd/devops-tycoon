import { describe, expect, it } from 'vitest';
import { BURN_TICKS } from '../../src/sim/model';
import {
  createFireSnapshot,
  detectFireEvents,
  fireSnapshotsEqual,
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
  reviewAccumulator = 0,
): FireSnapshot => ({
  tasks,
  spread: metrics.spread ?? 0,
  contained: metrics.contained ?? 0,
  incidentCount: metrics.incidentCount ?? 0,
  reviewAccumulator,
  firefightCount: metrics.actionCounts?.firefight ?? 0,
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
      [
        snapTask(0, 'rework', { incident: true, burnTicksLeft: 1 }),
        snapTask(1, 'review'),
        snapTask(2, 'review'),
      ],
      { spread: 0, incidentCount: 1 },
    );
    const next = snap(
      [
        snapTask(0, 'rework', { debt: true }),
        snapTask(1, 'rework', { incident: true, burnTicksLeft: BURN_TICKS }),
        snapTask(2, 'review'),
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

  it('延焼と Review 落ちが同 tick でも ignite を残す', () => {
    const prev = snap(
      [
        snapTask(0, 'rework', { incident: true, burnTicksLeft: 1 }),
        snapTask(1, 'review'),
        snapTask(2, 'review'),
      ],
      { spread: 0, incidentCount: 1 },
    );
    const next = snap(
      [
        snapTask(0, 'rework', { debt: true }),
        snapTask(1, 'rework', { incident: true, burnTicksLeft: BURN_TICKS }),
        snapTask(2, 'rework', { incident: true, burnTicksLeft: BURN_TICKS }),
      ],
      { spread: 1, incidentCount: 3 },
    );
    expect(detectFireEvents(prev, next)).toEqual([
      { kind: 'spread', fromTaskId: 0, toTaskId: 2 },
      { kind: 'ignite', taskId: 1 },
    ]);
  });

  it('負債タスクの再炎上でも延焼元を検出する', () => {
    const prev = snap(
      [
        snapTask(0, 'rework', { incident: true, debt: true, burnTicksLeft: 1 }),
        snapTask(1, 'review'),
        snapTask(2, 'review'),
      ],
      { spread: 0, incidentCount: 1 },
    );
    const next = snap(
      [
        snapTask(0, 'rework', { debt: true }),
        snapTask(1, 'rework', { incident: true, burnTicksLeft: BURN_TICKS }),
        snapTask(2, 'review'),
      ],
      { spread: 1, incidentCount: 2 },
    );
    expect(detectFireEvents(prev, next)).toEqual([{ kind: 'spread', fromTaskId: 0, toTaskId: 1 }]);
  });

  it('Review 落ちのみの tick では spread に取り込まない', () => {
    const prev = snap(
      [snapTask(0, 'rework', { incident: true, burnTicksLeft: 1 }), snapTask(1, 'review')],
      { spread: 0, incidentCount: 1 },
      0.9,
    );
    const next = snap(
      [
        snapTask(0, 'rework', { debt: true }),
        snapTask(1, 'rework', { incident: true, burnTicksLeft: BURN_TICKS }),
      ],
      { spread: 1, incidentCount: 2 },
      0.05,
    );
    expect(detectFireEvents(prev, next)).toEqual([{ kind: 'ignite', taskId: 1 }]);
  });

  it('単一 Review への延焼は spread として検出する', () => {
    const prev = snap(
      [snapTask(0, 'rework', { incident: true, burnTicksLeft: 1 }), snapTask(1, 'review')],
      { spread: 0, incidentCount: 1 },
      0.2,
    );
    const next = snap(
      [
        snapTask(0, 'rework', { debt: true }),
        snapTask(1, 'rework', { incident: true, burnTicksLeft: BURN_TICKS }),
      ],
      { spread: 1, incidentCount: 2 },
      0.35,
    );
    expect(detectFireEvents(prev, next)).toEqual([{ kind: 'spread', fromTaskId: 0, toTaskId: 1 }]);
  });

  it('鎮火後の延焼は後方の expired 火を延焼元にする', () => {
    const prev = snap(
      [
        snapTask(0, 'rework', { incident: true, burnTicksLeft: 1 }),
        snapTask(1, 'rework', { incident: true, debt: true, burnTicksLeft: 1 }),
        snapTask(2, 'review'),
      ],
      { spread: 0, contained: 0, incidentCount: 2 },
    );
    const next = snap(
      [
        snapTask(0, 'rework'),
        snapTask(1, 'rework', { debt: true }),
        snapTask(2, 'rework', { incident: true, burnTicksLeft: BURN_TICKS }),
      ],
      { spread: 1, contained: 1, incidentCount: 3 },
    );
    expect(detectFireEvents(prev, next)).toEqual([
      { kind: 'spread', fromTaskId: 1, toTaskId: 2 },
      { kind: 'extinguish', taskId: 0, source: 'auto' },
    ]);
  });

  it('緊急対応の鎮火で extinguish(firefight) を検出する', () => {
    const prev = snap([snapTask(0, 'rework', { incident: true, burnTicksLeft: 20 })], {
      contained: 0,
      actionCounts: { firefight: 1 },
    });
    const next = snap([snapTask(0, 'review')], {
      contained: 1,
      actionCounts: { firefight: 2 },
    });
    expect(detectFireEvents(prev, next)).toEqual([
      { kind: 'extinguish', taskId: 0, source: 'firefight' },
    ]);
  });

  it('firefight 後に Review が Done へ進んでも firefight 演出を維持する', () => {
    const prev = snap([snapTask(0, 'rework', { incident: true, burnTicksLeft: 20 })], {
      contained: 0,
      actionCounts: { firefight: 2 },
    });
    const next = snap([snapTask(0, 'done')], {
      contained: 1,
      actionCounts: { firefight: 3 },
    });
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

  it('延焼元を鎮火演出に含めない', () => {
    const prev = snap(
      [
        snapTask(0, 'rework', { incident: true, burnTicksLeft: 1 }),
        snapTask(1, 'rework', { incident: true, burnTicksLeft: 1 }),
        snapTask(2, 'review'),
      ],
      { contained: 0, incidentCount: 2 },
    );
    const next = snap(
      [
        snapTask(0, 'rework', { debt: true }),
        snapTask(1, 'rework'),
        snapTask(2, 'rework', { incident: true, burnTicksLeft: BURN_TICKS }),
      ],
      { spread: 1, contained: 1, incidentCount: 3 },
    );
    expect(detectFireEvents(prev, next)).toEqual([
      { kind: 'spread', fromTaskId: 0, toTaskId: 2 },
      { kind: 'extinguish', taskId: 1, source: 'auto' },
    ]);
  });

  it('延焼先が足りないときは spread を重複させない', () => {
    const prev = snap(
      [
        snapTask(0, 'rework', { incident: true, burnTicksLeft: 1 }),
        snapTask(1, 'rework', { incident: true, burnTicksLeft: 1 }),
        snapTask(2, 'review'),
      ],
      { spread: 0, incidentCount: 2 },
    );
    const next = snap(
      [
        snapTask(0, 'rework', { debt: true }),
        snapTask(1, 'rework', { debt: true }),
        snapTask(2, 'rework', { incident: true, burnTicksLeft: BURN_TICKS }),
      ],
      { spread: 2, incidentCount: 3 },
    );
    expect(detectFireEvents(prev, next)).toEqual([{ kind: 'spread', fromTaskId: 0, toTaskId: 2 }]);
  });

  it('Coding 完了直後の Review 落ちでも ignite を検出する', () => {
    const prev = snap([snapTask(0, 'coding')], { incidentCount: 0 });
    const next = snap([snapTask(0, 'rework', { incident: true, burnTicksLeft: BURN_TICKS })], {
      incidentCount: 1,
    });
    expect(detectFireEvents(prev, next)).toEqual([{ kind: 'ignite', taskId: 0 }]);
  });

  it('firefight は最も延焼が近い火に付与する', () => {
    const prev = snap(
      [
        snapTask(0, 'rework', { incident: true, burnTicksLeft: 20 }),
        snapTask(1, 'rework', { incident: true, burnTicksLeft: 1 }),
      ],
      { contained: 0, actionCounts: { firefight: 1 } },
    );
    const next = snap([snapTask(0, 'rework'), snapTask(1, 'review')], {
      contained: 2,
      actionCounts: { firefight: 2 },
    });
    expect(detectFireEvents(prev, next)).toEqual([
      { kind: 'extinguish', taskId: 1, source: 'firefight' },
      { kind: 'extinguish', taskId: 0, source: 'auto' },
    ]);
  });

  it('Review 高スループットでも Review 落ちを spread に取り込まない', () => {
    const prev = snap(
      [
        snapTask(0, 'rework', { incident: true, burnTicksLeft: 1 }),
        snapTask(1, 'review'),
        snapTask(2, 'review'),
      ],
      { spread: 0, incidentCount: 1 },
      1.2,
    );
    const next = snap(
      [
        snapTask(0, 'rework', { debt: true }),
        snapTask(1, 'done'),
        snapTask(2, 'rework', { incident: true, burnTicksLeft: BURN_TICKS }),
      ],
      { spread: 1, incidentCount: 2 },
      1.5,
    );
    expect(detectFireEvents(prev, next)).toEqual([{ kind: 'ignite', taskId: 2 }]);
  });

  it('変化がなければ空配列', () => {
    const s = snap([snapTask(0, 'coding')]);
    expect(detectFireEvents(s, s)).toEqual([]);
  });
});

describe('fireSnapshotsEqual', () => {
  it('同内容なら true', () => {
    const a = snap([snapTask(0, 'review', { incident: true, burnTicksLeft: 3 })], {
      spread: 1,
      contained: 2,
      incidentCount: 3,
    });
    const b = snap([snapTask(0, 'review', { incident: true, burnTicksLeft: 3 })], {
      spread: 1,
      contained: 2,
      incidentCount: 3,
    });
    expect(fireSnapshotsEqual(a, b)).toBe(true);
  });

  it('reviewAccumulator か firefightCount が違えば false', () => {
    const base = snap([snapTask(0, 'review')], { spread: 1 });
    expect(fireSnapshotsEqual(base, snap([snapTask(0, 'review')], { spread: 1 }, 0.5))).toBe(false);
    expect(
      fireSnapshotsEqual(base, snap([snapTask(0, 'review')], { actionCounts: { firefight: 1 } })),
    ).toBe(false);
  });
});

describe('createFireSnapshot / positionFireEffects', () => {
  it('スプリント状態からスナップショットを作れる', () => {
    const tasks = [makeTask(1, 'rework', { incident: true, burnTicksLeft: 10 })];
    const metrics = {
      ...baseMetrics(),
      spread: 2,
      contained: 1,
      incidentCount: 3,
      actionCounts: { firefight: 4 },
    };
    const snapshot = createFireSnapshot(tasks, metrics, 0.75);
    expect(snapshot.spread).toBe(2);
    expect(snapshot.reviewAccumulator).toBe(0.75);
    expect(snapshot.firefightCount).toBe(4);
    expect(snapshot.tasks[0].incident).toBe(true);
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

  it('extinguish は prevTasks の Rework 位置を使う', () => {
    const prevTasks = [makeTask(0, 'rework', { incident: true, burnTicksLeft: 5 })];
    const nextTasks = [makeTask(0, 'review')];
    const positioned = positionFireEffects(
      [{ kind: 'extinguish', taskId: 0, source: 'firefight' }],
      nextTasks,
      prevTasks,
    );
    expect(positioned).toHaveLength(1);
    if (positioned[0].kind === 'extinguish') {
      const reworkPos = positionFireEffects([{ kind: 'ignite', taskId: 0 }], prevTasks)[0];
      expect(positioned[0].x).toBe(reworkPos.x);
      expect(positioned[0].y).toBe(reworkPos.y);
    }
  });

  it('spread の終点は発火前の Review 座標を使う', () => {
    const prevTasks = [makeTask(0, 'rework', { debt: true }), makeTask(1, 'review')];
    const nextTasks = [
      makeTask(0, 'rework', { debt: true }),
      makeTask(1, 'rework', { incident: true, burnTicksLeft: BURN_TICKS }),
    ];
    const positioned = positionFireEffects(
      [{ kind: 'spread', fromTaskId: 0, toTaskId: 1 }],
      nextTasks,
      prevTasks,
    );
    expect(positioned).toHaveLength(1);
    if (positioned[0].kind === 'spread') {
      const reviewPos = positionFireEffects([{ kind: 'ignite', taskId: 1 }], prevTasks)[0];
      const reworkPos = positionFireEffects([{ kind: 'ignite', taskId: 1 }], nextTasks)[0];
      expect(positioned[0].toX).toBe(reviewPos.x);
      expect(positioned[0].toY).toBe(reviewPos.y);
      expect(positioned[0].toX).not.toBe(reworkPos.x);
    }
  });
});

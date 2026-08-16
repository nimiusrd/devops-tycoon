import { describe, expect, it } from 'vitest';
import { REVIEW_FREEZE_PEAK } from '../../../src/sim/outcome';
import { activeDangerReasons } from '../../../src/sim/run/dangerZone';
import { RunEngine } from '../../../src/sim/run/engine';
import type { Task } from '../../../src/sim/types';

function startedSprint(seed: string) {
  const engine = new RunEngine({ seed, difficulty: 'normal' });
  engine.startRun('normal', [], seed);
  engine.beginSetupSprint();
  return engine;
}

function reviewTask(id: number): Task {
  return {
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
  };
}

describe('危険域判定（RI-101）', () => {
  it('reviewFreeze は現在の Review キューだけで判定し、シニアHPでは立たない', () => {
    const engine = startedSprint('ri-101-review-danger');
    engine.step(200);
    const internals = engine as unknown as {
      org: { seniorHp: number };
      sprint: { tasks: Task[] } | null;
    };
    internals.org.seniorHp = 20;
    internals.sprint!.tasks = [];
    expect(activeDangerReasons(engine)).not.toContain('reviewFreeze');

    const threshold = Math.round(REVIEW_FREEZE_PEAK * 0.75);
    internals.org.seniorHp = 80;
    internals.sprint!.tasks = Array.from({ length: threshold }, (_, i) => reviewTask(i));
    expect(activeDangerReasons(engine)).toContain('reviewFreeze');
  });

  it('reviewFreeze はスプリント内ピークが敗北閾値に達したら現在キューを減らしても残る', () => {
    const engine = startedSprint('ri-101-review-locked-peak');
    engine.step(200);
    const internals = engine as unknown as {
      sprint: { tasks: Task[]; metrics: { reviewQueueMax: number } } | null;
    };
    internals.sprint!.tasks = [];
    internals.sprint!.metrics.reviewQueueMax = REVIEW_FREEZE_PEAK;
    expect(activeDangerReasons(engine)).toContain('reviewFreeze');
  });

  it('reviewFreeze は警戒閾値に達したスプリント内ピークも維持する', () => {
    const engine = startedSprint('ri-101-review-watch-peak');
    engine.step(200);
    const internals = engine as unknown as {
      sprint: { tasks: Task[]; metrics: { reviewQueueMax: number } } | null;
    };
    internals.sprint!.tasks = [];
    internals.sprint!.metrics.reviewQueueMax = Math.round(REVIEW_FREEZE_PEAK * 0.75);
    expect(activeDangerReasons(engine)).toContain('reviewFreeze');
  });

  it('reviewFreeze はラン累計の Review ピークも維持する', () => {
    const engine = startedSprint('ri-101-review-run-peak');
    engine.step(200);
    const internals = engine as unknown as {
      sprint: { tasks: Task[]; metrics: { reviewQueueMax: number } } | null;
      quarterTotals: { reviewQueuePeak: number };
      totals: { reviewQueuePeak: number };
    };
    internals.sprint!.tasks = [];
    internals.sprint!.metrics.reviewQueueMax = 0;
    internals.quarterTotals.reviewQueuePeak = 0;
    internals.totals.reviewQueuePeak = Math.round(REVIEW_FREEZE_PEAK * 0.75);
    expect(activeDangerReasons(engine)).toContain('reviewFreeze');
  });

  it('reviewFreeze は投影された他チームの Review ピークも見る', () => {
    const engine = startedSprint('ri-101-review-projected-peak');
    engine.step(200);
    const internals = engine as unknown as {
      sprint: { tasks: Task[]; metrics: { reviewQueueMax: number } } | null;
      quarterTotals: { reviewQueuePeak: number };
    };
    internals.sprint!.tasks = [];
    internals.sprint!.metrics.reviewQueueMax = 0;
    internals.quarterTotals.reviewQueuePeak = REVIEW_FREEZE_PEAK;
    expect(activeDangerReasons(engine)).toContain('reviewFreeze');
  });

  it('reviewFreeze は非選択チームの現在キューも見る', () => {
    const engine = startedSprint('ri-101-review-other-team');
    engine.step(200);
    const internals = engine as unknown as {
      org: { seniorHp: number };
      sprint: { tasks: Task[] } | null;
      activeTeamId: string;
      teams: Array<{ id: string; reviewQueue: number }>;
    };
    internals.org.seniorHp = 80;
    internals.sprint!.tasks = [];
    expect(activeDangerReasons(engine)).not.toContain('reviewFreeze');
    const other = internals.teams.find((team) => team.id !== internals.activeTeamId);
    if (!other) return;
    const threshold = Math.round(REVIEW_FREEZE_PEAK * 0.75);
    other.reviewQueue = threshold;
    expect(activeDangerReasons(engine)).toContain('reviewFreeze');
  });

  it('kpiMissed は同時条件でも一度だけ追加する', () => {
    const engine = startedSprint('ri-101-kpi-dup');
    engine.step(200);
    const internals = engine as unknown as {
      budget: number;
      sprintIndexInQuarter: number;
      sprintsPerQuarter: number;
      stakeholderTrust: { management: number; customers: number; team: number };
      org: { quality: number; techDebt: number; morale: number; deliveryScore: number };
      totals: { delivered: number; incidents: number; completed: number; aiAssisted: number };
    };
    internals.budget = 5;
    internals.sprintIndexInQuarter = internals.sprintsPerQuarter;
    internals.stakeholderTrust = { management: 40, customers: 40, team: 40 };
    internals.org.quality = 0;
    internals.org.techDebt = 100;
    internals.org.morale = 0;
    internals.totals.delivered = 0;
    internals.totals.incidents = 99;
    internals.totals.completed = 10;
    internals.totals.aiAssisted = 0;
    const reasons = activeDangerReasons(engine).filter((reason) => reason === 'kpiMissed');
    expect(reasons).toHaveLength(1);
  });
});

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

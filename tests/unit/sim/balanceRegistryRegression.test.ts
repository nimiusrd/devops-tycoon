import { describe, expect, it } from 'vitest';
import { createEngine } from '../../../src/sim/engine';

function projectSeededEngine() {
  const engine = createEngine({
    seed: 'ri-106-balance-registry',
    aiEnabled: true,
    fixedStepMs: 100,
  });
  engine.step(5_000);
  const snapshot = engine.snapshot();

  return {
    tick: snapshot.tick,
    elapsedMs: snapshot.elapsedMs,
    org: {
      aiDependency: snapshot.org.aiDependency,
      deliveryScore: snapshot.org.deliveryScore,
      morale: snapshot.org.morale,
      seniorHp: snapshot.org.seniorHp,
    },
    sprint: {
      aiAdoption: snapshot.sprint.aiAdoption,
      metrics: {
        aiAssistedCompleted: snapshot.sprint.metrics.aiAssistedCompleted,
        completedCount: snapshot.sprint.metrics.completedCount,
        delivered: snapshot.sprint.metrics.delivered,
        incidentCount: snapshot.sprint.metrics.incidentCount,
        reworkCount: snapshot.sprint.metrics.reworkCount,
      },
      reviewAccumulator: snapshot.sprint.reviewAccumulator,
      activeTasks: snapshot.sprint.tasks
        .filter((task) => task.lane !== 'done')
        .map((task) => ({
          aiAssisted: task.aiAssisted,
          burnTicksLeft: task.burnTicksLeft,
          id: task.id,
          incident: task.incident,
          kind: task.kind,
          lane: task.lane,
          reworkAttempts: task.reworkAttempts,
        })),
    },
  };
}

describe('RI-106: バランスレジストリ移行の固定 seed 回帰', () => {
  it('工程モデルの代表値をレジストリへ移しても同じ状態へ到達する', () => {
    expect(projectSeededEngine()).toEqual({
      tick: 50,
      elapsedMs: 5_000,
      org: {
        aiDependency: 87.80000000000007,
        deliveryScore: 254,
        morale: 83.5,
        seniorHp: 72.4000000000001,
      },
      sprint: {
        aiAdoption: 0.85,
        metrics: {
          aiAssistedCompleted: 23,
          completedCount: 27,
          delivered: 254,
          incidentCount: 1,
          reworkCount: 5,
        },
        reviewAccumulator: 0.5831557500000281,
        activeTasks: [
          {
            aiAssisted: true,
            burnTicksLeft: 9,
            id: 18,
            incident: true,
            kind: 'complex',
            lane: 'rework',
            reworkAttempts: 1,
          },
        ],
      },
    });
  });
});

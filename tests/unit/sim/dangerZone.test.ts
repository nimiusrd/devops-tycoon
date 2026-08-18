import { describe, expect, it } from 'vitest';
import { PROCESS_BALANCE } from '../../../src/data/balance';
import { REVIEW_FREEZE_PEAK } from '../../../src/sim/outcome';
import { securityCustomerTrustFromRaw, securityFragility } from '../../../src/sim/model';
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

  it('第1四半期でも信頼≤20かつ未達≥2なら reorgRequired を含む', () => {
    const engine = startedSprint('ri-101-q1-reorg');
    engine.step(200);
    const internals = engine as unknown as {
      quarterNumber: number;
      sprintIndexInQuarter: number;
      budget: number;
      stakeholderTrust: { management: number; customers: number; team: number };
      org: { quality: number; techDebt: number; morale: number; seniorHp: number };
      totals: { delivered: number; incidents: number; completed: number; aiAssisted: number };
    };
    internals.quarterNumber = 1;
    internals.sprintIndexInQuarter = 0;
    internals.budget = 40;
    internals.stakeholderTrust = { management: 20, customers: 40, team: 40 };
    internals.org.quality = 0;
    internals.org.techDebt = 100;
    internals.org.morale = 0;
    internals.org.seniorHp = 80;
    internals.totals.delivered = 0;
    internals.totals.incidents = 99;
    internals.totals.completed = 10;
    internals.totals.aiAssisted = 0;
    expect(activeDangerReasons(engine)).toContain('reorgRequired');
  });

  it('第2四半期の前半でも未達≥3なら reorgRequired を含む', () => {
    const engine = startedSprint('ri-101-q2-early-reorg');
    engine.step(200);
    const internals = engine as unknown as {
      quarterNumber: number;
      sprintIndexInQuarter: number;
      budget: number;
      stakeholderTrust: { management: number; customers: number; team: number };
      org: { quality: number; techDebt: number; morale: number; seniorHp: number };
      teams: Array<{ quality: number; techDebt: number; morale: number }>;
      totals: { delivered: number; incidents: number; completed: number; aiAssisted: number };
    };
    internals.quarterNumber = 2;
    internals.sprintIndexInQuarter = 0;
    internals.budget = 40;
    internals.stakeholderTrust = { management: 40, customers: 40, team: 40 };
    internals.org.quality = 0;
    internals.org.techDebt = 100;
    internals.org.morale = 0;
    internals.org.seniorHp = 80;
    for (const team of internals.teams) {
      team.quality = 0;
      team.techDebt = 100;
      team.morale = 0;
    }
    internals.totals.delivered = 0;
    internals.totals.incidents = 99;
    internals.totals.completed = 10;
    internals.totals.aiAssisted = 0;
    expect(activeDangerReasons(engine)).toContain('reorgRequired');
  });

  it('スプリント外でも確定済み四半期KPIから kpiMissed を維持する', () => {
    const engine = startedSprint('ri-101-kpi-off-sprint');
    engine.step(200);
    const internals = engine as unknown as {
      phase: string;
      sprintIndexInQuarter: number;
      sprintsPerQuarter: number;
      budget: number;
      stakeholderTrust: { management: number; customers: number; team: number };
      org: { quality: number; techDebt: number; morale: number; seniorHp: number };
      quarterTotals: {
        delivered: number;
        incidents: number;
        completed: number;
        aiAssisted: number;
      };
    };
    internals.sprintIndexInQuarter = internals.sprintsPerQuarter;
    internals.budget = 40;
    internals.stakeholderTrust = { management: 40, customers: 40, team: 40 };
    internals.org.quality = 0;
    internals.org.techDebt = 100;
    internals.org.morale = 0;
    internals.org.seniorHp = 80;
    internals.quarterTotals.delivered = 0;
    internals.quarterTotals.incidents = 99;
    internals.quarterTotals.completed = 10;
    internals.quarterTotals.aiAssisted = 0;
    internals.phase = 'draft';
    expect(activeDangerReasons(engine)).toContain('kpiMissed');
  });

  it('四半期前半でも未達≥4なら kpiMissed を含む', () => {
    const engine = startedSprint('ri-101-kpi-early');
    engine.step(200);
    const internals = engine as unknown as {
      sprintIndexInQuarter: number;
      budget: number;
      stakeholderTrust: { management: number; customers: number; team: number };
      org: { quality: number; techDebt: number; morale: number; seniorHp: number };
      teams: Array<{ quality: number; techDebt: number; morale: number }>;
      totals: { delivered: number; incidents: number; completed: number; aiAssisted: number };
    };
    internals.sprintIndexInQuarter = 0;
    internals.budget = 40;
    internals.stakeholderTrust = { management: 40, customers: 40, team: 40 };
    internals.org.quality = 0;
    internals.org.techDebt = 100;
    internals.org.morale = 0;
    internals.org.seniorHp = 80;
    for (const team of internals.teams) {
      team.quality = 0;
      team.techDebt = 100;
      team.morale = 0;
    }
    internals.totals.delivered = 0;
    internals.totals.incidents = 99;
    internals.totals.completed = 10;
    internals.totals.aiAssisted = 0;
    expect(activeDangerReasons(engine)).toContain('kpiMissed');
  });

  it('次スプリントの必須インフラ課金で尽きる予算も危険域にする', () => {
    const engine = startedSprint('ri-101-infra-budget');
    engine.step(200);
    const internals = engine as unknown as {
      budget: number;
      sprintIndexInQuarter: number;
      sprintsPerQuarter: number;
      org: { aiDependency: number };
      teams: Array<{ aiDependency: number }>;
    };
    internals.budget = 20;
    internals.sprintIndexInQuarter = internals.sprintsPerQuarter - 1;
    internals.org.aiDependency = 100;
    for (const team of internals.teams) team.aiDependency = 100;
    expect(activeDangerReasons(engine)).toContain('budgetExhausted');
  });

  it('次回インフラ課金は選択中チームのライブ依存度を使う', () => {
    const engine = startedSprint('ri-101-infra-live-dep');
    engine.step(200);
    const internals = engine as unknown as {
      budget: number;
      sprintIndexInQuarter: number;
      sprintsPerQuarter: number;
      org: { aiDependency: number };
      teams: Array<{ aiDependency: number }>;
    };
    internals.budget = 16;
    internals.sprintIndexInQuarter = internals.sprintsPerQuarter - 1;
    internals.org.aiDependency = 100;
    for (const team of internals.teams) team.aiDependency = 0;
    expect(activeDangerReasons(engine)).toContain('budgetExhausted');
  });

  it('次回インフラ課金は開始時の依存度ドリフト後で見積もる', () => {
    const engine = new RunEngine({
      seed: 'ri-101-infra-drift',
      difficulty: 'normal',
      trials: ['frontier-dependency'],
    });
    engine.startRun('normal', ['frontier-dependency'], 'ri-101-infra-drift');
    engine.beginSetupSprint();
    engine.step(200);
    const internals = engine as unknown as {
      budget: number;
      sprintIndexInQuarter: number;
      sprintsPerQuarter: number;
      org: { aiDependency: number };
      teams: Array<{ aiDependency: number }>;
    };
    internals.budget = 31;
    internals.sprintIndexInQuarter = internals.sprintsPerQuarter - 1;
    internals.org.aiDependency = 57;
    for (const team of internals.teams) team.aiDependency = 57;
    expect(activeDangerReasons(engine)).toContain('budgetExhausted');
  });

  it('スプリント外のKPIは選択中ではなく全社組織値で判定する', () => {
    const engine = startedSprint('ri-101-kpi-company-org');
    engine.step(200);
    const internals = engine as unknown as {
      phase: string;
      activeTeamId: string;
      budget: number;
      stakeholderTrust: { management: number; customers: number; team: number };
      org: { quality: number; techDebt: number; morale: number; seniorHp: number };
      teams: Array<{ id: string; quality: number; techDebt: number }>;
      quarterTotals: {
        delivered: number;
        incidents: number;
        completed: number;
        aiAssisted: number;
      };
    };
    internals.budget = 40;
    internals.stakeholderTrust = { management: 40, customers: 40, team: 40 };
    internals.org.quality = 80;
    internals.org.techDebt = 20;
    internals.org.morale = 80;
    internals.org.seniorHp = 80;
    const others = internals.teams.filter((team) => team.id !== internals.activeTeamId);
    expect(others.length).toBeGreaterThan(0);
    for (const team of internals.teams) {
      if (team.id === internals.activeTeamId) {
        team.quality = 80;
        team.techDebt = 20;
        continue;
      }
      team.quality = 0;
      team.techDebt = 100;
    }
    internals.quarterTotals.delivered = 0;
    internals.quarterTotals.incidents = 99;
    internals.quarterTotals.completed = 10;
    internals.quarterTotals.aiAssisted = 0;
    internals.phase = 'draft';
    expect(activeDangerReasons(engine)).toContain('kpiMissed');
  });

  it('シニアHPと士気は選択中チームの値で判定する', () => {
    const engine = startedSprint('ri-101-active-vitals');
    engine.step(200);
    const internals = engine as unknown as {
      activeTeamId: string;
      org: { seniorHp: number; morale: number };
      teams: Array<{ id: string; seniorHp: number; morale: number }>;
    };
    internals.org.seniorHp = 20;
    internals.org.morale = 20;
    for (const team of internals.teams) {
      if (team.id === internals.activeTeamId) {
        team.seniorHp = 20;
        team.morale = 20;
        continue;
      }
      team.seniorHp = 90;
      team.morale = 90;
    }
    expect(activeDangerReasons(engine)).toContain('seniorBurnout');
    expect(activeDangerReasons(engine)).toContain('moraleCollapse');
  });

  it('支払えない採用費では予算危険域にしない', () => {
    const engine = startedSprint('ri-101-recruit-unaffordable');
    engine.step(200);
    const internals = engine as unknown as {
      budget: number;
      sprintIndexInQuarter: number;
      org: { aiDependency: number };
      teams: Array<{ aiDependency: number }>;
    };
    internals.budget = 20;
    internals.sprintIndexInQuarter = 0;
    internals.org.aiDependency = 0;
    for (const team of internals.teams) team.aiDependency = 0;
    expect(activeDangerReasons(engine)).not.toContain('budgetExhausted');
  });

  it('採用フェーズで採用費ちょうどなら予算危険域にする', () => {
    const engine = startedSprint('ri-101-recruit-budget');
    engine.step(200);
    const internals = engine as unknown as {
      phase: string;
      budget: number;
      sprintIndexInQuarter: number;
      org: { aiDependency: number };
      teams: Array<{ aiDependency: number }>;
    };
    internals.phase = 'recruit';
    internals.budget = 25;
    internals.sprintIndexInQuarter = 0;
    internals.org.aiDependency = 0;
    for (const team of internals.teams) team.aiDependency = 0;
    expect(activeDangerReasons(engine)).toContain('budgetExhausted');
  });

  it('信頼枯渇は信頼閾値だけで判定する', () => {
    const engine = startedSprint('ri-101-trust-only');
    engine.step(200);
    const internals = engine as unknown as {
      budget: number;
      org: { seniorHp: number };
      stakeholderTrust: { management: number; customers: number; team: number };
    };
    internals.budget = 5;
    internals.org.seniorHp = 5;
    internals.stakeholderTrust = { management: 40, customers: 40, team: 40 };
    expect(activeDangerReasons(engine)).not.toContain('trustExhausted');
  });

  it('確定済みの延焼による顧客信頼低下も危険域にする', () => {
    const engine = startedSprint('ri-101-pending-trust');
    engine.step(200);
    const internals = engine as unknown as {
      stakeholderTrust: { management: number; customers: number; team: number };
      sprint: {
        metrics: { spread: number; incidentCount: number; securityTrustSpreadRaw: number };
      };
    };
    internals.stakeholderTrust = { management: 40, customers: 26, team: 40 };
    internals.sprint.metrics.spread = 2;
    internals.sprint.metrics.incidentCount = 2;
    internals.sprint.metrics.securityTrustSpreadRaw = 4;
    expect(activeDangerReasons(engine)).toContain('trustExhausted');
  });

  it('確定済み Incident の信頼予測は engine と同じ raw 係数を使う', () => {
    const perIncidentRaw = PROCESS_BALANCE.incidentTrustPerIncidentRaw as { value: number };
    const defaultValue = perIncidentRaw.value;
    perIncidentRaw.value = 0.49;
    try {
      const engine = startedSprint('ri-108-pending-incident-trust');
      engine.step(200);
      const internals = engine as unknown as {
        stakeholderTrust: { management: number; customers: number; team: number };
        org: { securityLevel: number };
        sprint: {
          metrics: {
            spread: number;
            incidentCount: number;
            securityTrustSpreadRaw: number;
            securityTrustIncidentFragility: number;
          };
        };
      };
      const incidents = 1;
      const fragility = securityFragility(0);
      const expectedDelta = securityCustomerTrustFromRaw(
        incidents * perIncidentRaw.value * fragility,
      );
      internals.stakeholderTrust = { management: 40, customers: 26, team: 40 };
      internals.org.securityLevel = 90;
      internals.sprint.metrics.spread = 1;
      internals.sprint.metrics.incidentCount = incidents;
      internals.sprint.metrics.securityTrustSpreadRaw = 0;
      internals.sprint.metrics.securityTrustIncidentFragility = fragility;

      expect(expectedDelta).toBe(0);
      expect(activeDangerReasons(engine)).not.toContain('trustExhausted');
    } finally {
      perIncidentRaw.value = defaultValue;
    }
  });

  it('延焼数が最小件数ちょうどでも発生時の信頼 raw を使う', () => {
    const minimumCount = PROCESS_BALANCE.incidentTrustMinimumCount as { value: number };
    const defaultValue = minimumCount.value;
    minimumCount.value = 1;
    try {
      const engine = startedSprint('ri-108-pending-minimum-count');
      engine.step(200);
      const internals = engine as unknown as {
        stakeholderTrust: { management: number; customers: number; team: number };
        org: { securityLevel: number };
        sprint: {
          metrics: {
            spread: number;
            incidentCount: number;
            securityTrustSpreadRaw: number;
            securityTrustIncidentFragility: number;
          };
        };
      };
      internals.stakeholderTrust = { management: 40, customers: 27, team: 40 };
      internals.org.securityLevel = 90;
      internals.sprint.metrics.spread = 1;
      internals.sprint.metrics.incidentCount = 1;
      internals.sprint.metrics.securityTrustSpreadRaw = 2;
      internals.sprint.metrics.securityTrustIncidentFragility = 1;

      expect(activeDangerReasons(engine)).toContain('trustExhausted');
    } finally {
      minimumCount.value = defaultValue;
    }
  });

  it('スプリント外でも全社 Tech Debt で危険域を維持する', () => {
    const engine = startedSprint('ri-101-company-debt');
    engine.step(200);
    const internals = engine as unknown as {
      phase: string;
      activeTeamId: string;
      org: { techDebt: number; seniorHp: number; morale: number };
      teams: Array<{ id: string; techDebt: number }>;
    };
    internals.org.techDebt = 50;
    internals.org.seniorHp = 80;
    internals.org.morale = 80;
    const others = internals.teams.filter((team) => team.id !== internals.activeTeamId);
    expect(others.length).toBeGreaterThan(0);
    for (const team of internals.teams) {
      if (team.id === internals.activeTeamId) {
        team.techDebt = 50;
        continue;
      }
      team.techDebt = 100;
    }
    internals.phase = 'result';
    expect(activeDangerReasons(engine)).toContain('techDebt');
  });
});

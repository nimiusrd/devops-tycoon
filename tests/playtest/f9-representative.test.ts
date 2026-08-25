import { describe, expect, it } from 'vitest';
import { CONSECUTIVE_INCIDENT_SPRINT_CAP, evaluateLose } from '../../src/sim/outcome';
import { activeIncidents } from '../../src/sim/actions';
import { effectiveActionsOf, evaluateCounterfactual } from '../../src/sim/run/counterfactual';
import { listApplicableActions, observeDangerZone } from '../../src/sim/run/dangerZone';
import { RunEngine } from '../../src/sim/run/engine';
import type { CounterfactualFrame } from '../../src/sim/run/persist';
import type { RunState } from '../../src/sim/run/types';
import {
  F9_NATURAL_SCENARIOS,
  F9_SPEC_REASONS,
  fingerprintCollisions,
  observedWarningIndicators,
  observeNaturalF9Scenario,
  representativeFingerprint,
  type F9RepresentativeObservation,
} from './f9Representative';
import { MS_PER_TICK, type DangerSample, type RunLog } from './harness';

function displayDangerSample(sample: DangerSample): DangerSample {
  return {
    ...sample,
    signals: Object.fromEntries(
      Object.entries(sample.signals).map(([key, value]) => [
        key,
        typeof value === 'number' ? Math.round(value * 10) / 10 : value,
      ]),
    ) as DangerSample['signals'],
  };
}

function lostPrevSnapshot(state: RunState): NonNullable<RunLog['lostPrevState']> {
  const round1 = (value: number): number => Math.round(value * 10) / 10;
  return {
    seniorHp: round1(state.org.seniorHp),
    morale: round1(state.org.morale),
    techDebt: round1(state.org.techDebt),
    aiDependency: round1(state.org.aiDependency),
    budget: round1(state.budget),
    minTrust: round1(
      Math.min(
        state.stakeholderTrust.management,
        state.stakeholderTrust.customers,
        state.stakeholderTrust.team,
      ),
    ),
    trustManagement: round1(state.stakeholderTrust.management),
    trustCustomers: round1(state.stakeholderTrust.customers),
    trustTeam: round1(state.stakeholderTrust.team),
    phase: state.phase,
  };
}

function replayIncidentBaseline(frame: CounterfactualFrame): {
  lostPrevState: NonNullable<RunLog['lostPrevState']>;
  lostPhase: string;
  sprintsPlayed: number;
} {
  const engine = new RunEngine({ seed: 'ri139-incident-baseline', difficulty: 'easy' });
  engine.hydrateCounterfactualFrame(frame);
  let before = engine.snapshot();
  for (let guard = 0; guard < 4_000 && engine.snapshot().status === 'playing'; guard += 1) {
    before = engine.snapshot();
    engine.step(MS_PER_TICK);
  }
  const lost = engine.snapshot();
  expect(lost.status).toBe('lost');
  expect(lost.loseReason).toBe('incidentCascade');
  return {
    lostPrevState: lostPrevSnapshot(before),
    lostPhase: before.phase,
    sprintsPlayed: lost.sprintsPlayed,
  };
}

function normalizeIncidentFrame(frame: CounterfactualFrame): CounterfactualFrame {
  const next = structuredClone(frame);
  const safeOrg = {
    ...next.persist.org,
    seniorHp: 100,
    morale: 100,
    techDebt: 0,
    aiDependency: 20,
    aiLiteracy: 100,
  };
  next.persist.org = safeOrg;
  next.persist.budget = 100;
  next.persist.totals = {
    ...next.persist.totals,
    reviewQueuePeak: 0,
    consecutiveIncidentSprints: CONSECUTIVE_INCIDENT_SPRINT_CAP - 1,
  };
  next.persist.stakeholderTrust = { management: 100, customers: 100, team: 100 };
  next.persist.extras.teams = next.persist.extras.teams?.map((team) =>
    team.id === next.persist.extras.activeTeamId
      ? {
          ...team,
          seniorHp: safeOrg.seniorHp,
          morale: safeOrg.morale,
          techDebt: safeOrg.techDebt,
          aiDependency: safeOrg.aiDependency,
          aiLiteracy: safeOrg.aiLiteracy,
          reviewQueue: 0,
        }
      : team,
  );
  return next;
}

function incidentCascadeObservation(): F9RepresentativeObservation {
  const source = new RunEngine({
    seed: 'ri139-incident-cascade',
    difficulty: 'nightmare',
    trials: ['flammable'],
  });
  source.startRun();
  source.beginSetupSprint();
  let frame: CounterfactualFrame | null = null;
  for (let guard = 0; guard < 10_000 && source.snapshot().phase === 'sprint'; guard += 1) {
    const sprint = source.snapshot().sprint;
    if (sprint && activeIncidents(sprint).length > 0) {
      frame = source.exportCounterfactualFrame();
      break;
    }
    source.step(100);
  }
  if (!frame) throw new Error('incidentCascade: 炎上フレームへ到達しない');

  const normalized = normalizeIncidentFrame(frame);
  const engine = new RunEngine({ seed: 'ri139-incident-restore', difficulty: 'easy' });
  engine.hydrateCounterfactualFrame(normalized);
  const state = engine.snapshot();
  const danger = observeDangerZone(engine);
  expect(danger.reasons).toEqual(['incidentCascade']);
  expect(
    evaluateLose(
      state.org,
      {
        ...state.totals,
        consecutiveIncidentSprints: CONSECUTIVE_INCIDENT_SPRINT_CAP,
      },
      state.budget,
    ),
  ).toBe('incidentCascade');

  const probes = ['firefight', 'andon'] as const;
  const evaluation = evaluateCounterfactual(normalized, {
    actions: probes,
    includeStrategic: false,
    focusReason: 'incidentCascade',
    maxSprints: 1,
    maxActionBranches: probes.length,
    maxComboBranches: 0,
    maxStrategicBranches: 0,
  });
  expect(evaluation.skippedActions).toEqual([]);
  expect(evaluation.skippedStrategic).toEqual([]);
  const replay = replayIncidentBaseline(normalized);
  const reviewQueue = state.sprint?.tasks.filter((task) => task.lane === 'review').length ?? 0;
  const available = listApplicableActions(engine).sort();
  expect(probes.every((probe) => available.includes(probe))).toBe(true);
  return {
    reason: 'incidentCascade',
    source: 'nightmare/flammable/ri139-incident-cascade（境界frame）',
    warningKey: 'consecutiveIncidentSprints',
    firstDanger: {
      sprintsPlayed: state.sprintsPlayed,
      quarter: state.quarterNumber,
      index: state.sprintIndexInQuarter,
      actions: available,
      signals: {
        seniorHp: state.org.seniorHp,
        morale: state.org.morale,
        techDebt: state.org.techDebt,
        activeTeamTechDebt: state.org.techDebt,
        aiDependency: state.org.aiDependency,
        aiLiteracy: state.org.aiLiteracy,
        budget: state.budget,
        budgetAfterNextInfraCharge: danger.budgetAfterNextInfraCharge,
        strategicSpendExhaustsBudget: danger.strategicSpendExhaustsBudget,
        reviewQueue,
        reviewQueuePeak: state.totals.reviewQueuePeak,
        consecutiveIncidentSprints: state.totals.consecutiveIncidentSprints ?? 0,
      },
    },
    sprintsPlayed: replay.sprintsPlayed,
    lostPhase: replay.lostPhase,
    lostPrevState: replay.lostPrevState,
    mechanicallyAvailable: available,
    counterfactualOrigin: evaluation.origin,
    counterfactualApplicableActions: available,
    baseline: evaluation.baseline,
    branches: evaluation.branches
      .filter((branch) => branch.actionId !== null)
      .map((branch) => ({
        actionId: branch.actionId!,
        sprintsToLose: branch.sprintsToLose,
        leftDanger: branch.leftDanger,
        loseReason: branch.loseReason,
        status: branch.status,
        truncated: branch.truncated,
      })),
    effectiveProbes: effectiveActionsOf(evaluation),
  };
}

describe('RI-139 F-9 敗因別の代表シナリオ', () => {
  it('7敗因の予兆・速度・直前状態・打てる手・限定介入を固定する', { timeout: 180_000 }, () => {
    const observations = [
      ...F9_NATURAL_SCENARIOS.map(observeNaturalF9Scenario),
      incidentCascadeObservation(),
    ];
    expect(observations.map((observation) => observation.reason).sort()).toEqual(
      [...F9_SPEC_REASONS].sort(),
    );
    for (const observation of observations) {
      expect(observation.firstDanger.actions).toEqual(expect.any(Array));
      expect(observation.mechanicallyAvailable.length).toBeGreaterThan(0);
      expect(observation.branches.length).toBeGreaterThanOrEqual(2);
      expect(observation.counterfactualOrigin.sprintsPlayed).toBeGreaterThanOrEqual(
        observation.firstDanger.sprintsPlayed,
      );
      expect(observedWarningIndicators(observation)).toContain(observation.warningKey);
      expect(
        observation.branches.every((branch) =>
          observation.counterfactualApplicableActions.includes(branch.actionId),
        ),
      ).toBe(true);
    }
    expect(fingerprintCollisions(observations)).toEqual([]);
    expect(new Set(observations.map(representativeFingerprint)).size).toBe(F9_SPEC_REASONS.length);
    expect([
      ...F9_NATURAL_SCENARIOS.map(observeNaturalF9Scenario),
      incidentCascadeObservation(),
    ]).toEqual(observations);
    expect(
      observations.map((observation) => ({
        ...observation,
        firstDanger: displayDangerSample(observation.firstDanger),
        observedWarnings: observedWarningIndicators(observation),
        fingerprint: representativeFingerprint(observation),
      })),
    ).toMatchSnapshot();
  });

  it('fingerprint衝突時は同じ根拠と敗因を診断する', () => {
    const base = {
      warningKey: 'budget',
      firstDanger: {
        sprintsPlayed: 0,
        actions: [],
        signals: {
          seniorHp: 100,
          morale: 100,
          techDebt: 0,
          activeTeamTechDebt: 0,
          aiDependency: 20,
          aiLiteracy: 100,
          budget: 3,
          budgetAfterNextInfraCharge: 3,
          strategicSpendExhaustsBudget: false,
          reviewQueue: 0,
          reviewQueuePeak: 0,
          consecutiveIncidentSprints: 0,
        },
      },
      sprintsPlayed: 1,
      lostPhase: 'setup',
      lostPrevState: {
        seniorHp: 100,
        morale: 100,
        techDebt: 0,
        aiDependency: 20,
        budget: 3,
        minTrust: 100,
        trustManagement: 100,
        trustCustomers: 100,
        trustTeam: 100,
        phase: 'setup',
      },
      mechanicallyAvailable: [],
      effectiveProbes: [],
    } as unknown as F9RepresentativeObservation;
    const observations = [
      { ...base, reason: 'budgetExhausted' },
      {
        ...base,
        reason: 'incidentCascade',
        warningKey: 'consecutiveIncidentSprints',
      },
    ] as F9RepresentativeObservation[];

    expect(fingerprintCollisions(observations)).toEqual([
      {
        fingerprint: 'budget|0:1:setup|100,100,0,20,3,100,100,100|>|',
        reasons: ['budgetExhausted', 'incidentCascade'],
      },
    ]);
    expect(
      fingerprintCollisions([{ ...observations[0], lostPhase: 'sprint' }, observations[1]]),
    ).toEqual([]);
    expect(
      fingerprintCollisions([
        {
          ...observations[0],
          lostPrevState: { ...observations[0].lostPrevState, seniorHp: 99 },
        },
        observations[1],
      ]),
    ).toEqual([]);
    expect(
      fingerprintCollisions([
        {
          ...observations[0],
          firstDanger: { ...observations[0].firstDanger, actions: ['pairReview'] },
        },
        observations[1],
      ]),
    ).toEqual([]);
    expect(
      fingerprintCollisions([
        { ...observations[0], mechanicallyAvailable: ['pairReview'] },
        observations[1],
      ]),
    ).toEqual([]);
  });

  it('実判定と同じ未丸め値・次回課金後予算から警告を復元する', () => {
    const base = {
      firstDanger: {
        signals: {
          seniorHp: 49.96,
          morale: 100,
          techDebt: 0,
          activeTeamTechDebt: 0,
          aiDependency: 20,
          aiLiteracy: 100,
          budget: 20,
          budgetAfterNextInfraCharge: 15,
          strategicSpendExhaustsBudget: false,
          reviewQueue: 0,
          reviewQueuePeak: 0,
          consecutiveIncidentSprints: 0,
        },
      },
    } as unknown as F9RepresentativeObservation;

    expect(observedWarningIndicators(base)).toEqual(['budget', 'seniorHp']);
    expect(
      observedWarningIndicators({
        ...base,
        firstDanger: {
          ...base.firstDanger,
          signals: {
            ...base.firstDanger.signals,
            seniorHp: 50.04,
            budgetAfterNextInfraCharge: 16,
          },
        },
      }),
    ).toEqual([]);
  });
});

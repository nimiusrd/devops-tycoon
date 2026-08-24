import { describe, expect, it } from 'vitest';
import { CONSECUTIVE_INCIDENT_SPRINT_CAP, evaluateLose } from '../../src/sim/outcome';
import { activeIncidents } from '../../src/sim/actions';
import { effectiveActionsOf, evaluateCounterfactual } from '../../src/sim/run/counterfactual';
import { activeDangerReasons, listApplicableActions } from '../../src/sim/run/dangerZone';
import { RunEngine } from '../../src/sim/run/engine';
import type { CounterfactualFrame } from '../../src/sim/run/persist';
import {
  F9_NATURAL_SCENARIOS,
  F9_SPEC_REASONS,
  fingerprintCollisions,
  observeNaturalF9Scenario,
  representativeFingerprint,
  type F9RepresentativeObservation,
} from './f9Representative';

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
  expect(activeDangerReasons(engine)).toEqual(['incidentCascade']);
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
  const reviewQueue = state.sprint?.tasks.filter((task) => task.lane === 'review').length ?? 0;
  const available = listApplicableActions(engine).sort();
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
        aiDependency: state.org.aiDependency,
        aiLiteracy: state.org.aiLiteracy,
        budget: state.budget,
        reviewQueue,
        reviewQueuePeak: state.totals.reviewQueuePeak,
        consecutiveIncidentSprints: state.totals.consecutiveIncidentSprints ?? 0,
      },
    },
    sprintsPlayed: state.sprintsPlayed + 1,
    lostPhase: 'sprint',
    lostPrevState: {
      seniorHp: state.org.seniorHp,
      morale: state.org.morale,
      techDebt: state.org.techDebt,
      aiDependency: state.org.aiDependency,
      budget: state.budget,
      minTrust: 100,
      trustManagement: 100,
      trustCustomers: 100,
      trustTeam: 100,
      phase: 'sprint',
    },
    mechanicallyAvailable: available,
    counterfactualOrigin: evaluation.origin,
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
    }
    expect(fingerprintCollisions(observations)).toEqual([]);
    expect(new Set(observations.map(representativeFingerprint)).size).toBe(F9_SPEC_REASONS.length);
    expect([
      ...F9_NATURAL_SCENARIOS.map(observeNaturalF9Scenario),
      incidentCascadeObservation(),
    ]).toEqual(observations);
    expect(observations).toMatchSnapshot();
  });

  it('fingerprint衝突時は同じ根拠と敗因を診断する', () => {
    const base = {
      warningKey: 'budget',
      firstDanger: { sprintsPlayed: 0 },
      sprintsPlayed: 1,
      lostPhase: 'setup',
      effectiveProbes: [],
    } as unknown as F9RepresentativeObservation;
    const observations = [
      { ...base, reason: 'budgetExhausted' },
      { ...base, reason: 'incidentCascade' },
    ] as F9RepresentativeObservation[];

    expect(fingerprintCollisions(observations)).toEqual([
      {
        fingerprint: 'budget|1:setup|',
        reasons: ['budgetExhausted', 'incidentCascade'],
      },
    ]);
    expect(
      fingerprintCollisions([{ ...observations[0], lostPhase: 'sprint' }, observations[1]]),
    ).toEqual([]);
  });
});

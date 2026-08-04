import { describe, expect, it } from 'vitest';
import { deriveTeamCapacities } from '../../src/sim/orgscale/teamState';
import type { TeamRunState } from '../../src/sim/orgscale/types';
import { AI_LITERACY_UNSAFE_CAP, TECH_DEBT_CAP, evaluateWinType } from '../../src/sim/outcome';
import { RunEngine } from '../../src/sim/run/engine';
import type {
  QuarterGoal,
  QuarterOutcome,
  QuarterReview,
  RunState,
  RunTotals,
  StakeholderTrust,
} from '../../src/sim/run/types';
import { createRng } from '../../src/sim/rng';
import { createSprint } from '../../src/sim/sprint';
import type { OrgState, SprintMetrics, SprintState } from '../../src/sim/types';

type D4Internals = {
  activeTeamId: string;
  bossId: string;
  budget: number;
  currentSprintId: string | null;
  currentSprintKind: RunState['currentSprintKind'];
  org: OrgState;
  phase: RunState['phase'];
  quarterGoal: QuarterGoal;
  quarterNumber: number;
  quarterReview: QuarterReview | null;
  quarterTotals: RunTotals;
  sprint: SprintState | null;
  sprintBaselineInput: unknown;
  stakeholderTrust: StakeholderTrust;
  status: RunState['status'];
  teams: TeamRunState[];
  totals: RunTotals;
  usedHeavyActions: boolean;
  winEvalOrg: OrgState | null;
  resolveSprint(): void;
};

const zeroTotals = (): RunTotals => ({
  delivered: 0,
  done: 0,
  rework: 0,
  incidents: 0,
  contained: 0,
  spread: 0,
  aiAssisted: 0,
  completed: 0,
  reviewQueuePeak: 0,
  maxCombo: 0,
  consecutiveIncidentSprints: 0,
});

const goal = (): QuarterGoal => ({
  deliveryTarget: 90,
  qualityTarget: 50,
  techDebtLimit: 40,
  moraleTarget: 45,
  incidentLimit: 2,
});

const trust = (value = 60): StakeholderTrust => ({
  management: value,
  customers: value,
  team: value,
});

const makeReview = (outcome: QuarterOutcome): QuarterReview => ({
  goal: goal(),
  outcome,
  trust: trust(),
  progress: [],
  missedReasons: [],
  availableAdjustments: outcome === 'missed_adjustable' ? ['cut_scope'] : [],
  bossCleared: outcome === 'met' || outcome === 'exceeded',
});

const asInternals = (engine: RunEngine): D4Internals => engine as unknown as D4Internals;

const makeOrg = (overrides: Partial<OrgState> = {}): OrgState => ({
  aiEnabled: true,
  aiDependency: 35,
  aiLiteracy: 50,
  testCoverage: 45,
  documentation: 30,
  quality: 50,
  morale: 45,
  seniorHp: 50,
  techDebt: 40,
  deliveryScore: 0,
  ...overrides,
});

const singleActiveTeam = (template: TeamRunState, org: OrgState): TeamRunState => ({
  ...template,
  engineers: 2,
  headcount: 2,
  aiLiteracy: org.aiLiteracy,
  aiDependency: org.aiDependency,
  morale: org.morale,
  techDebt: org.techDebt,
  shipping: org.deliveryScore,
  reviewQueue: 0,
  incidents: 0,
  seniorHp: org.seniorHp,
  aiEnabled: org.aiEnabled,
  testCoverage: org.testCoverage,
  documentation: org.documentation,
  quality: org.quality,
  ...deriveTeamCapacities({
    engineers: 2,
    reviewQueue: 0,
    incidents: 0,
    quality: org.quality,
  }),
});

const completeSprint = (org: OrgState, metrics: Partial<SprintMetrics> = {}): SprintState => {
  const sprint = createSprint(
    { taskCount: 0, codingSlots: 1, maxTicks: 1, focusMax: 3 },
    org,
    createRng('ri-72-d4-fixed-sprint'),
  );
  return {
    ...sprint,
    complete: true,
    metrics: {
      ...sprint.metrics,
      seniorHpStart: org.seniorHp,
      ...metrics,
    },
  };
};

const arrangeResolvedSprint = (
  engine: RunEngine,
  options: {
    kind: RunState['currentSprintKind'];
    org?: Partial<OrgState>;
    metrics?: Partial<SprintMetrics>;
    budget?: number;
    totals?: Partial<RunTotals>;
    quarterTotals?: Partial<RunTotals>;
    quarterGoal?: QuarterGoal;
    stakeholderTrust?: StakeholderTrust;
    quarterNumber?: number;
  },
): D4Internals => {
  engine.startRun('easy', [], 'ri-72-d4-fixed');
  const internals = asInternals(engine);
  const org = makeOrg(options.org);
  const totals = { ...zeroTotals(), ...options.totals };
  const quarterTotals = { ...zeroTotals(), ...options.quarterTotals };

  internals.phase = 'sprint';
  internals.status = 'playing';
  internals.bossId = 'big-release';
  internals.currentSprintKind = options.kind;
  internals.currentSprintId = `q${options.quarterNumber ?? 1}-${options.kind}`;
  internals.org = org;
  internals.budget = options.budget ?? 10;
  internals.totals = totals;
  internals.quarterTotals = quarterTotals;
  internals.quarterGoal = options.quarterGoal ?? goal();
  internals.quarterNumber = options.quarterNumber ?? 1;
  internals.stakeholderTrust = options.stakeholderTrust ?? trust();
  internals.sprint = completeSprint(org, options.metrics);
  internals.sprintBaselineInput = null;
  internals.teams = [
    singleActiveTeam(
      internals.teams.find((team) => team.id === internals.activeTeamId) ?? internals.teams[0]!,
      org,
    ),
  ];
  return internals;
};

describe('RI-72-D4 engine outcome / quarterReview entry', () => {
  it('通常スプリントは敗北しきい値未満なら result、Tech Debt が 90 ちょうどで lost へ入る', () => {
    const safe = new RunEngine({ seed: 'ri-72-d4-normal-safe', difficulty: 'easy' });
    arrangeResolvedSprint(safe, {
      kind: 'normal',
      org: { techDebt: TECH_DEBT_CAP - 1, morale: 2, seniorHp: 2 },
      budget: 1,
    }).resolveSprint();

    expect(safe.snapshot()).toMatchObject({
      phase: 'result',
      status: 'playing',
      loseReason: undefined,
    });

    const lost = new RunEngine({ seed: 'ri-72-d4-normal-lost', difficulty: 'easy' });
    arrangeResolvedSprint(lost, {
      kind: 'normal',
      org: { techDebt: TECH_DEBT_CAP, morale: 2, seniorHp: 2 },
      budget: 1,
    }).resolveSprint();

    expect(lost.snapshot()).toMatchObject({
      phase: 'lost',
      status: 'lost',
      loseReason: 'techDebt',
    });
  });

  it('ボススプリントでも即時敗北条件が先に成立すると quarterReview を作らず lost へ入る', () => {
    const engine = new RunEngine({ seed: 'ri-72-d4-boss-lost-first', difficulty: 'easy' });
    arrangeResolvedSprint(engine, {
      kind: 'boss',
      org: { aiDependency: 95, aiLiteracy: AI_LITERACY_UNSAFE_CAP },
      metrics: { delivered: 90, doneCount: 1, completedCount: 1 },
      budget: 1,
    }).resolveSprint();

    const state = engine.snapshot();
    expect(state.phase).toBe('lost');
    expect(state.status).toBe('lost');
    expect(state.loseReason).toBe('aiDependency');
    expect(state.quarterReview).toBeNull();
    expect(state.reviewHistory).toEqual([]);
  });

  it('ボス突破かつKPIが目標値ちょうどなら met の quarterReview へ入り、勝利は承認まで保留する', () => {
    const engine = new RunEngine({ seed: 'ri-72-d4-boss-met', difficulty: 'easy' });
    arrangeResolvedSprint(engine, {
      kind: 'boss',
      org: { quality: 50, morale: 45, techDebt: 40 },
      metrics: { delivered: 90, doneCount: 1, completedCount: 1 },
      budget: 10,
    }).resolveSprint();

    const state = engine.snapshot();
    expect(state.phase).toBe('quarterReview');
    expect(state.status).toBe('playing');
    expect(state.quarterReview).toMatchObject({
      bossCleared: true,
      outcome: 'met',
    });
    expect(
      state.quarterReview?.progress.map(({ id, actual, target, status }) => ({
        id,
        actual,
        target,
        status,
      })),
    ).toEqual([
      { id: 'delivery', actual: 90, target: 90, status: 'met' },
      { id: 'quality', actual: 50, target: 50, status: 'met' },
      { id: 'techDebt', actual: 40, target: 40, status: 'met' },
      { id: 'morale', actual: 45, target: 45, status: 'met' },
      { id: 'incident', actual: 0, target: 2, status: 'exceeded' },
    ]);
    expect(state.reviewHistory).toEqual(['met']);
    expect(state.winType).toBeUndefined();
  });

  it('ボス突破失敗でも即時敗北でなければ missed_adjustable の quarterReview へ入る', () => {
    const engine = new RunEngine({ seed: 'ri-72-d4-boss-missed-adjustable', difficulty: 'easy' });
    arrangeResolvedSprint(engine, {
      kind: 'boss',
      org: { quality: 50, morale: 45, techDebt: 40 },
      metrics: { delivered: 76, doneCount: 1, completedCount: 1 },
      quarterGoal: { ...goal(), deliveryTarget: 70 },
      budget: 10,
    }).resolveSprint();

    const state = engine.snapshot();
    expect(state.phase).toBe('quarterReview');
    expect(state.status).toBe('playing');
    expect(state.quarterReview).toMatchObject({
      bossCleared: false,
      outcome: 'missed_adjustable',
    });
    expect(state.bossRelicReward).toBeUndefined();
    expect(state.reviewHistory).toEqual(['missed_adjustable']);
  });

  it('quarterReview の met 承認で won へ入り、固定入力の勝利種別を記録する', () => {
    const engine = new RunEngine({ seed: 'ri-72-d4-ack-win', difficulty: 'easy' });
    engine.startRun('easy', [], 'ri-72-d4-ack-win');
    const internals = asInternals(engine);
    const org = makeOrg({ quality: 50, morale: 50, seniorHp: 30 });
    const totals: RunTotals = {
      ...zeroTotals(),
      delivered: 100,
      done: 10,
      rework: 3,
      spread: 1,
      completed: 10,
    };
    internals.phase = 'quarterReview';
    internals.org = org;
    internals.totals = totals;
    internals.budget = 10;
    internals.usedHeavyActions = true;
    internals.quarterReview = makeReview('met');
    internals.winEvalOrg = null;

    engine.acknowledgeQuarterReview();

    expect(engine.snapshot()).toMatchObject({
      phase: 'won',
      status: 'won',
      winType: evaluateWinType({
        org,
        totals,
        budget: 10,
        usedHeavyActions: true,
      }),
    });
  });

  it('quarterReview の継続不能 outcome は loseReason を固定マッピングして lost へ入る', () => {
    const cases: Array<[QuarterOutcome, RunState['loseReason']]> = [
      ['shutdown', 'trustExhausted'],
      ['missed_crisis', 'kpiMissed'],
      ['reorg_required', 'reorgRequired'],
    ];

    for (const [outcome, loseReason] of cases) {
      const engine = new RunEngine({ seed: `ri-72-d4-ack-${outcome}`, difficulty: 'easy' });
      engine.startRun('easy', [], `ri-72-d4-ack-${outcome}`);
      const internals = asInternals(engine);
      internals.phase = 'quarterReview';
      internals.quarterReview = makeReview(outcome);

      engine.acknowledgeQuarterReview();

      expect(engine.snapshot()).toMatchObject({
        phase: 'lost',
        status: 'lost',
        loseReason,
      });
    }
  });

  it('quarterReview の missed_adjustable 承認は勝敗を確定せず同じ phase に残る', () => {
    const engine = new RunEngine({ seed: 'ri-72-d4-ack-adjustable', difficulty: 'easy' });
    engine.startRun('easy', [], 'ri-72-d4-ack-adjustable');
    const internals = asInternals(engine);
    internals.phase = 'quarterReview';
    internals.quarterReview = makeReview('missed_adjustable');

    engine.acknowledgeQuarterReview();

    expect(engine.snapshot()).toMatchObject({
      phase: 'quarterReview',
      status: 'playing',
      winType: undefined,
      loseReason: undefined,
    });
  });
});

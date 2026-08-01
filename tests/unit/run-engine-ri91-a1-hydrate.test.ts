import { afterEach, describe, expect, it } from 'vitest';
import { BOSS_DEFS } from '../../src/data/bosses';
import { getDifficulty } from '../../src/data/difficulties';
import { createInitialRoster } from '../../src/sim/member';
import { ENTER_TEAM_FOCUS_PENALTY } from '../../src/sim/orgscale/teamState';
import type { TeamRunState } from '../../src/sim/orgscale/types';
import { createRng } from '../../src/sim/rng';
import { RunEngine } from '../../src/sim/run/engine';
import type { BeatState, RunState, RunTotals, SprintModifierDelta } from '../../src/sim/run/types';
import { createSprint } from '../../src/sim/sprint';
import type { OrgState, SprintMetrics, SprintState } from '../../src/sim/types';

type A1Internals = {
  beat: BeatState | null;
  budget: number;
  currentSprintId: string | null;
  currentSprintKind: RunState['currentSprintKind'];
  org: OrgState;
  pendingSprintModifiers: SprintModifierDelta;
  phase: RunState['phase'];
  quarterTotals: RunTotals;
  sprint: SprintState | null;
  sprintBaselineInput: unknown;
  status: RunState['status'];
  teams: TeamRunState[];
  totals: RunTotals;
  resolveSprint(): void;
};

const asInternals = (engine: RunEngine): A1Internals => engine as unknown as A1Internals;

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

const completeSprint = (org: OrgState, metrics: Partial<SprintMetrics> = {}): SprintState => {
  const sprint = createSprint(
    { taskCount: 0, codingSlots: 1, maxTicks: 1, focusMax: 3 },
    org,
    createRng('ri-91-a1-fixed-sprint'),
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
    metrics?: Partial<SprintMetrics>;
    totals?: Partial<RunTotals>;
    quarterTotals?: Partial<RunTotals>;
  } = {},
): A1Internals => {
  engine.startRun('easy', [], 'ri-91-a1-totals');
  const internals = asInternals(engine);
  const org = makeOrg();
  internals.phase = 'sprint';
  internals.status = 'playing';
  internals.currentSprintKind = 'normal';
  internals.currentSprintId = 'q1-s1';
  internals.org = org;
  internals.totals = { ...zeroTotals(), ...options.totals };
  internals.quarterTotals = { ...zeroTotals(), ...options.quarterTotals };
  internals.sprint = completeSprint(org, options.metrics);
  internals.sprintBaselineInput = null;
  return internals;
};

const savedBossDefs: typeof BOSS_DEFS = [];

afterEach(() => {
  if (savedBossDefs.length > 0) {
    BOSS_DEFS.splice(0, BOSS_DEFS.length, ...savedBossDefs);
    savedBossDefs.length = 0;
  }
});

describe('RI-91-A1 RunEngine construct / hydrate helpers', () => {
  it('コンストラクタ既定は trials 空・difficulty normal・roster が seed 由来', () => {
    const seed = 'ri-91-a1-ctor';
    const engine = new RunEngine({ seed });
    const snap = engine.snapshot();
    expect(snap.trials).toEqual([]);
    expect(snap.difficulty).toBe('normal');
    expect(snap.phase).toBe('title');
    expect(snap.status).toBe('playing');
    expect(snap.runKind).toBe('normal');
    expect(snap.pendingSprintKind).toBe('normal');
    expect(snap.currentSprintKind).toBe('normal');
    expect(snap.roster).toEqual(createInitialRoster(createRng(`${seed}:roster`)));
    expect(snap.deck).toEqual([]);
    expect(snap.relics).toEqual([]);
    expect(snap.goalAdjustmentsTaken).toEqual([]);
    expect(snap.reviewHistory).toEqual([]);
    expect(snap.usedHeavyActions).toBe(false);
    expect(snap.zoom).toEqual({ level: 'team', deptId: null, teamId: null });
    expect(snap.rankingKind).toBe('overall');
    expect(snap.diagnosis).toBe('healthyAcceleration');
  });

  it('setPreferredCards は配列と Set の両方を永続 extras へ残す', () => {
    const fromArray = new RunEngine({ seed: 'ri-91-a1-pref-array' });
    fromArray.setPreferredCards(['docs', 'auto-test']);
    fromArray.startRun('normal', [], 'ri-91-a1-pref-array');
    expect(fromArray.exportPersistState()?.extras.preferredCardIds).toEqual(['docs', 'auto-test']);

    const fromSet = new RunEngine({ seed: 'ri-91-a1-pref-set' });
    fromSet.setPreferredCards(new Set(['copilot', 'docs']));
    fromSet.startRun('normal', [], 'ri-91-a1-pref-set');
    expect(fromSet.exportPersistState()?.extras.preferredCardIds).toEqual(['copilot', 'docs']);
  });

  it('toTitle は seed 省略時に既存 seed を保持し、指定時だけ差し替える', () => {
    const engine = new RunEngine({ seed: 'ri-91-a1-title-keep' });
    engine.startRun('normal', [], 'ri-91-a1-title-keep');
    engine.toTitle();
    expect(engine.snapshot()).toMatchObject({
      seed: 'ri-91-a1-title-keep',
      phase: 'title',
      currentSprintKind: 'normal',
      pendingSprintKind: 'normal',
    });

    engine.toTitle('ri-91-a1-title-new');
    expect(engine.snapshot().seed).toBe('ri-91-a1-title-new');
  });

  it('initRun の初期予算は試練 budgetMul を積算する', () => {
    const base = new RunEngine({ seed: 'ri-91-a1-budget-base', difficulty: 'normal' });
    base.startRun('normal', [], 'ri-91-a1-budget-base');
    const half = new RunEngine({ seed: 'ri-91-a1-budget-half', difficulty: 'normal' });
    half.startRun('normal', ['half-budget'], 'ri-91-a1-budget-half');

    const startBudget = getDifficulty('normal').startBudget;
    expect(base.snapshot().budget).toBe(Math.round(startBudget));
    expect(half.snapshot().budget).toBe(Math.round(startBudget * 0.5));
    expect(half.snapshot().budget).toBeLessThan(base.snapshot().budget);
  });

  it('boss 定義が空のとき四半期ゴールはフォールバック定数を使う', () => {
    savedBossDefs.push(...BOSS_DEFS);
    BOSS_DEFS.splice(0, BOSS_DEFS.length);

    const engine = new RunEngine({ seed: 'ri-91-a1-boss-fallback', difficulty: 'normal' });
    engine.startRun('normal', [], 'ri-91-a1-boss-fallback');
    expect(engine.snapshot().quarterGoal).toEqual({
      deliveryTarget: 60,
      qualityTarget: 45,
      techDebtLimit: 55,
      moraleTarget: 40,
      incidentLimit: 6,
    });
  });

  it('mergeModifiers は加算・乗算とゼロ省略を固定入力で保持する', () => {
    const engine = new RunEngine({ seed: 'ri-91-a1-merge', difficulty: 'easy' });
    engine.startRun('easy', [], 'ri-91-a1-merge');
    const i = asInternals(engine);
    // launchSprint で消費されないよう、merge 直後に予算尽きで lost へ落とす。
    i.budget = 0;

    i.phase = 'beat';
    i.pendingSprintModifiers = { reviewLoadAdd: 3, reworkRateAdd: 0.1 };
    i.beat = { eventId: 'giant-ai-pr-judgment', kind: 'judgment' };
    engine.resolveBeat();
    expect(engine.snapshot().phase).toBe('lost');
    expect(i.pendingSprintModifiers).toEqual({
      reviewLoadAdd: 7,
      reworkRateAdd: 0.1,
    });
    expect(i.pendingSprintModifiers.taskCountMul).toBeUndefined();

    // 再スタートして 2 段 merge（review + rework）を確認する。
    engine.startRun('easy', [], 'ri-91-a1-merge-2');
    i.budget = 0;
    i.phase = 'beat';
    i.pendingSprintModifiers = { reviewLoadAdd: 7, reworkRateAdd: 0.1 };
    i.beat = { eventId: 'hallucinated-api', kind: 'judgment' };
    engine.resolveBeat();
    expect(i.pendingSprintModifiers).toEqual({
      reviewLoadAdd: 7,
      reworkRateAdd: 0.25,
    });

    engine.startRun('easy', [], 'ri-91-a1-merge-3');
    i.budget = 0;
    i.phase = 'beat';
    i.pendingSprintModifiers = { taskCountMul: 0.7 };
    i.beat = { eventId: 'giant-ai-pr-judgment', kind: 'judgment' };
    engine.resolveBeat();
    expect(i.pendingSprintModifiers).toEqual({
      reviewLoadAdd: 4,
      taskCountMul: 0.7,
    });

    // enterTeam の focusMaxAdd 合成は playing 中に確認する。
    engine.startRun('easy', [], 'ri-91-a1-merge-enter');
    i.pendingSprintModifiers = { reviewLoadAdd: 4, taskCountMul: 0.7 };
    const other = engine.snapshot().teams.find((t) => t.id !== engine.snapshot().activeTeamId)!;
    expect(engine.enterTeam(other.id)).toBe(true);
    expect(engine.snapshot().pendingSprintModifiers).toEqual({
      reviewLoadAdd: 4,
      taskCountMul: 0.7,
      focusMaxAdd: ENTER_TEAM_FOCUS_PENALTY,
    });
  });

  it('addSprintTotals は加算・maxCombo・連続炎上カウンタを区別する', () => {
    const withSpread = new RunEngine({ seed: 'ri-91-a1-totals-spread', difficulty: 'easy' });
    arrangeResolvedSprint(withSpread, {
      totals: {
        done: 10,
        contained: 2,
        spread: 1,
        completed: 5,
        maxCombo: 3,
        reviewQueuePeak: 2,
        consecutiveIncidentSprints: 2,
        aiAssisted: 1,
      },
      metrics: {
        doneCount: 4,
        contained: 3,
        spread: 2,
        completedCount: 6,
        aiAssistedCompleted: 2,
        maxCombo: 8,
        reviewQueueMax: 5,
        delivered: 12,
        reworkCount: 1,
        incidentCount: 2,
      },
    }).resolveSprint();

    // advanceOtherTeams が delivered/completed/aiAssisted をさらに積むため、
    // addSprintTotals 固有の演算だけを厳密に固定する。
    expect(withSpread.snapshot().totals).toMatchObject({
      done: 14,
      contained: 5,
      spread: 3,
      maxCombo: 8,
      reviewQueuePeak: 5,
      consecutiveIncidentSprints: 3,
    });
    expect(withSpread.snapshot().totals.completed).toBeGreaterThanOrEqual(11);
    expect(withSpread.snapshot().totals.aiAssisted).toBeGreaterThanOrEqual(3);
    expect(withSpread.snapshot().quarterTotals).toMatchObject({
      done: 4,
      contained: 3,
      spread: 2,
      consecutiveIncidentSprints: 1,
      maxCombo: 8,
    });

    const reset = new RunEngine({ seed: 'ri-91-a1-totals-reset', difficulty: 'easy' });
    arrangeResolvedSprint(reset, {
      totals: { consecutiveIncidentSprints: 4, maxCombo: 9 },
      metrics: { spread: 0, maxCombo: 2, doneCount: 1, completedCount: 1 },
    }).resolveSprint();
    expect(reset.snapshot().totals).toMatchObject({
      consecutiveIncidentSprints: 0,
      maxCombo: 9,
      done: 1,
    });
  });

  it('hydratePersistState は preferredCards・sprintKind・modifiers を副作用付きで復元する', () => {
    const source = new RunEngine({ seed: 'ri-91-a1-hydrate-src', difficulty: 'normal' });
    source.setPreferredCards(['docs']);
    source.startRun('normal', ['half-budget'], 'ri-91-a1-hydrate-src', {
      kind: 'daily',
      dailyDate: '2026-08-01',
    });
    const state = source.exportPersistState();
    if (!state) throw new Error('expected exportable save');
    state.pendingSprintKind = 'elite';
    state.currentSprintKind = 'elite';
    state.pendingSprintModifiers = { reviewLoadAdd: 2, reworkRateAdd: 0.05, taskCountMul: 0.8 };
    state.phase = 'draft';
    state.draft = ['docs'];

    const restored = new RunEngine({ seed: 'ri-91-a1-hydrate-dst' });
    restored.setPreferredCards(['copilot']);
    restored.startRun('easy', [], 'ri-91-a1-hydrate-dst');
    restored.hydratePersistState(state);

    const snap = restored.snapshot();
    expect(snap).toMatchObject({
      seed: 'ri-91-a1-hydrate-src',
      difficulty: 'normal',
      trials: ['half-budget'],
      runKind: 'daily',
      dailyDate: '2026-08-01',
      phase: 'draft',
      pendingSprintKind: 'elite',
      currentSprintKind: 'elite',
      pendingSprintModifiers: { reviewLoadAdd: 2, reworkRateAdd: 0.05, taskCountMul: 0.8 },
      draft: ['docs'],
    });
    expect(restored.exportPersistState()?.extras.preferredCardIds).toEqual(['docs']);
    expect(snap.budget).toBe(Math.round(getDifficulty('normal').startBudget * 0.5));
  });
});

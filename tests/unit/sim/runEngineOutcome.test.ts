/**
 * RunEngine の勝敗確定（outcome / quarterReview）と persist / snapshot まわりの
 * ミューテーション回帰テスト。Stryker の Survived / NoCoverage mutation を
 * exact 断言で潰す（旧 RI-72-D4 / RI-91-A6）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEvolutionNode } from '../../../src/data/evolution';
import type { CardInstance } from '../../../src/sim/cards';
import type { RosterState } from '../../../src/sim/member';
import { AI_LITERACY_UNSAFE_CAP, TECH_DEBT_CAP, evaluateWinType } from '../../../src/sim/outcome';
import {
  HOME_TEAM_ID,
  emptyAdjust,
  emptyAdjustState,
  type TeamRunState,
} from '../../../src/sim/orgscale';
import { deriveTeamCapacities } from '../../../src/sim/orgscale/teamState';
import { RunEngine } from '../../../src/sim/run/engine';
import type { RunPersistState, RunReplayFrame } from '../../../src/sim/run/persist';
import type {
  GoalAdjustmentId,
  QuarterGoal,
  QuarterOutcome,
  QuarterReview,
  RunState,
  RunTotals,
  StakeholderTrust,
} from '../../../src/sim/run/types';
import type { OrgState, SprintMetrics, SprintState } from '../../../src/sim/types';
import {
  completeSprint as completeSprintWith,
  makeOrg,
  zeroTotals,
} from '../helpers/runEngineFixtures';

const initTeamMock = vi.hoisted(() => ({
  mode: 'passthrough' as 'passthrough' | 'emptyFirst' | 'homeNotFirst' | 'noHome',
  calls: 0,
}));

const appendSpy = vi.hoisted(() => ({
  templateId: null as string | null,
  templateQuality: null as number | null,
  newIds: [] as string[],
}));

vi.mock('../../../src/sim/orgscale', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/sim/orgscale')>();
  return {
    ...actual,
    initTeamRunStates: (args: Parameters<typeof actual.initTeamRunStates>[0]) => {
      initTeamMock.calls += 1;
      if (initTeamMock.mode === 'emptyFirst' && initTeamMock.calls === 1) {
        return [];
      }
      const teams = actual.initTeamRunStates(args);
      if (initTeamMock.mode === 'homeNotFirst') {
        const home = teams.find((t) => t.id === actual.HOME_TEAM_ID);
        const others = teams.filter((t) => t.id !== actual.HOME_TEAM_ID);
        if (!home || others.length === 0) return teams;
        const markedOthers = others.map((t, idx) =>
          idx === 0 ? { ...t, quality: 11, name: 'NOT-HOME-TEMPLATE' } : t,
        );
        return [...markedOthers, { ...home, quality: 77, name: 'HOME-TEMPLATE' }];
      }
      if (initTeamMock.mode === 'noHome') {
        return teams
          .filter((t) => t.id !== actual.HOME_TEAM_ID)
          .map((t, idx) => (idx === 0 ? { ...t, quality: 33, morale: 22 } : t));
      }
      return teams;
    },
    appendTeamsToDept: (
      teams: TeamRunState[],
      args: Parameters<typeof actual.appendTeamsToDept>[1],
    ) => {
      const before = new Set(teams.map((t) => t.id));
      appendSpy.templateId = args.template.id;
      appendSpy.templateQuality = args.template.quality;
      const next = actual.appendTeamsToDept(teams, args);
      appendSpy.newIds = next.filter((t) => !before.has(t.id)).map((t) => t.id);
      return next;
    },
  };
});

type EngineInternals = {
  bossId: string;
  budget: number;
  currentSprintId: string | null;
  currentSprintKind: RunState['currentSprintKind'];
  diagnosis: RunState['diagnosis'];
  quarterNumber: number;
  sprint: SprintState | null;
  sprintBaselineInput: unknown;
  resolveSprint(): void;
  deck: CardInstance[];
  evolution: RunState['evolution'];
  goalAdjustmentsTaken: GoalAdjustmentId[];
  org: OrgState;
  orgAdjust: ReturnType<typeof emptyAdjustState>;
  phase: RunState['phase'];
  quarterGoal: QuarterGoal;
  quarterReview: QuarterReview | null;
  quarterTotals: RunTotals;
  relics: string[];
  reviewHistory: QuarterOutcome[];
  roster: RosterState;
  status: RunState['status'];
  stakeholderTrust: StakeholderTrust;
  totals: RunTotals;
  usedHeavyActions: boolean;
  winEvalOrg: OrgState | null;
  winType: RunState['winType'];
  loseReason: RunState['loseReason'];
  bossRelicReward: RunState['bossRelicReward'];
  pendingSprintModifiers: RunState['pendingSprintModifiers'];
  zoom: RunState['zoom'];
  teams: TeamRunState[];
  activeTeamId: string;
  homeTeamId: string;
};

const asInternals = (engine: RunEngine): EngineInternals => engine as unknown as EngineInternals;

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
  missedReasons: outcome === 'shutdown' ? ['trust'] : [],
  availableAdjustments: outcome === 'missed_adjustable' ? ['cut_scope'] : [],
  bossCleared: outcome === 'met' || outcome === 'exceeded',
});

function createEngine(
  seed: string,
  options: {
    allowedCards?: ReadonlySet<string>;
    allowedRelics?: ReadonlySet<string>;
  } = {},
): RunEngine {
  const engine = new RunEngine({
    seed,
    difficulty: 'normal',
    allowedCards: options.allowedCards ?? new Set(['docs', 'auto-test']),
    allowedRelics: options.allowedRelics ?? new Set(['postmortem']),
  });
  engine.startRun('normal', ['half-budget'], seed, {
    kind: 'daily',
    dailyDate: '2026-08-02',
  });
  return engine;
}

function setupPersist(seed: string): RunPersistState {
  const state = createEngine(seed).exportPersistState();
  if (!state) throw new Error('expected exportable persist state');
  return state;
}

function asReplayFrame(state: RunPersistState, patch: Partial<RunState> = {}): RunReplayFrame {
  return { ...structuredClone(state), ...patch } as RunReplayFrame;
}

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

/** このファイル固定 seed を束ねた共通フィクスチャの別名。 */
const completeSprint = (org: OrgState, metrics: Partial<SprintMetrics> = {}): SprintState =>
  completeSprintWith('ri-72-d4-fixed-sprint', org, metrics);

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
): EngineInternals => {
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

afterEach(() => {
  initTeamMock.mode = 'passthrough';
  initTeamMock.calls = 0;
  appendSpy.templateId = null;
  appendSpy.templateQuality = null;
  appendSpy.newIds = [];
});

describe('RI-91-A6 victory / defeat persist & snapshot fields', () => {
  it('won の exportReplayFrame / snapshot は勝敗サマリの必須フィールドを exact 保持する', () => {
    const engine = createEngine('ri-91-a6-won');
    engine.setPreferredCards(['docs', 'auto-test']);
    const i = asInternals(engine);
    const org = makeOrg({
      quality: 70,
      securityLevel: 55,
      morale: 70,
      seniorHp: 65,
      aiLiteracy: 50,
      testCoverage: 40,
      documentation: 40,
    });
    const totals: RunTotals = {
      ...zeroTotals(),
      delivered: 120,
      done: 20,
      rework: 2,
      completed: 20,
      aiAssisted: 4,
      maxCombo: 5,
      reviewQueuePeak: 3,
    };
    i.phase = 'quarterReview';
    i.org = org;
    i.totals = totals;
    i.quarterTotals = { ...totals, delivered: 90 };
    i.budget = 42;
    i.usedHeavyActions = false;
    i.quarterReview = makeReview('exceeded');
    i.winEvalOrg = null;
    i.relics = ['postmortem'];
    i.bossRelicReward = 'small-pr';
    i.goalAdjustmentsTaken = ['cut_scope', 'quality_pivot'];
    i.reviewHistory = ['met', 'exceeded'];
    i.pendingSprintModifiers = { focusMaxAdd: -2, reviewLoadAdd: 3 };
    i.quarterGoal = goal();
    i.stakeholderTrust = trust(72);
    i.zoom = { level: 'company', deptId: null, teamId: null };
    i.evolution = { points: 2, unlocked: { 'dev-1': true } };

    engine.acknowledgeQuarterReview();

    const expectedWin = evaluateWinType({
      org,
      totals,
      budget: 42,
      usedHeavyActions: false,
    });
    expect(expectedWin).toBe('noDamage');

    const frame = engine.exportReplayFrame();
    expect(frame).not.toBeNull();
    expect(frame).toMatchObject({
      seed: 'ri-91-a6-won',
      difficulty: 'normal',
      trials: ['half-budget'],
      runKind: 'daily',
      dailyDate: '2026-08-02',
      phase: 'won',
      status: 'won',
      winType: 'noDamage',
      loseReason: undefined,
      bossRelicReward: 'small-pr',
      whatIfStatus: 'idle',
      whatIf: null,
      sprint: null,
      sprintTick: 0,
      orgScale: null,
      industry: null,
    });
    expect(frame!.trials).toEqual(['half-budget']);
    expect(frame!.relics).toEqual(['postmortem']);
    expect(frame!.goalAdjustmentsTaken).toEqual(['cut_scope', 'quality_pivot']);
    expect(frame!.reviewHistory).toEqual(['met', 'exceeded']);
    expect(frame!.pendingSprintModifiers).toEqual({ focusMaxAdd: -2, reviewLoadAdd: 3 });
    expect(frame!.evolution).toEqual({ points: 2, unlocked: { 'dev-1': true } });
    expect(frame!.totals).toEqual(totals);
    expect(frame!.quarterTotals).toEqual({ ...totals, delivered: 90 });
    expect(frame!.quarterGoal).toEqual(goal());
    expect(frame!.stakeholderTrust).toEqual(trust(72));
    expect(frame!.zoom).toEqual({ level: 'company', deptId: null, teamId: null });
    expect(Object.keys(frame!.extras).sort()).toEqual(
      [
        'activeTeamId',
        'allowedCards',
        'allowedRelics',
        'baseConfig',
        'coarseIncidentCarry',
        'coarseSecurityTrustCount',
        'coarseSecurityTrustRaw',
        'draftMulliganUsed',
        'goalCarryoverId',
        'goalCarryoverQuarter',
        'homeTeamId',
        'nextBudgetCap',
        'orgAdjust',
        'pauseAiDebuffQuarter',
        'preferredCardIds',
        'scenario',
        'teamLockUntilSprint',
        'teamRosters',
        'teams',
        'winEvalOrg',
      ].sort(),
    );
    expect(frame!.extras.allowedCards.sort()).toEqual(['auto-test', 'docs']);
    expect(frame!.extras.allowedRelics).toEqual(['postmortem']);
    expect(frame!.extras.preferredCardIds).toEqual(['docs', 'auto-test']);
    expect(frame!.scenario).toBe('default');
    expect(frame!.extras.scenario).toBe('default');

    // snapshot 側も非空 ObjectLiteral を exact 断言（frame だけの検査だと Survived になる）。
    const snapBeforeMutate = engine.snapshot();
    expect(snapBeforeMutate).toMatchObject({
      phase: 'won',
      status: 'won',
      winType: 'noDamage',
      loseReason: undefined,
      bossRelicReward: 'small-pr',
      whatIfStatus: 'idle',
    });
    expect(snapBeforeMutate.trials).toEqual(['half-budget']);
    expect(snapBeforeMutate.relics).toEqual(['postmortem']);
    expect(snapBeforeMutate.goalAdjustmentsTaken).toEqual(['cut_scope', 'quality_pivot']);
    expect(snapBeforeMutate.reviewHistory).toEqual(['met', 'exceeded']);
    expect(snapBeforeMutate.pendingSprintModifiers).toEqual({ focusMaxAdd: -2, reviewLoadAdd: 3 });
    expect(snapBeforeMutate.quarterTotals).toEqual({ ...totals, delivered: 90 });
    expect(snapBeforeMutate.stakeholderTrust).toEqual(trust(72));
    expect(snapBeforeMutate.quarterGoal).toEqual(goal());
    expect(snapBeforeMutate.evolution).toEqual({ points: 2, unlocked: { 'dev-1': true } });

    // clone 独立性: source を壊しても frame は不変。
    i.relics.push('mutated');
    i.reviewHistory.push('shutdown');
    i.goalAdjustmentsTaken.push('reorg_teams');
    i.pendingSprintModifiers.focusMaxAdd = 99;
    i.evolution.unlocked['dev-2'] = true;
    expect(frame!.relics).toEqual(['postmortem']);
    expect(frame!.reviewHistory).toEqual(['met', 'exceeded']);
    expect(frame!.goalAdjustmentsTaken).toEqual(['cut_scope', 'quality_pivot']);
    expect(frame!.pendingSprintModifiers).toEqual({ focusMaxAdd: -2, reviewLoadAdd: 3 });
    expect(frame!.evolution).toEqual({ points: 2, unlocked: { 'dev-1': true } });
  });

  it('lost の exportReplayFrame / snapshot は loseReason と空でない履歴配列を exact 保持する', () => {
    const engine = createEngine('ri-91-a6-lost');
    const i = asInternals(engine);
    i.phase = 'quarterReview';
    i.quarterReview = makeReview('shutdown');
    i.relics = ['postmortem'];
    i.goalAdjustmentsTaken = ['request_budget'];
    i.reviewHistory = ['missed_crisis', 'shutdown'];
    i.pendingSprintModifiers = { reworkRateAdd: 0.1 };
    i.totals = { ...zeroTotals(), delivered: 10, incidents: 4 };
    i.quarterTotals = { ...zeroTotals(), delivered: 8, incidents: 2 };
    i.quarterGoal = goal();
    i.stakeholderTrust = trust(12);
    i.zoom = { level: 'team', deptId: 'product', teamId: HOME_TEAM_ID };

    engine.acknowledgeQuarterReview();

    const frame = engine.exportReplayFrame();
    expect(frame).toMatchObject({
      phase: 'lost',
      status: 'lost',
      loseReason: 'trustExhausted',
      winType: undefined,
      whatIfStatus: 'idle',
    });
    expect(frame!.relics).toEqual(['postmortem']);
    expect(frame!.goalAdjustmentsTaken).toEqual(['request_budget']);
    expect(frame!.reviewHistory).toEqual(['missed_crisis', 'shutdown']);
    expect(frame!.pendingSprintModifiers).toEqual({ reworkRateAdd: 0.1 });
    expect(frame!.totals).toEqual({ ...zeroTotals(), delivered: 10, incidents: 4 });
    expect(frame!.quarterTotals).toEqual({ ...zeroTotals(), delivered: 8, incidents: 2 });
    expect(frame!.stakeholderTrust).toEqual(trust(12));
    expect(frame!.zoom).toEqual({ level: 'team', deptId: 'product', teamId: HOME_TEAM_ID });
    expect(frame!.extras.preferredCardIds).toEqual([]);
    expect(frame!.extras.allowedCards.sort()).toEqual(['auto-test', 'docs']);
    expect(frame!.extras.allowedRelics).toEqual(['postmortem']);

    const snap = engine.snapshot();
    expect(snap.phase).toBe('lost');
    expect(snap.status).toBe('lost');
    expect(snap.loseReason).toBe('trustExhausted');
    expect(snap.winType).toBeUndefined();
    expect(snap.reviewHistory).toEqual(['missed_crisis', 'shutdown']);
    expect(snap.goalAdjustmentsTaken).toEqual(['request_budget']);
    expect(snap.relics).toEqual(['postmortem']);
    expect(snap.pendingSprintModifiers).toEqual({ reworkRateAdd: 0.1 });
    expect(snap.quarterTotals).toEqual({ ...zeroTotals(), delivered: 8, incidents: 2 });
    expect(snap.stakeholderTrust).toEqual(trust(12));
    expect(snap.zoom).toEqual({ level: 'team', deptId: 'product', teamId: HOME_TEAM_ID });
  });

  it('解放プール未指定の RunEngine は extras の allowed* を空配列で保存する', () => {
    const engine = new RunEngine({ seed: 'ri-91-a6-empty-pools', difficulty: 'normal' });
    engine.startRun('normal', [], 'ri-91-a6-empty-pools');
    const persist = engine.exportPersistState();
    expect(persist?.extras.allowedCards).toEqual([]);
    expect(persist?.extras.allowedRelics).toEqual([]);

    const i = asInternals(engine);
    i.phase = 'lost';
    i.status = 'lost';
    i.loseReason = 'budgetExhausted';
    const replay = engine.exportReplayFrame();
    expect(replay?.extras.allowedCards).toEqual([]);
    expect(replay?.extras.allowedRelics).toEqual([]);
  });

  it('hydrateReplayFrame は won 終端の winType / relics / extras を副作用付きで復元する', () => {
    const base = setupPersist('ri-91-a6-hydrate-won-base');
    const won = asReplayFrame(base, {
      phase: 'won',
      status: 'won',
      winType: 'healthy',
      loseReason: undefined,
      relics: ['postmortem', 'small-pr'],
      bossRelicReward: 'small-pr',
      goalAdjustmentsTaken: ['extend_deadline'],
      reviewHistory: ['exceeded'],
      pendingSprintModifiers: { taskCountMul: 0.8 },
      evolution: { points: 1, unlocked: { 'quality-1': true } },
      totals: { ...zeroTotals(), delivered: 200, completed: 30, maxCombo: 9 },
      quarterTotals: { ...zeroTotals(), delivered: 100 },
      quarterGoal: goal(),
      stakeholderTrust: trust(88),
      zoom: { level: 'dept', deptId: 'platform', teamId: null },
    });
    won.extras.preferredCardIds = ['copilot'];
    won.extras.allowedCards = ['docs'];
    won.extras.allowedRelics = ['postmortem'];

    const restored = createEngine('ri-91-a6-hydrate-won-dst');
    restored.setPreferredCards(['auto-test']);
    won.org = makeOrg({ quality: 64, morale: 55, deliveryScore: 40 });
    won.roster = {
      ...won.roster,
      members: won.roster.members.map((m, idx) =>
        idx === 0 ? { ...m, name: 'Hydrate Member' } : m,
      ),
    };
    won.quarterReview = makeReview('exceeded');

    restored.hydrateReplayFrame(won);

    // structuredClone 欠落時に共有されうる直接代入フィールドも改変する。
    const originalOrgQuality = won.org.quality;
    const originalMemberName = won.roster.members[0]!.name;
    const originalReviewOutcome = won.quarterReview!.outcome;
    won.relics.push('leak');
    won.extras.preferredCardIds = ['leaked'];
    won.org.quality = 1;
    won.roster.members[0]!.name = 'Leaked Member';
    won.quarterReview!.outcome = 'shutdown';

    const frame = restored.exportReplayFrame();
    expect(frame).toMatchObject({
      seed: 'ri-91-a6-hydrate-won-base',
      phase: 'won',
      status: 'won',
      winType: 'healthy',
      bossRelicReward: 'small-pr',
      whatIfStatus: 'idle',
    });
    expect(frame!.relics).toEqual(['postmortem', 'small-pr']);
    expect(frame!.goalAdjustmentsTaken).toEqual(['extend_deadline']);
    expect(frame!.reviewHistory).toEqual(['exceeded']);
    expect(frame!.pendingSprintModifiers).toEqual({ taskCountMul: 0.8 });
    expect(frame!.evolution).toEqual({ points: 1, unlocked: { 'quality-1': true } });
    expect(frame!.totals).toEqual({ ...zeroTotals(), delivered: 200, completed: 30, maxCombo: 9 });
    expect(frame!.quarterTotals).toEqual({ ...zeroTotals(), delivered: 100 });
    expect(frame!.quarterGoal).toEqual(goal());
    expect(frame!.stakeholderTrust).toEqual(trust(88));
    expect(frame!.zoom).toEqual({ level: 'dept', deptId: 'platform', teamId: null });
    expect(frame!.org.quality).toBe(originalOrgQuality);
    expect(frame!.roster.members[0]?.name).toBe(originalMemberName);
    expect(frame!.quarterReview?.outcome).toBe(originalReviewOutcome);
    expect(frame!.extras.preferredCardIds).toEqual(['copilot']);
    expect(frame!.extras.allowedCards).toEqual(['docs']);
    expect(frame!.extras.allowedRelics).toEqual(['postmortem']);
    expect(restored.exportPersistState()).toBeNull();
  });
});

describe('RI-91-A6 applyPersistFrame hydrate branches', () => {
  it('extras.teams が空配列なら legacy 枝へ入り modern の activeTeamId を捨てる', () => {
    const legacy = setupPersist('ri-91-a6-empty-teams');
    legacy.extras.teams = [];
    legacy.extras.activeTeamId = 'platform-t1';
    legacy.extras.homeTeamId = 'platform-t1';
    legacy.org.deliveryScore = 15.6;
    legacy.totals.delivered = 99;

    const restored = createEngine('ri-91-a6-empty-teams-dst');
    restored.hydratePersistState(legacy);

    const snap = restored.snapshot();
    expect(snap.activeTeamId).toBe(HOME_TEAM_ID);
    expect(snap.homeTeamId).toBe(HOME_TEAM_ID);
    expect(snap.totals.delivered).toBe(16);
    expect(snap.teams.length).toBeGreaterThan(0);
    expect(snap.teams.some((t) => t.id === HOME_TEAM_ID)).toBe(true);
    // length >= 0 mutation だと空配列を modern 枝へ流し teams が空のまま残る。
    expect(restored.exportPersistState()?.extras.teams?.length).toBeGreaterThan(0);
  });

  it('modern 枝はカスタム home/active と byTeam・teamRosters を保持する', () => {
    const source = createEngine('ri-91-a6-modern-ids');
    expect(source.enterTeam('platform-t1')).toBe(true);
    const state = source.exportPersistState();
    if (!state) throw new Error('expected exportable save');
    state.extras.homeTeamId = 'platform-t1';
    state.extras.activeTeamId = 'platform-t1';
    state.extras.orgAdjust.byTeam = {
      'platform-t1': { ...emptyAdjust(), moraleDelta: -3 },
    };
    const rosterClone = structuredClone(state.extras.teamRosters!['platform-t1']!);
    rosterClone.members[0] = { ...rosterClone.members[0]!, name: 'Custom Active' };
    state.extras.teamRosters = { 'platform-t1': rosterClone };
    // roster 本体も揃えて snapshot と extras の両方を刺す。
    state.roster = structuredClone(rosterClone);

    const restored = createEngine('ri-91-a6-modern-dst');
    restored.hydratePersistState(state);

    const snap = restored.snapshot();
    expect(snap.homeTeamId).toBe('platform-t1');
    expect(snap.activeTeamId).toBe('platform-t1');
    expect(snap.roster.members[0]?.name).toBe('Custom Active');
    const again = restored.exportPersistState();
    expect(again?.extras.homeTeamId).toBe('platform-t1');
    expect(again?.extras.activeTeamId).toBe('platform-t1');
    expect(again?.extras.teamRosters?.['platform-t1']?.members[0]?.name).toBe('Custom Active');
    expect(again?.extras.orgAdjust.byTeam).toEqual({
      'platform-t1': { ...emptyAdjust(), moraleDelta: -3 },
    });
    // byTeam 欠落時だけ {} を埋める。既存値を消す mutation を潰す。
    expect(Object.keys(again?.extras.orgAdjust.byTeam ?? {})).toEqual(['platform-t1']);
  });

  it('legacy + extraTeams で home が teams[0] 以外でも home を template にする', () => {
    const legacy = setupPersist('ri-91-a6-home-not-first');
    // 部分マップあり: migrate は既存非 home を埋めない。newIds だけ継承されることを刺す。
    legacy.deck = [
      {
        defId: 'auto-test',
        level: 1,
        baselineAppliedByTeam: { [HOME_TEAM_ID]: 1 },
      },
    ];
    legacy.extras.orgAdjust.company.extraTeams = 1;
    // syncActiveTeamFromOrg 後の home 指標を distinctive にする。
    legacy.org = makeOrg({ quality: 88, morale: 66, deliveryScore: 12 });
    delete (legacy.extras as { teams?: unknown }).teams;
    delete (legacy.extras as { activeTeamId?: unknown }).activeTeamId;
    delete (legacy.extras as { homeTeamId?: unknown }).homeTeamId;

    const restored = createEngine('ri-91-a6-home-not-first-dst');
    initTeamMock.mode = 'homeNotFirst';
    initTeamMock.calls = 0;
    restored.hydratePersistState(legacy);

    const snap = restored.snapshot();
    expect(snap.teams[0]?.id).not.toBe(HOME_TEAM_ID);
    expect(snap.teams[0]?.quality).toBe(11);
    expect(snap.teams[0]?.name).toBe('NOT-HOME-TEMPLATE');
    const home = snap.teams.find((t) => t.id === HOME_TEAM_ID)!;
    // home は sync で org.quality=88 になる。find 失敗だと template は quality=11。
    expect(home.quality).toBe(88);
    expect(appendSpy.templateId).toBe(HOME_TEAM_ID);
    expect(appendSpy.templateQuality).toBe(88);
    expect(appendSpy.newIds).toHaveLength(1);
    const addedId = appendSpy.newIds[0]!;
    expect(addedId).not.toBe(HOME_TEAM_ID);
    expect(snap.deck[0]?.baselineAppliedByTeam).toEqual({
      [HOME_TEAM_ID]: 1,
      [addedId]: 1,
    });
    // newIds に既存非 home が混ざるとキーが増える。
    expect(snap.deck[0]?.baselineAppliedByTeam).not.toHaveProperty(snap.teams[0]!.id);
    expect(snap.deck[0]?.baselineAppliedByTeam).not.toHaveProperty('[object Object]');
  });

  it('legacy で active が無いとき org を orgFromTeam で上書きしない', () => {
    const legacy = setupPersist('ri-91-a6-no-active');
    legacy.org = makeOrg({ quality: 91, morale: 17, deliveryScore: 44 });
    legacy.extras.orgAdjust.company.extraTeams = 0;
    delete (legacy.extras as { teams?: unknown }).teams;

    const restored = createEngine('ri-91-a6-no-active-dst');
    initTeamMock.mode = 'noHome';
    initTeamMock.calls = 0;
    restored.hydratePersistState(legacy);

    const snap = restored.snapshot();
    expect(snap.teams.some((t) => t.id === HOME_TEAM_ID)).toBe(false);
    expect(snap.activeTeamId).toBe(HOME_TEAM_ID);
    // active 欠落時は save の org を維持する。
    expect(snap.org.quality).toBe(91);
    expect(snap.org.morale).toBe(17);
    expect(snap.totals.delivered).toBe(44);
  });

  it('legacy + active ありでは org を調整後の active チームから再構築する', () => {
    const legacy = setupPersist('ri-91-a6-active-org');
    // sync 後に applyEffectToTeam で morale だけ差し、orgFromTeam で戻ることを観測する。
    legacy.org = makeOrg({ quality: 73, morale: 61, deliveryScore: 19, techDebt: 28 });
    legacy.extras.orgAdjust.company.extraTeams = 0;
    legacy.extras.orgAdjust.company.moraleDelta = -15;
    delete (legacy.extras as { teams?: unknown }).teams;

    const restored = createEngine('ri-91-a6-active-org-dst');
    restored.hydratePersistState(legacy);

    const snap = restored.snapshot();
    const home = snap.teams.find((t) => t.id === HOME_TEAM_ID)!;
    expect(home.morale).toBe(46);
    expect(snap.org.morale).toBe(46);
    expect(snap.org.morale).not.toBe(61);
    expect(snap.org.quality).toBe(73);
    expect(snap.org.techDebt).toBe(28);
    expect(snap.org.deliveryScore).toBe(19);
    // 指標差分は焼き込み後に strip される。
    expect(restored.exportPersistState()?.extras.orgAdjust.company.moraleDelta).toBe(0);
  });
});

describe('RI-91-A6 NoCoverage L2002 initTeamRunStates fallback', () => {
  it('teams が空のまま extraTeams>0 なら第三項 initTeamRunStates を template に使う', () => {
    const legacy = setupPersist('ri-91-a6-l2002');
    legacy.deck = [{ defId: 'docs', level: 1, baselineAppliedLevel: 1 }];
    legacy.extras.orgAdjust.company.extraTeams = 2;
    legacy.org = makeOrg({ quality: 64, testCoverage: 55, deliveryScore: 21 });
    delete (legacy.extras as { teams?: unknown }).teams;
    delete (legacy.extras as { activeTeamId?: unknown }).activeTeamId;
    delete (legacy.extras as { homeTeamId?: unknown }).homeTeamId;

    const restored = createEngine('ri-91-a6-l2002-dst');
    initTeamMock.mode = 'emptyFirst';
    initTeamMock.calls = 0;
    restored.hydratePersistState(legacy);

    expect(initTeamMock.calls).toBe(2);
    const snap = restored.snapshot();
    const productIds = snap.teams.filter((t) => t.deptId === 'product').map((t) => t.id);
    expect(productIds).toEqual(['product-t0', 'product-t1']);
    // fallback 引数 ObjectLiteral が {} になると template 指標が壊れ、継承も崩れる。
    expect(snap.deck[0]?.baselineAppliedByTeam).toEqual({
      'product-t0': 1,
      'product-t1': 1,
    });
    expect(snap.teams).toHaveLength(2);
    expect(snap.totals.delivered).toBe(21);
  });
});

describe('RI-91-A6 getEvolutionNodeEffects via unlockEvolution', () => {
  it('効果付きノード解放は applyCompanyBaseline を通し org を更新する', () => {
    const engine = createEngine('ri-91-a6-evo');
    const i = asInternals(engine);
    i.phase = 'evolution';
    const node = getEvolutionNode('quality-1');
    expect(node?.effects?.testCoverageAdd).toBe(12);
    const cost = node!.cost;
    i.evolution = { points: cost, unlocked: {} };
    const beforeCoverage = i.org.testCoverage;

    engine.unlockEvolution('quality-1');

    const snap = engine.snapshot();
    expect(snap.evolution).toEqual({ points: 0, unlocked: { 'quality-1': true } });
    expect(snap.org.testCoverage).toBe(Math.min(100, beforeCoverage + 12));
    expect(snap.org.testCoverage).not.toBe(beforeCoverage);
    // BlockStatement {} だと points/unlocked も org も変わらない。
    expect(snap.phase).toBe('evolution');
  });

  it('ポイント不足・既解放では org と evolution を変えず効果を適用しない', () => {
    const short = createEngine('ri-91-a6-evo-short');
    const shortI = asInternals(short);
    shortI.phase = 'evolution';
    shortI.evolution = { points: 0, unlocked: {} };
    const shortOrg = structuredClone(shortI.org);
    short.unlockEvolution('quality-1');
    expect(short.snapshot().evolution).toEqual({ points: 0, unlocked: {} });
    expect(short.snapshot().org).toEqual(shortOrg);

    const unlocked = createEngine('ri-91-a6-evo-unlocked');
    const unlockedI = asInternals(unlocked);
    unlockedI.phase = 'evolution';
    unlockedI.evolution = { points: 5, unlocked: { 'quality-1': true } };
    const unlockedOrg = structuredClone(unlockedI.org);
    unlocked.unlockEvolution('quality-1');
    expect(unlocked.snapshot().evolution).toEqual({ points: 5, unlocked: { 'quality-1': true } });
    expect(unlocked.snapshot().org).toEqual(unlockedOrg);
  });
});

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

  it('勝利承認時に保存済み診断を再計算してから winType を決める', () => {
    const engine = new RunEngine({ seed: 'ri-76-ack-rediagnose', difficulty: 'easy' });
    engine.startRun('easy', [], 'ri-76-ack-rediagnose');
    const internals = asInternals(engine);
    const org = makeOrg({ quality: 50, morale: 50, seniorHp: 30 });
    // 旧式 rework/completed では希釈されて healthy になりうるが、現行は done 分母で reworkSpiral。
    const totals: RunTotals = {
      ...zeroTotals(),
      delivered: 100,
      done: 100,
      rework: 40,
      completed: 500,
      reviewQueuePeak: 4,
    };
    internals.phase = 'quarterReview';
    internals.org = org;
    internals.totals = totals;
    internals.budget = 10;
    internals.usedHeavyActions = true;
    internals.quarterReview = makeReview('met');
    internals.winEvalOrg = structuredClone(org);
    internals.diagnosis = 'healthyAcceleration';

    engine.acknowledgeQuarterReview();

    expect(engine.snapshot().diagnosis).toBe('reworkSpiral');
    expect(engine.snapshot().winType).toBe(
      evaluateWinType({
        org,
        totals,
        budget: 10,
        usedHeavyActions: true,
        diagnosis: 'reworkSpiral',
      }),
    );
  });

  it('hydrate は保存済み diagnosis を現行ロジックで塗り替える', () => {
    const engine = new RunEngine({ seed: 'ri-76-hydrate-rediagnose', difficulty: 'easy' });
    engine.startRun('easy', [], 'ri-76-hydrate-rediagnose');
    const state = engine.exportPersistState();
    if (!state) throw new Error('expected exportable save');
    state.totals = {
      ...state.totals,
      done: 100,
      rework: 40,
      completed: 500,
      reviewQueuePeak: 4,
    };
    state.diagnosis = 'healthyAcceleration';

    const restored = new RunEngine({ seed: 'other', difficulty: 'easy' });
    restored.hydratePersistState(state);
    expect(restored.snapshot().diagnosis).toBe('reworkSpiral');
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

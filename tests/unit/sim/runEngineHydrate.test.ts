/**
 * RunEngine の構築・hydrate・save/replay 復元まわりのミューテーション回帰テスト。
 * Stryker の Survived / NoCoverage mutation を exact 断言で潰す（旧 RI-72-D3 / RI-91-A1）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BOSS_DEFS } from '../../../src/data/bosses';
import { getDifficulty } from '../../../src/data/difficulties';
import { createInitialRoster } from '../../../src/sim/member';
import { ENTER_TEAM_FOCUS_PENALTY } from '../../../src/sim/orgscale/teamState';
import type { TeamRunState } from '../../../src/sim/orgscale/types';
import { createRng } from '../../../src/sim/rng';
import { RunEngine } from '../../../src/sim/run/engine';
import type { RunPersistState, RunReplayFrame } from '../../../src/sim/run/persist';
import { MIN_QUARTER_DELIVERY_TARGET } from '../../../src/sim/run/quarterReview';
import type {
  BeatState,
  RunState,
  RunTotals,
  ShopOffer,
  SprintModifierDelta,
} from '../../../src/sim/run/types';
import type { OrgState, SprintMetrics, SprintState } from '../../../src/sim/types';
import {
  completeSprint as completeSprintWith,
  makeOrg,
  zeroTotals,
} from '../helpers/runEngineFixtures';

type PersistInternals = {
  phase: RunState['phase'];
  beat: BeatState | null;
  draft: string[] | null;
  shop: ShopOffer | null;
};

function started(seed = 'ri72-d3-hydrate'): RunEngine {
  const engine = new RunEngine({ seed, difficulty: 'normal' });
  engine.startRun('normal', [], seed, { kind: 'daily', dailyDate: '2026-07-28' });
  return engine;
}

function setupSave(seed = 'ri72-d3-save'): RunPersistState {
  const state = started(seed).exportPersistState();
  if (!state) throw new Error('setup save fixture was not exportable');
  return state;
}

function asPersistState(state: RunPersistState, patch: Partial<RunState>): RunPersistState {
  return { ...structuredClone(state), ...patch } as RunPersistState;
}

function asReplayFrame(state: RunPersistState, patch: Partial<RunState>): RunReplayFrame {
  return { ...structuredClone(state), ...patch } as RunReplayFrame;
}

describe('RI-72-D3 RunEngine hydrate / save-restore', () => {
  it('休息の次スプリント効果は保存・hydrate 後も保持される', () => {
    const source = started('ri78-rest-persist');
    const internals = source as unknown as {
      deck: Array<{ defId: string; level: number }>;
      pendingSprintModifiers: SprintModifierDelta;
      phase: RunState['phase'];
    };
    internals.deck = [{ defId: 'docs', level: 1 }];
    internals.pendingSprintModifiers = { taskCountMul: 0.7 };
    internals.phase = 'rest';
    source.restChoose('upgrade', 0);
    const saved = source.exportPersistState();
    expect(saved?.pendingSprintModifiers).toEqual({ taskCountMul: 0.7, focusMaxAdd: 2 });

    const restored = started('ri78-rest-persist-restored');
    restored.hydratePersistState(saved!);
    expect(restored.snapshot().pendingSprintModifiers).toEqual({
      taskCountMul: 0.7,
      focusMaxAdd: 2,
    });

    const replay = started('ri78-rest-persist-replay');
    replay.hydrateReplayFrame(source.exportReplayFrame()!);
    expect(replay.snapshot().pendingSprintModifiers).toEqual({
      taskCountMul: 0.7,
      focusMaxAdd: 2,
    });

    source.beginSetupSprint();
    restored.beginSetupSprint();
    expect(restored.snapshot().sprint?.config.focusMax).toBe(
      source.snapshot().sprint?.config.focusMax,
    );
    expect(restored.snapshot().pendingSprintModifiers).toEqual({});
  });

  it('export は save/replay 可能 phase と playing status の境界を区別する', () => {
    const engine = new RunEngine({
      seed: 'ri72-d3-export-guard',
      difficulty: 'normal',
      allowedCards: new Set(['docs', 'auto-test']),
      allowedRelics: new Set(['postmortem']),
    });
    engine.startRun('normal', ['frontier-dependency'], 'ri72-d3-export-guard');
    const internals = engine as unknown as { phase: RunState['phase']; status: RunState['status'] };

    expect(engine.exportPersistState()).toMatchObject({
      phase: 'setup',
      status: 'playing',
      trials: ['frontier-dependency'],
      extras: {
        allowedCards: ['docs', 'auto-test'],
        allowedRelics: ['postmortem'],
      },
    });

    internals.status = 'won';
    expect(engine.exportPersistState()).toBeNull();

    internals.status = 'playing';
    internals.phase = 'shop';
    expect(engine.exportReplayFrame()).toBeNull();

    internals.phase = 'lost';
    internals.status = 'lost';
    expect(engine.exportReplayFrame()).toMatchObject({ phase: 'lost', status: 'lost' });
  });

  it('exportPersistState は beat / draft / shop の復元対象フィールドを clone して保存する', () => {
    const engine = started('ri72-d3-export-clone');
    const internals = engine as unknown as PersistInternals;

    internals.phase = 'beat';
    internals.beat = { eventId: 'urgent-demo', kind: 'decision' };
    const beatSave = engine.exportPersistState();
    expect(beatSave?.beat).toEqual({ eventId: 'urgent-demo', kind: 'decision' });
    internals.beat.eventId = 'mutated-after-export';
    expect(beatSave?.beat).toEqual({ eventId: 'urgent-demo', kind: 'decision' });

    internals.phase = 'draft';
    internals.draft = ['docs', 'auto-test'];
    const draftSave = engine.exportPersistState();
    expect(draftSave?.draft).toEqual(['docs', 'auto-test']);
    internals.draft.push('copilot');
    expect(draftSave?.draft).toEqual(['docs', 'auto-test']);

    internals.phase = 'shop';
    internals.shop = {
      cards: [{ defId: 'docs', cost: 4, bought: false }],
      relic: { id: 'postmortem', cost: 12, bought: false },
      recruit: { cost: 8, bought: false },
    };
    const shopSave = engine.exportPersistState();
    expect(shopSave?.shop).toEqual({
      cards: [{ defId: 'docs', cost: 4, bought: false }],
      relic: { id: 'postmortem', cost: 12, bought: false },
      recruit: { cost: 8, bought: false },
    });
    internals.shop.relic!.cost = 99;
    internals.shop.recruit!.bought = true;
    expect(shopSave?.shop?.relic).toEqual({ id: 'postmortem', cost: 12, bought: false });
    expect(shopSave?.shop?.recruit).toEqual({ cost: 8, bought: false });
  });

  it('hydratePersistState は save 不可 phase と playing 以外の save を拒否する', () => {
    const base = setupSave('ri72-d3-invalid-save');
    const restored = started('ri72-d3-invalid-target');

    expect(() => restored.hydratePersistState(asPersistState(base, { phase: 'sprint' }))).toThrow(
      'cannot hydrate run save in phase=sprint status=playing',
    );
    expect(() =>
      restored.hydratePersistState(asPersistState(base, { phase: 'setup', status: 'won' })),
    ).toThrow('cannot hydrate run save in phase=setup status=won');
    expect(() =>
      restored.hydratePersistState(asPersistState(base, { phase: 'lost', status: 'lost' })),
    ).toThrow('cannot hydrate run save in phase=lost status=lost');

    expect(restored.snapshot().seed).toBe('ri72-d3-invalid-target');
    expect(restored.snapshot().phase).toBe('setup');
  });

  it('hydratePersistState は valid save の phase と extras を復元し sprint 実行状態を落とす', () => {
    const source = started('ri72-d3-valid-save');
    expect(source.enterTeam('platform-t1')).toBe(true);
    const state = source.exportPersistState();
    if (!state) throw new Error('entered team save was not exportable');
    state.phase = 'draft';
    state.draft = ['docs', 'auto-test'];
    state.pendingSprintModifiers = { focusMaxAdd: -2, reviewLoadAdd: 3 };
    state.extras.coarseIncidentCarry = 1.25;

    const restored = started('ri72-d3-valid-dirty');
    restored.beginSetupSprint();
    expect(restored.snapshot().sprint).not.toBeNull();

    restored.hydratePersistState(state);
    state.draft.push('copilot');
    state.extras.coarseIncidentCarry = 9;

    const snap = restored.snapshot();
    expect(snap).toMatchObject({
      seed: 'ri72-d3-valid-save',
      difficulty: 'normal',
      runKind: 'daily',
      dailyDate: '2026-07-28',
      phase: 'draft',
      status: 'playing',
      activeTeamId: 'platform-t1',
      teamLockUntilSprint: 1,
      pendingSprintModifiers: { focusMaxAdd: -2, reviewLoadAdd: 3 },
      draft: ['docs', 'auto-test'],
      sprint: null,
      sprintTick: 0,
      whatIf: null,
      whatIfStatus: 'idle',
    });
    expect(restored.exportPersistState()?.extras.coarseIncidentCarry).toBeCloseTo(1.25, 8);
    expect(restored.whatIfComputeInput()).toMatchObject({
      phase: 'draft',
      seed: 'ri72-d3-valid-save',
      draft: ['docs', 'auto-test'],
      teamReviewQueue: snap.teams.find((t) => t.id === 'platform-t1')?.reviewQueue,
      teamIncidents: snap.teams.find((t) => t.id === 'platform-t1')?.incidents,
    });
  });

  it('hydratePersistState は旧 pauseAiDebuffQuarter を pause_ai キャリーオーバーへ復元する（RI-83）', () => {
    const legacy = setupSave('ri83-legacy-pause-ai');
    delete (legacy as { goalCarryoverQuarter?: unknown }).goalCarryoverQuarter;
    delete (legacy as { goalCarryoverId?: unknown }).goalCarryoverId;
    delete (legacy.extras as { goalCarryoverQuarter?: unknown }).goalCarryoverQuarter;
    delete (legacy.extras as { goalCarryoverId?: unknown }).goalCarryoverId;
    legacy.extras.pauseAiDebuffQuarter = 2;

    const restored = started('ri83-legacy-pause-ai-target');
    restored.hydratePersistState(legacy);

    expect(restored.snapshot()).toMatchObject({
      goalCarryoverQuarter: 2,
      goalCarryoverId: 'pause_ai_rollout',
    });
    expect(restored.whatIfComputeInput()).toMatchObject({
      goalCarryoverQuarter: 2,
      goalCarryoverId: 'pause_ai_rollout',
      pauseAiDebuffQuarter: 2,
    });
  });

  it('hydratePersistState は旧 save extras の欠落値を既定値へ補完する', () => {
    const legacy = setupSave('ri72-d3-legacy-save');
    legacy.org.deliveryScore = 12.4;
    legacy.totals.delivered = 99;
    legacy.totals.incidents = 7;
    legacy.totals.contained = 2;
    legacy.extras.coarseIncidentCarry = -2;
    delete (legacy.extras as { teams?: unknown }).teams;
    delete (legacy.extras as { activeTeamId?: unknown }).activeTeamId;
    delete (legacy.extras as { homeTeamId?: unknown }).homeTeamId;
    delete (legacy.extras as { teamLockUntilSprint?: unknown }).teamLockUntilSprint;
    delete (legacy.extras as { teamRosters?: unknown }).teamRosters;
    delete (legacy.extras as { preferredCardIds?: unknown }).preferredCardIds;
    delete (legacy.extras.orgAdjust as { byTeam?: unknown }).byTeam;

    const restored = started('ri72-d3-legacy-target');
    restored.hydratePersistState(legacy);

    const snap = restored.snapshot();
    const persistedAgain = restored.exportPersistState();
    expect(snap.activeTeamId).toBe('product-t0');
    expect(snap.homeTeamId).toBe('product-t0');
    expect(snap.teamLockUntilSprint).toBe(0);
    expect(snap.totals.delivered).toBe(12);
    expect(snap.teams.find((t) => t.id === 'product-t0')).toMatchObject({
      reviewQueue: 0,
      incidents: 5,
    });
    expect(persistedAgain?.extras.coarseIncidentCarry).toBe(0);
    expect(persistedAgain?.extras.preferredCardIds).toEqual([]);
    expect(persistedAgain?.extras.orgAdjust.byTeam).toEqual({});
    expect(persistedAgain?.extras.teamRosters?.['product-t0']).toEqual(snap.roster);
  });

  it('hydratePersistState は旧 save の extraTeams を product 部門へ追加し baseline を継承する', () => {
    const legacy = setupSave('ri72-d3-legacy-extra-teams');
    legacy.deck = [{ defId: 'auto-test', level: 1, baselineAppliedLevel: 1 }];
    legacy.extras.orgAdjust.company.extraTeams = 2;
    delete (legacy.extras as { teams?: unknown }).teams;
    delete (legacy.extras as { activeTeamId?: unknown }).activeTeamId;

    const restored = started('ri72-d3-legacy-extra-target');
    restored.hydratePersistState(legacy);

    const snap = restored.snapshot();
    const productIds = snap.teams.filter((t) => t.deptId === 'product').map((t) => t.id);
    expect(productIds.slice(-2)).toEqual(['product-t4', 'product-t5']);
    expect(snap.deck[0]?.baselineAppliedByTeam).toMatchObject({
      'product-t0': 1,
      'product-t4': 1,
      'product-t5': 1,
    });
  });

  it('hydrateReplayFrame は replay 対象 phase だけを受け入れ、終端 lost を復元できる', () => {
    const base = setupSave('ri72-d3-replay');
    const restored = started('ri72-d3-replay-target');

    expect(() => restored.hydrateReplayFrame(asReplayFrame(base, { phase: 'shop' }))).toThrow(
      'cannot hydrate replay frame in phase=shop',
    );

    const lost = asReplayFrame(base, {
      phase: 'lost',
      status: 'lost',
      loseReason: 'budgetExhausted',
    });
    restored.hydrateReplayFrame(lost);

    expect(restored.snapshot()).toMatchObject({
      seed: 'ri72-d3-replay',
      phase: 'lost',
      status: 'lost',
      loseReason: 'budgetExhausted',
    });
    expect(restored.exportPersistState()).toBeNull();
    expect(restored.exportReplayFrame()).toMatchObject({
      phase: 'lost',
      status: 'lost',
      loseReason: 'budgetExhausted',
    });
  });
});
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

/** このファイル固定 seed を束ねた共通フィクスチャの別名。 */
const completeSprint = (org: OrgState, metrics: Partial<SprintMetrics> = {}): SprintState =>
  completeSprintWith('ri-91-a1-fixed-sprint', org, metrics);

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
      deliveryTarget: MIN_QUARTER_DELIVERY_TARGET,
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

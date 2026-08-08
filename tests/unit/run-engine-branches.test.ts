/**
 * RunEngine の到達しづらい分岐・survived mutant の掃討テスト。
 * Stryker の Survived / NoCoverage mutation を exact 断言で潰す（旧 RI-72-D5）。
 */
import { describe, expect, it } from 'vitest';
import { DEPARTMENT_DEFS } from '../../src/data/departments';
import { EVENT_DEFS, type EventDef } from '../../src/data/events';
import { RECRUIT_COST } from '../../src/sim/member';
import type { RosterState } from '../../src/sim/member';
import type { TeamRunState } from '../../src/sim/orgscale/types';
import { createRng } from '../../src/sim/rng';
import { createRunEngine, RunEngine } from '../../src/sim/run/engine';
import type {
  QuarterGoal,
  QuarterReview,
  RunState,
  RunTotals,
  ShopOffer,
  StakeholderTrust,
} from '../../src/sim/run/types';
import type { OrgState, SprintState, Task } from '../../src/sim/types';

type EngineInternals = {
  activeTeamId: string;
  budget: number;
  beat: RunState['beat'];
  relics: string[];
  shop: ShopOffer | null;
  usedHeavyActions: boolean;
  coarseIncidentCarry: number;
  draft: string[] | null;
  goalAdjustmentsTaken: RunState['goalAdjustmentsTaken'];
  goalCarryoverQuarter: number | null;
  goalCarryoverId: RunState['goalCarryoverId'];
  nextBudgetCap: number | null;
  org: OrgState;
  phase: RunState['phase'];
  quarterGoal: QuarterGoal;
  quarterNumber: number;
  quarterReview: QuarterReview | null;
  quarterTotals: RunTotals;
  roster: RosterState;
  sprint: SprintState | null;
  sprintIndexInQuarter: number;
  sprintsPlayed: number;
  stakeholderTrust: StakeholderTrust;
  teamLockUntilSprint: number;
  teamRosters: Record<string, RosterState>;
  teams: TeamRunState[];
  totals: RunTotals;
  resolveSprint(): void;
};

const asInternals = (engine: RunEngine): EngineInternals => engine as unknown as EngineInternals;

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

const adjustableReview = (adjustments: QuarterReview['availableAdjustments']): QuarterReview => ({
  goal: {
    deliveryTarget: 80,
    qualityTarget: 50,
    techDebtLimit: 50,
    moraleTarget: 45,
    incidentLimit: 3,
    aiAdoptionTarget: 40,
  },
  outcome: 'missed_adjustable',
  trust: { management: 60, customers: 60, team: 60 },
  progress: [],
  missedReasons: [],
  availableAdjustments: adjustments,
  bossCleared: false,
});

const arrangeAdjustment = (
  engine: RunEngine,
  adjustments: QuarterReview['availableAdjustments'],
): EngineInternals => {
  engine.startRun('easy', [], `ri-72-d5-adjust-${adjustments.join('-')}`);
  const i = asInternals(engine);
  i.phase = 'quarterReview';
  i.quarterReview = adjustableReview(adjustments);
  i.quarterGoal = i.quarterReview.goal;
  i.stakeholderTrust = { management: 60, customers: 60, team: 60 };
  i.budget = 100;
  i.totals = { ...zeroTotals(), delivered: 120, incidents: 1, completed: 4 };
  i.quarterTotals = { ...zeroTotals(), delivered: 80, incidents: 1, completed: 4 };
  i.org = {
    ...i.org,
    deliveryScore: 120,
    techDebt: 40,
    morale: 50,
    seniorHp: 45,
  };
  i.coarseIncidentCarry = 1.8;
  return i;
};

const seedForBeatDecision = (wantDecision: boolean): string => {
  for (let n = 0; n < 100; n += 1) {
    const seed = `ri-72-d5-beat-${wantDecision ? 'decision' : 'judgment'}-${n}`;
    if (createRng(`${seed}:beat:q1:s1`)() < 0.55 === wantDecision) return seed;
  }
  throw new Error('could not find deterministic beat seed');
};

const replaceEventsTemporarily = <T>(events: EventDef[], fn: () => T): T => {
  const original = [...EVENT_DEFS];
  EVENT_DEFS.splice(0, EVENT_DEFS.length, ...events);
  try {
    return fn();
  } finally {
    EVENT_DEFS.splice(0, EVENT_DEFS.length, ...original);
  }
};

const overwriteExistingEventTemporarily = <T>(id: string, patch: EventDef, fn: () => T): T => {
  const target = EVENT_DEFS.find((event) => event.id === id);
  if (!target) throw new Error(`missing event fixture: ${id}`);
  const original = structuredClone(target);
  for (const key of Object.keys(target) as Array<keyof EventDef>) delete target[key];
  Object.assign(target, { ...patch, id });
  try {
    return fn();
  } finally {
    for (const key of Object.keys(target) as Array<keyof EventDef>) delete target[key];
    Object.assign(target, original);
  }
};

describe('RI-72-D5 RunEngine NoCoverage reachable branches', () => {
  it('初期化・タイトル復帰・what-if・軽量アクセサの到達性を固定入力で確認する', () => {
    const engine = createRunEngine();
    expect(engine.currentPhase()).toBe('title');
    expect(engine.sprintRunning()).toBe(false);
    expect(engine.dispatch('overtime')).toEqual({ ok: false, reason: 'complete' });
    expect(engine.playCard(0)).toEqual({ ok: false, reason: 'complete' });

    engine.setUnlockedContent(new Set(['docs', 'auto-test']), new Set(['postmortem']));
    engine.setPreferredCards(['docs', 'auto-test']);
    engine.startRun('normal', [], 'ri-72-d5-accessors', { kind: 'daily', dailyDate: '2026-07-28' });

    const setup = engine.snapshot();
    const firstMember = setup.roster.members[0]!;
    engine.assignMember(firstMember.id, 'review');
    engine.setMemberAi(firstMember.id, true);
    expect(engine.whatIfComputeInput()).toMatchObject({
      phase: 'setup',
      seed: 'ri-72-d5-accessors',
      draft: null,
      trials: [],
      teamReviewQueue: setup.teams.find((t) => t.id === setup.activeTeamId)?.reviewQueue,
    });

    const preview = engine.whatIfPreview();
    expect(preview?.current.trials).toBeGreaterThan(0);
    expect(engine.whatIfPreview()).toEqual(preview);

    engine.beginSetupSprint();
    expect(engine.sprintRunning()).toBe(true);
    const beforeAssign = engine.snapshot().roster;
    engine.assignMember(firstMember.id, 'coding');
    engine.setMemberAi(firstMember.id, false);
    expect(engine.snapshot().roster).toEqual(beforeAssign);

    const i = asInternals(engine);
    i.phase = 'title';
    expect(engine.whatIfComputeInput()).toBeNull();
    expect(engine.whatIfPreview()).toBeNull();
    engine.toTitle('ri-72-d5-title-reset');
    expect(engine.snapshot()).toMatchObject({
      seed: 'ri-72-d5-title-reset',
      phase: 'title',
      status: 'playing',
      runKind: 'normal',
    });

    engine.startRun('normal', [], 'ri-72-d5-skip-draft');
    i.phase = 'draft';
    i.draft = ['docs'];
    engine.skipDraft();
    expect(engine.snapshot()).toMatchObject({ phase: 'evolution', draft: null });
  });

  it('ズーム・チーム閲覧・入り込みロック・業界ランキングを API 経由で実行する', () => {
    const engine = new RunEngine({ seed: 'ri-72-d5-zoom', difficulty: 'easy' });
    expect(engine.enterTeam('product-t1')).toBe(false);
    engine.startRun();

    const initial = engine.snapshot();
    const otherTeam = initial.teams.find((t) => t.id !== initial.activeTeamId)!;
    const thirdTeam = initial.teams.find(
      (t) => t.id !== initial.activeTeamId && t.id !== otherTeam.id,
    )!;
    const otherDept = DEPARTMENT_DEFS.find((d) => d.id !== otherTeam.deptId)!.id;

    engine.zoomTo('department');
    expect(engine.snapshot().zoom).toMatchObject({ level: 'department', deptId: 'product' });
    engine.focusDepartment('missing-dept');
    expect(engine.snapshot().zoom.deptId).toBe('product');
    engine.focusDepartment(otherDept);
    expect(engine.snapshot().zoom).toMatchObject({ level: 'department', deptId: otherDept });

    engine.focusTeam(initial.activeTeamId);
    expect(engine.snapshot().zoom).toMatchObject({
      level: 'team',
      teamId: initial.activeTeamId,
      deptId: 'product',
    });
    engine.focusTeam(otherTeam.id);
    expect(engine.snapshot().zoom).toMatchObject({
      level: 'department',
      teamId: otherTeam.id,
      deptId: otherTeam.deptId,
    });

    engine.zoomTo('industry');
    engine.setRankingKind('ai');
    const industry = engine.snapshot();
    expect(industry.orgScale?.teamCount).toBe(initial.teams.length);
    expect(industry.industry?.kind).toBe('ai');

    expect(engine.enterTeam(initial.activeTeamId)).toBe(true);
    expect(engine.enterTeam(otherTeam.id)).toBe(true);
    const locked = engine.snapshot();
    expect(locked.activeTeamId).toBe(otherTeam.id);
    expect(locked.pendingSprintModifiers.focusMaxAdd).toBeLessThan(0);

    engine.zoomTo('company');
    engine.focusDepartment('product');
    engine.focusTeam(thirdTeam.id);
    expect(engine.snapshot().zoom).toMatchObject({ level: 'team', teamId: otherTeam.id });

    const i = asInternals(engine);
    i.phase = 'setup';
    expect(engine.enterTeam(thirdTeam.id)).toBe(false);
    i.sprintsPlayed = i.teamLockUntilSprint;
    expect(engine.enterTeam(initial.activeTeamId)).toBe(true);
    engine.beginSetupSprint();
    expect(engine.enterTeam(thirdTeam.id)).toBe(false);
    i.phase = 'beat';
    expect(engine.enterTeam(otherTeam.id)).toBe(false);
    i.phase = 'quarterReview';
    expect(engine.enterTeam(otherTeam.id)).toBe(false);
  });

  it('org lever のガード・全社/部門/チーム適用・スプリント盤面同期を実行する', () => {
    const engine = new RunEngine({ seed: 'ri-72-d5-levers', difficulty: 'easy' });
    expect(engine.applyOrgLever('recruitDraft')).toBe(false);
    engine.startRun();

    const i = asInternals(engine);
    i.budget = 220;
    const activeTeam = i.activeTeamId;
    const activeDept = i.teams.find((t) => t.id === activeTeam)!.deptId;
    const teamCount = i.teams.length;

    expect(engine.applyOrgLever('teamReviewHelp')).toBe(false);
    expect(engine.applyOrgLever('teamReviewHelp', undefined, 'missing-team')).toBe(false);
    expect(engine.applyOrgLever('unknownLever')).toBe(false);
    expect(engine.applyOrgLever('recruitDraft')).toBe(true);
    expect(engine.snapshot().teams).toHaveLength(teamCount + 1);
    expect(engine.applyOrgLever('reviewReinforce', activeDept)).toBe(true);
    expect(engine.applyOrgLever('teamAiThrottle', undefined, activeTeam)).toBe(true);
    const lockedTarget = i.teams.find((t) => t.id !== activeTeam)!.id;
    i.teamLockUntilSprint = i.sprintsPlayed + 2;
    expect(engine.applyOrgLever('teamReviewHelp', undefined, lockedTarget)).toBe(false);
    i.teamLockUntilSprint = 0;

    engine.beginSetupSprint();
    expect(engine.sprintRunning()).toBe(true);
    i.budget = 100;
    const base = i.sprint!.tasks[0]!;
    const reviewTask = (patch: Partial<Task>): Task => ({
      ...base,
      id: patch.id ?? base.id,
      lane: patch.lane ?? 'review',
      progress: patch.progress ?? 0.1,
      incident: patch.incident ?? false,
      burnTicksLeft: patch.burnTicksLeft,
      reworkAttempts: patch.reworkAttempts ?? 0,
      wasReworked: patch.wasReworked ?? false,
      debt: patch.debt ?? false,
    });
    i.sprint!.tasks = [
      reviewTask({ id: 100, lane: 'review', incident: false }),
      reviewTask({ id: 101, lane: 'review', incident: true, burnTicksLeft: 3 }),
      reviewTask({ id: 102, lane: 'rework', incident: true, burnTicksLeft: 2 }),
    ];
    i.sprint!.metrics.contained = 0;

    expect(engine.applyOrgLever('teamFirefight', undefined, activeTeam)).toBe(true);
    expect(i.sprint!.tasks.filter((t) => t.incident)).toHaveLength(0);
    expect(i.sprint!.metrics.contained).toBe(2);

    expect(engine.applyOrgLever('teamReviewHelp', undefined, activeTeam)).toBe(true);
    expect(i.sprint!.tasks.filter((t) => t.lane === 'review')).toHaveLength(0);
    engine.zoomTo('company');
    expect(engine.snapshot().orgScale?.departments.length).toBeGreaterThan(0);
    expect(engine.snapshot().teams.find((t) => t.id === activeTeam)?.reviewQueue).toBe(0);

    const fallback = new RunEngine({
      seed: 'ri-72-d5-lever-template-fallback',
      difficulty: 'easy',
    });
    fallback.startRun();
    const f = asInternals(fallback);
    f.budget = 100;
    f.teams = [];
    expect(fallback.applyOrgLever('recruitDraft')).toBe(true);
    expect(fallback.snapshot().teams).toHaveLength(1);
  });

  it('イベント抽選 fallback と採用失敗 forceLose を一時データで実行する', () => {
    const decisionOnly: EventDef = {
      id: 'd5-decision-only',
      title: 'D5 decision',
      prompt: 'fallback target',
      tone: 'good',
      choices: [
        { label: 'go', description: 'go', outcome: { trust: { customers: 5 } } },
        { label: 'stay', description: 'stay', outcome: {} },
      ],
    };
    replaceEventsTemporarily([decisionOnly], () => {
      const engine = new RunEngine({
        seed: seedForBeatDecision(false),
        difficulty: 'easy',
      });
      engine.startRun();
      const i = asInternals(engine);
      i.phase = 'evolution';
      engine.finishEvolution();
      expect(engine.snapshot()).toMatchObject({
        phase: 'beat',
        beat: { eventId: 'd5-decision-only', kind: 'decision' },
      });
    });

    replaceEventsTemporarily([], () => {
      const engine = new RunEngine({ seed: 'ri-72-d5-empty-events', difficulty: 'easy' });
      engine.startRun();
      const i = asInternals(engine);
      i.phase = 'evolution';
      engine.finishEvolution();
      expect(engine.snapshot().phase).toBe('sprint');
    });

    const recruitFail: EventDef = {
      id: 'urgent-demo',
      title: 'D5 recruit',
      prompt: 'fail path',
      tone: 'bad',
      kind: 'decision',
      choices: [
        {
          label: 'hire',
          description: 'hire',
          outcome: {
            grantRecruit: true,
            onRecruitFail: { trust: { customers: -7 }, forceLose: 'reviewFreeze' },
          },
        },
      ],
    };
    overwriteExistingEventTemporarily('urgent-demo', recruitFail, () => {
      const engine = new RunEngine({ seed: 'ri-72-d5-recruit-fail', difficulty: 'easy' });
      engine.startRun();
      const i = asInternals(engine);
      i.phase = 'beat';
      i.beat = { eventId: 'urgent-demo', kind: 'decision' };
      i.budget = RECRUIT_COST - 1;
      engine.resolveBeat(0);
      expect(engine.snapshot()).toMatchObject({
        phase: 'lost',
        status: 'lost',
        loseReason: 'reviewFreeze',
        stakeholderTrust: expect.objectContaining({ customers: 63 }),
      });
    });
  });

  it('粗粒度チーム同期と四半期末 carry flush を完了スプリントで実行する', () => {
    const win = new RunEngine({ seed: 'ri-72-d5-flush-win', difficulty: 'easy' });
    const w = arrangeAdjustment(win, []);
    w.quarterReview = {
      ...adjustableReview([]),
      outcome: 'met',
      bossCleared: true,
      availableAdjustments: [],
    };
    win.acknowledgeQuarterReview();
    expect(win.snapshot()).toMatchObject({
      phase: 'won',
      totals: expect.objectContaining({ incidents: 2 }),
      quarterTotals: expect.objectContaining({ incidents: 2 }),
    });

    const engine = new RunEngine({ seed: 'ri-72-d5-coarse-sync', difficulty: 'easy' });
    engine.startRun();
    const i = asInternals(engine);
    i.budget = 100;
    const inactive = i.teams.find((t) => t.id !== i.activeTeamId)!;
    i.teamRosters.ghost = structuredClone(i.roster);
    i.teamRosters[inactive.id] = {
      nextId: 6,
      members: Array.from({ length: 6 }, (_, n) => ({
        ...i.roster.members[0]!,
        id: `cached-member-${n}`,
        assignment: 'coding' as const,
        onLeave: false,
      })),
    };
    i.goalCarryoverQuarter = 1;
    i.goalCarryoverId = 'pause_ai_rollout';
    engine.beginSetupSprint();
    i.sprint!.complete = true;
    i.sprint!.metrics.delivered = 1;
    i.sprint!.metrics.doneCount = 1;
    i.sprint!.metrics.completedCount = 1;
    i.sprint!.metrics.aiAssistedCompleted = 0;
    i.resolveSprint();
    const updated = engine.snapshot().teams.find((t) => t.id === inactive.id)!;
    expect(updated.engineers).toBe(6);
    expect(updated.headcount).toBe(6);
  });

  it('RI-83: アクティブチームが飽和しても他チームへ org キャリーを適用する', () => {
    const engine = new RunEngine({ seed: 'ri-83-saturate-active', difficulty: 'easy' });
    engine.startRun();
    const i = asInternals(engine);
    i.goalCarryoverQuarter = i.quarterNumber;
    i.goalCarryoverId = 'extend_deadline';
    i.org = { ...i.org, seniorHp: 100 };
    i.teams = i.teams.map((t) =>
      t.id === i.activeTeamId ? { ...t, seniorHp: 100 } : { ...t, seniorHp: 40 },
    );
    engine.beginSetupSprint();
    const snap = engine.snapshot();
    expect(snap.org.seniorHp).toBe(100);
    const inactive = snap.teams.filter((t) => t.id !== snap.activeTeamId);
    expect(inactive.length).toBeGreaterThan(0);
    expect(inactive.every((t) => t.seniorHp === 45)).toBe(true);
  });

  it('四半期調整の特殊枝で delivery 乗算・予算上限・AI停止・再編離脱を通す', () => {
    const quality = new RunEngine({ seed: 'ri-72-d5-quality-pivot', difficulty: 'easy' });
    const qualityInternals = arrangeAdjustment(quality, ['quality_pivot']);
    quality.chooseGoalAdjustment('quality_pivot');
    expect(quality.snapshot()).toMatchObject({
      phase: 'setup',
      quarterNumber: 2,
      totals: expect.objectContaining({ delivered: 108, incidents: 1 }),
    });
    expect(qualityInternals.goalAdjustmentsTaken).toContain('quality_pivot');

    const budget = new RunEngine({ seed: 'ri-72-d5-budget-cap', difficulty: 'easy' });
    arrangeAdjustment(budget, ['request_budget']);
    budget.chooseGoalAdjustment('request_budget');
    expect(budget.snapshot()).toMatchObject({
      phase: 'setup',
      quarterNumber: 2,
      budget: 85,
    });

    const pause = new RunEngine({ seed: 'ri-72-d5-pause-ai', difficulty: 'easy' });
    arrangeAdjustment(pause, ['pause_ai_rollout']);
    pause.chooseGoalAdjustment('pause_ai_rollout');
    expect(pause.whatIfComputeInput()).toMatchObject({
      pauseAiDebuffQuarter: 2,
      goalCarryoverQuarter: 2,
      goalCarryoverId: 'pause_ai_rollout',
    });
    expect(pause.snapshot()).toMatchObject({
      goalCarryoverQuarter: 2,
      goalCarryoverId: 'pause_ai_rollout',
    });

    const exhausted = new RunEngine({ seed: 'ri-72-d5-adjustment-lose', difficulty: 'easy' });
    const exhaustedInternals = arrangeAdjustment(exhausted, ['extend_deadline']);
    exhaustedInternals.budget = 10;
    exhausted.chooseGoalAdjustment('extend_deadline');
    expect(exhausted.snapshot()).toMatchObject({
      phase: 'lost',
      status: 'lost',
      loseReason: 'budgetExhausted',
    });

    const reorg = new RunEngine({ seed: 'ri-72-d5-reorg', difficulty: 'easy' });
    const reorgInternals = arrangeAdjustment(reorg, ['reorg_teams']);
    reorgInternals.budget = RECRUIT_COST;
    const beforeActive = reorgInternals.roster.members.filter((m) => !m.onLeave).length;
    reorg.chooseGoalAdjustment('reorg_teams');
    const after = reorg.snapshot();
    expect(after.phase).toBe('setup');
    expect(after.roster.members.filter((m) => !m.onLeave)).toHaveLength(beforeActive - 1);
    expect(after.org.seniorHp).toBeGreaterThan(45);
  });
});

const taskFrom = (base: Task, patch: Partial<Task>): Task => ({
  ...base,
  id: patch.id ?? base.id,
  lane: patch.lane ?? base.lane,
  progress: patch.progress ?? base.progress,
  incident: patch.incident ?? false,
  burnTicksLeft: patch.burnTicksLeft,
  reworkAttempts: patch.reworkAttempts ?? 0,
  wasReworked: patch.wasReworked ?? false,
  debt: patch.debt ?? false,
});

describe('RI-72-D5 RunEngine survived mutants', () => {
  it('heavy action だけが usedHeavyActions を立て、通常アクションでは立てない', () => {
    const engine = new RunEngine({ seed: 'ri-72-d5-survived-heavy', difficulty: 'easy' });
    engine.startRun();
    engine.beginSetupSprint();
    const i = asInternals(engine);
    i.sprint!.focus = 100;

    expect(engine.dispatch('aiThrottle').ok).toBe(true);
    expect(i.usedHeavyActions).toBe(false);

    expect(engine.dispatch('overtime').ok).toBe(true);
    expect(i.usedHeavyActions).toBe(true);
  });

  it('shop relic と recruit の guard/成功を公開 API 経由で固定する', () => {
    const engine = new RunEngine({ seed: 'ri-72-d5-survived-shop', difficulty: 'easy' });
    engine.startRun();
    const i = asInternals(engine);
    i.phase = 'shop';
    i.budget = 100;

    i.shop = { cards: [] };
    engine.buyShopRelic();
    expect(i.budget).toBe(100);
    expect(i.relics).toEqual([]);

    i.shop = { cards: [], relic: { id: 'psych-safety', cost: 20, bought: true } };
    engine.buyShopRelic();
    expect(i.budget).toBe(100);
    expect(i.relics).toEqual([]);

    i.shop = { cards: [], relic: { id: 'psych-safety', cost: 120, bought: false } };
    engine.buyShopRelic();
    expect(i.budget).toBe(100);
    expect(i.relics).toEqual([]);

    i.shop = { cards: [], relic: { id: 'psych-safety', cost: 20, bought: false } };
    engine.buyShopRelic();
    expect(i.budget).toBe(80);
    expect(i.relics).toEqual(['psych-safety']);
    expect(i.shop.relic?.bought).toBe(true);

    i.shop = { cards: [], relic: { id: 'psych-safety', cost: 20, bought: false } };
    engine.buyShopRelic();
    expect(i.budget).toBe(80);
    expect(i.relics).toEqual(['psych-safety']);

    i.shop = { cards: [] };
    engine.buyShopRecruit();
    expect(i.budget).toBe(80);

    i.shop = { cards: [], recruit: { cost: RECRUIT_COST, bought: true } };
    engine.buyShopRecruit();
    expect(i.budget).toBe(80);

    i.shop = { cards: [], recruit: { cost: RECRUIT_COST, bought: false } };
    engine.buyShopRecruit();
    expect(i.budget).toBe(80 - RECRUIT_COST);
    expect(i.shop.recruit?.bought).toBe(true);
  });

  it('sprint 中の orgScale は正本チームではなくライブ盤面の行列と炎上数を使う', () => {
    const engine = new RunEngine({ seed: 'ri-72-d5-survived-live-board', difficulty: 'easy' });
    engine.startRun();
    engine.beginSetupSprint();
    const i = asInternals(engine);
    const active = i.teams.find((team) => team.id === i.activeTeamId)!;
    active.reviewQueue = 0;
    active.incidents = 0;

    const base = i.sprint!.tasks[0]!;
    i.sprint!.tasks = [
      taskFrom(base, { id: 200, lane: 'review', incident: false }),
      taskFrom(base, { id: 201, lane: 'review', incident: true, burnTicksLeft: 4 }),
      taskFrom(base, { id: 202, lane: 'rework', incident: true, burnTicksLeft: 2 }),
    ];
    engine.zoomTo('company');

    const activeProjection = engine
      .snapshot()
      .orgScale!.departments.flatMap((department) => department.teams)
      .find((team) => team.id === i.activeTeamId)!;

    expect(activeProjection.reviewQueue).toBe(2);
    expect(activeProjection.incidents).toBe(2);
    expect(activeProjection.engineers).toBeGreaterThanOrEqual(i.roster.members.length);
  });

  it('active team のチームレバーは sprint 盤面とチーム正本の review/incidents を同期する', () => {
    const engine = new RunEngine({ seed: 'ri-72-d5-survived-align', difficulty: 'easy' });
    engine.startRun();
    engine.beginSetupSprint();
    const i = asInternals(engine);
    i.budget = 100;
    i.teamLockUntilSprint = 0;
    i.sprint!.metrics.contained = 0;

    const base = i.sprint!.tasks[0]!;
    i.sprint!.tasks = [
      taskFrom(base, { id: 300, lane: 'review', incident: false, progress: 0.2 }),
      taskFrom(base, { id: 301, lane: 'review', incident: false, progress: 0.4 }),
      taskFrom(base, { id: 302, lane: 'review', incident: true, burnTicksLeft: 5 }),
      taskFrom(base, { id: 303, lane: 'rework', incident: true, burnTicksLeft: 2 }),
    ];

    expect(engine.applyOrgLever('teamReviewHelp', undefined, i.activeTeamId)).toBe(true);

    const remainingReviews = i.sprint!.tasks.filter((task) => task.lane === 'review');
    const remainingIncidents = i.sprint!.tasks.filter((task) => task.incident);
    const active = i.teams.find((team) => team.id === i.activeTeamId)!;
    expect(remainingReviews).toHaveLength(1);
    expect(remainingIncidents).toHaveLength(2);
    expect(active.reviewQueue).toBe(1);
    expect(active.incidents).toBe(2);
  });
});

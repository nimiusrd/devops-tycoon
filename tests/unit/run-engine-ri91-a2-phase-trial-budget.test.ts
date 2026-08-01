import { describe, expect, it } from 'vitest';
import { getDifficulty } from '../../src/data/difficulties';
import type { GrowthOutcome, RosterState } from '../../src/sim/member';
import { HOME_TEAM_ID } from '../../src/sim/orgscale/teamState';
import { createRng } from '../../src/sim/rng';
import { RunEngine } from '../../src/sim/run/engine';
import type { RunState, RunTotals } from '../../src/sim/run/types';
import { createSprint } from '../../src/sim/sprint';
import type { OrgState, SprintMetrics, SprintState } from '../../src/sim/types';

type A2Internals = {
  accumulatorMs: number;
  activeTeamId: string;
  budget: number;
  currentSprintId: string | null;
  currentSprintKind: RunState['currentSprintKind'];
  homeTeamId: string;
  lastGrowth: GrowthOutcome | null;
  org: OrgState;
  phase: RunState['phase'];
  roster: RosterState;
  sprint: SprintState | null;
  sprintBaselineInput: { reviewLoadAdd?: number; incidentLoadAdd?: number } | null;
  sprintTick: number;
  status: RunState['status'];
  teamRosters: Record<string, RosterState>;
  teams: { id: string; reviewQueue: number; incidents: number }[];
  totals: RunTotals;
  usedHeavyActions: boolean;
  applyGrowth(result: unknown): void;
  resolveSprint(): void;
};

const asInternals = (engine: RunEngine): A2Internals => engine as unknown as A2Internals;

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
    createRng('ri-91-a2-fixed-sprint'),
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

describe('RI-91-A2 RunEngine phase / trial / budget', () => {
  it('trialBudgetMul は未知 ID を 1 扱いし、budgetMul は積算（除算ではない）', () => {
    const startBudget = getDifficulty('normal').startBudget;

    const unknown = new RunEngine({ seed: 'ri-91-a2-trial-unknown', difficulty: 'normal' });
    unknown.startRun('normal', ['not-a-real-trial'], 'ri-91-a2-trial-unknown');
    expect(unknown.snapshot().budget).toBe(Math.round(startBudget));

    const half = new RunEngine({ seed: 'ri-91-a2-trial-half', difficulty: 'normal' });
    half.startRun('normal', ['half-budget'], 'ri-91-a2-trial-half');
    const halfBudget = Math.round(startBudget * 0.5);
    expect(half.snapshot().budget).toBe(halfBudget);
    // * → / だと startBudget / 0.5 = 2 倍になる。
    expect(half.snapshot().budget).not.toBe(Math.round(startBudget / 0.5));

    const stacked = new RunEngine({ seed: 'ri-91-a2-trial-stack', difficulty: 'normal' });
    stacked.startRun('normal', ['half-budget', 'not-a-real-trial'], 'ri-91-a2-trial-stack');
    expect(stacked.snapshot().budget).toBe(halfBudget);
  });

  it('フロンティア試練の開始コストはちょうど消費で敗北し、1 余りなら継続する', () => {
    const lose = new RunEngine({
      seed: 'ri-91-a2-frontier-exact',
      difficulty: 'nightmare',
      trials: ['frontier-dependency'],
    });
    lose.startRun();
    const loseI = asInternals(lose);
    // 依存度 55 + 試練 +5 → 60、ceil(60 * 0.05)=3。
    loseI.budget = 3;
    loseI.org.aiDependency = 55;
    lose.beginSetupSprint();
    expect(lose.snapshot()).toMatchObject({
      status: 'lost',
      phase: 'lost',
      loseReason: 'budgetExhausted',
      budget: 0,
    });

    const survive = new RunEngine({
      seed: 'ri-91-a2-frontier-remain',
      difficulty: 'nightmare',
      trials: ['frontier-dependency'],
    });
    survive.startRun();
    const surviveI = asInternals(survive);
    surviveI.budget = 4;
    surviveI.org.aiDependency = 55;
    survive.beginSetupSprint();
    expect(survive.snapshot()).toMatchObject({
      status: 'playing',
      phase: 'sprint',
      budget: 1,
    });
  });

  it('beginSetupSprint は setup 以外では起動せず、setup では sprint へ進む', () => {
    const blocked = new RunEngine({ seed: 'ri-91-a2-begin-blocked', difficulty: 'easy' });
    // title のまま
    const before = blocked.snapshot();
    blocked.beginSetupSprint();
    expect(blocked.snapshot()).toEqual(before);

    const ok = new RunEngine({ seed: 'ri-91-a2-begin-ok', difficulty: 'easy' });
    ok.startRun();
    expect(ok.snapshot().phase).toBe('setup');
    ok.beginSetupSprint();
    expect(ok.snapshot().phase).toBe('sprint');
    expect(ok.sprintRunning()).toBe(true);
  });

  it('step の phase / sprint / complete ガードを境界ごとに固定する', () => {
    const engine = new RunEngine({ seed: 'ri-91-a2-step-guards', difficulty: 'easy' });
    engine.startRun();
    engine.beginSetupSprint();
    const i = asInternals(engine);
    const live = i.sprint!;
    expect(live.complete).toBe(false);

    // phase が sprint 以外（sprint 実体は残す）→ no-op
    i.phase = 'setup';
    i.accumulatorMs = 0;
    i.sprintTick = 0;
    engine.step(1_000);
    expect(i.accumulatorMs).toBe(0);
    expect(i.sprintTick).toBe(0);
    expect(i.sprint).toBe(live);

    // phase=sprint だが sprint=null → no-op
    i.phase = 'sprint';
    i.sprint = null;
    i.accumulatorMs = 0;
    engine.step(1_000);
    expect(i.accumulatorMs).toBe(0);
    expect(i.sprint).toBeNull();

    // complete 済み → resolve 済み扱いで再ステップしない
    i.sprint = { ...live, complete: true };
    i.phase = 'sprint';
    i.accumulatorMs = 0;
    i.sprintTick = 7;
    engine.step(1_000);
    expect(i.accumulatorMs).toBe(0);
    expect(i.sprintTick).toBe(7);
    expect(i.phase).toBe('sprint');

    // 正常系: 進行する
    i.sprint = { ...live, complete: false };
    i.phase = 'sprint';
    i.accumulatorMs = 0;
    i.sprintTick = 0;
    engine.step(100);
    expect(i.sprintTick).toBeGreaterThan(0);
  });

  it('dispatch / playCard は sprint フェーズ以外または sprint 欠落で complete を返す', () => {
    const engine = new RunEngine({ seed: 'ri-91-a2-action-guards', difficulty: 'easy' });
    engine.startRun();
    engine.beginSetupSprint();
    const i = asInternals(engine);
    const live = i.sprint!;
    i.sprint!.focus = 100;

    i.phase = 'setup';
    expect(engine.dispatch('overtime')).toEqual({ ok: false, reason: 'complete' });
    expect(engine.playCard(0)).toEqual({ ok: false, reason: 'complete' });
    expect(i.usedHeavyActions).toBe(false);

    i.phase = 'sprint';
    i.sprint = null;
    expect(engine.dispatch('overtime')).toEqual({ ok: false, reason: 'complete' });
    expect(engine.playCard(0)).toEqual({ ok: false, reason: 'complete' });
    expect(i.usedHeavyActions).toBe(false);

    i.sprint = live;
    i.sprint.focus = 100;
    expect(engine.dispatch('overtime').ok).toBe(true);
    expect(i.usedHeavyActions).toBe(true);
  });

  it('andon 成功時も usedHeavyActions を立てる', () => {
    const engine = new RunEngine({ seed: 'ri-91-a2-andon-heavy', difficulty: 'easy' });
    engine.startRun();
    engine.beginSetupSprint();
    const i = asInternals(engine);
    i.sprint!.focus = 100;

    expect(engine.dispatch('andon').ok).toBe(true);
    expect(i.usedHeavyActions).toBe(true);
  });

  it('playCard 失敗時は applyImmediateLose を呼ばない', () => {
    const engine = new RunEngine({ seed: 'ri-91-a2-playcard-fail', difficulty: 'easy' });
    engine.startRun();
    engine.beginSetupSprint();
    const i = asInternals(engine);
    // 失敗パスでも即時敗北評価されると lost になる盤面。
    i.budget = 0;
    i.org.seniorHp = 50;

    const before = engine.snapshot();
    expect(engine.playCard(999)).toEqual({ ok: false, reason: 'no-card' });
    expect(engine.snapshot()).toMatchObject({
      status: before.status,
      phase: before.phase,
      budget: 0,
    });
    expect(engine.snapshot().phase).not.toBe('lost');
  });

  it('activeTeam が無いとき beginSprint の盤面圧力は 0 で起動する', () => {
    const engine = new RunEngine({ seed: 'ri-91-a2-no-active-team', difficulty: 'easy' });
    engine.startRun();
    const i = asInternals(engine);
    for (const team of i.teams) {
      team.reviewQueue = 9;
      team.incidents = 4;
    }
    i.activeTeamId = 'missing-team';

    engine.beginSetupSprint();
    expect(engine.snapshot().phase).toBe('sprint');
    expect(engine.sprintRunning()).toBe(true);
    // find 失敗時は OptionalChaining フォールバックで 0。除去すると throw、?? 除去でも 9/4 が載る。
    expect(i.sprintBaselineInput?.reviewLoadAdd ?? 0).toBe(0);
    expect(i.sprintBaselineInput?.incidentLoadAdd).toBeUndefined();
  });

  it('initRun は home teamRosters を空オブジェクトにしない', () => {
    const engine = new RunEngine({ seed: 'ri-91-a2-team-rosters', difficulty: 'easy' });
    engine.startRun();
    const i = asInternals(engine);
    expect(i.homeTeamId).toBe(HOME_TEAM_ID);
    expect(i.teamRosters[HOME_TEAM_ID]).toEqual(i.roster);
    expect(Object.keys(i.teamRosters)).toEqual([HOME_TEAM_ID]);
  });

  it('resolveSprint は sprint / currentSprintId 欠落で early return する', () => {
    const engine = new RunEngine({ seed: 'ri-91-a2-resolve-guard', difficulty: 'easy' });
    engine.startRun();
    const i = asInternals(engine);
    const org = makeOrg();
    i.phase = 'sprint';
    i.status = 'playing';
    i.currentSprintKind = 'normal';
    i.totals = zeroTotals();
    i.org = org;

    i.sprint = null;
    i.currentSprintId = 'q1-s1';
    expect(() => i.resolveSprint()).not.toThrow();
    expect(engine.snapshot().sprintsPlayed).toBe(0);

    i.sprint = completeSprint(org);
    i.currentSprintId = null;
    expect(() => i.resolveSprint()).not.toThrow();
    expect(engine.snapshot().sprintsPlayed).toBe(0);

    i.sprint = null;
    i.currentSprintId = null;
    expect(() => i.resolveSprint()).not.toThrow();
    expect(engine.snapshot().sprintsPlayed).toBe(0);
  });

  it('resolveSprint は直前に休職したメンバーをスタミナ回復から除外する', () => {
    const engine = new RunEngine({ seed: 'ri-91-a2-just-left', difficulty: 'easy' });
    engine.startRun();
    const i = asInternals(engine);
    const org = makeOrg();
    const member = i.roster.members[0]!;
    i.phase = 'sprint';
    i.status = 'playing';
    i.currentSprintKind = 'normal';
    i.currentSprintId = 'q1-s1';
    i.org = org;
    i.totals = zeroTotals();
    i.sprint = completeSprint(org);
    i.sprintBaselineInput = null;
    i.roster = {
      ...i.roster,
      members: i.roster.members.map((m) =>
        m.id === member.id
          ? { ...m, onLeave: true, stamina: 0, staminaMax: 50, assignment: 'bench' as const }
          : m,
      ),
    };

    const growth: GrowthOutcome = {
      promotions: [],
      leveledUp: [],
      wentOnLeave: [{ id: member.id, name: member.name }],
      docGain: 0,
    };
    i.applyGrowth = () => {
      i.lastGrowth = growth;
    };

    i.resolveSprint();

    const after = engine.snapshot().roster.members.find((m) => m.id === member.id)!;
    // skip 無しだと STAMINA_RECOVER_BETWEEN*1.25=20 で RETURN_RATIO ちょうど復帰する。
    expect(after.onLeave).toBe(true);
    expect(after.stamina).toBe(0);
  });

  it('resolveSprint は lastGrowth が null でも throw しない', () => {
    const engine = new RunEngine({ seed: 'ri-91-a2-last-growth-null', difficulty: 'easy' });
    engine.startRun();
    const i = asInternals(engine);
    const org = makeOrg();
    i.phase = 'sprint';
    i.status = 'playing';
    i.currentSprintKind = 'normal';
    i.currentSprintId = 'q1-s1';
    i.org = org;
    i.totals = zeroTotals();
    i.sprint = completeSprint(org);
    i.sprintBaselineInput = null;
    i.applyGrowth = () => {
      i.lastGrowth = null;
    };

    expect(() => i.resolveSprint()).not.toThrow();
    expect(engine.snapshot().sprintsPlayed).toBe(1);
  });
});

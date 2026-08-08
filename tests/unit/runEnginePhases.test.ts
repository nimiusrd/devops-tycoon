/**
 * RunEngine の phase 遷移・phase ガード・試練（trial）・予算まわりのテスト。
 * 遷移表（setPhase / RunPhaseError）と、phase 外呼び出しが状態を動かさないこと、
 * および Stryker の Survived / NoCoverage mutation を exact 断言で潰す。
 * （旧 RI-39 / RI-72-D1 / RI-91-A2）
 */
import { describe, expect, it } from 'vitest';
import { getDifficulty } from '../../src/data/difficulties';
import type { GrowthOutcome, RosterState } from '../../src/sim/member';
import { HOME_TEAM_ID } from '../../src/sim/orgscale/teamState';
import { RunEngine } from '../../src/sim/run/engine';
import { RunPhaseError } from '../../src/sim/run/phases';
import type { BeatState, RunState, RunTotals } from '../../src/sim/run/types';
import type { OrgState, SprintMetrics, SprintState } from '../../src/sim/types';
import { playRun } from './helpers/runFlow';
import {
  completeSprint as completeSprintWith,
  makeOrg,
  zeroTotals,
} from './helpers/runEngineFixtures';

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

/** このファイル固定 seed を束ねた共通フィクスチャの別名。 */
const completeSprint = (org: OrgState, metrics: Partial<SprintMetrics> = {}): SprintState =>
  completeSprintWith('ri-91-a2-fixed-sprint', org, metrics);

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

describe('RI-72-D1 phase guards', () => {
  type PhaseGuardInternals = {
    phase: RunState['phase'];
    beat: BeatState | null;
    quarterReview: NonNullable<RunState['quarterReview']> | null;
    evolution: RunState['evolution'];
    setPhase(next: RunState['phase']): void;
  };

  const internalsOf = (engine: RunEngine): PhaseGuardInternals =>
    engine as unknown as PhaseGuardInternals;

  const makeQuarterReview = (
    outcome: NonNullable<RunState['quarterReview']>['outcome'],
  ): NonNullable<RunState['quarterReview']> => ({
    goal: {
      deliveryTarget: 10,
      qualityTarget: 10,
      techDebtLimit: 90,
      moraleTarget: 10,
      incidentLimit: 5,
    },
    outcome,
    trust: { management: 50, customers: 50, team: 50 },
    progress: [],
    missedReasons: [],
    availableAdjustments: outcome === 'missed_adjustable' ? ['cut_scope'] : [],
    bossCleared: true,
  });

  it('RunPhaseError は不正遷移の from/to とメッセージを保持し phase を動かさない', () => {
    const cases: Array<[RunState['phase'], RunState['phase']]> = [
      ['title', 'sprint'],
      ['setup', 'title'],
      ['beat', 'quarterReview'],
      ['won', 'lost'],
    ];

    for (const [from, to] of cases) {
      const engine = new RunEngine({ seed: `ri72-d1-${from}-${to}`, difficulty: 'easy' });
      const internals = internalsOf(engine);
      internals.phase = from;

      let thrown: unknown;
      try {
        internals.setPhase(to);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(RunPhaseError);
      expect(thrown).toMatchObject({ name: 'RunPhaseError', from, to });
      expect((thrown as Error).message).toBe(
        `不正なフェーズ遷移: ${from} → ${to}（RUN_PHASE_TRANSITIONS に無い遷移）`,
      );
      expect(engine.currentPhase()).toBe(from);
    }
  });

  it('setup 以外の beginSetupSprint はスプリントを起動しない', () => {
    const engine = new RunEngine({ seed: 'ri72-d1-begin-setup-title', difficulty: 'easy' });
    const before = engine.snapshot();

    expect(() => engine.beginSetupSprint()).not.toThrow();

    expect(engine.snapshot()).toEqual(before);
  });

  it('result/draft/evolution の入口は phase が違うと何もしない', () => {
    const cases: Array<{
      name: string;
      arrange?: (internals: PhaseGuardInternals) => void;
      act: (engine: RunEngine) => void;
    }> = [
      { name: 'acknowledgeResult', act: (engine) => engine.acknowledgeResult() },
      { name: 'chooseCard', act: (engine) => engine.chooseCard('copilot') },
      { name: 'skipDraft', act: (engine) => engine.skipDraft() },
      {
        name: 'unlockEvolution',
        arrange: (internals) => {
          internals.evolution = { points: 1, unlocked: {} };
        },
        act: (engine) => engine.unlockEvolution('review-1'),
      },
      { name: 'finishEvolution', act: (engine) => engine.finishEvolution() },
    ];

    for (const { name, arrange, act } of cases) {
      const engine = new RunEngine({ seed: `ri72-d1-${name}`, difficulty: 'easy' });
      engine.startRun();
      arrange?.(internalsOf(engine));
      const before = engine.snapshot();

      expect(() => act(engine)).not.toThrow();
      expect(engine.snapshot()).toEqual(before);
    }
  });

  it('beat/quarterReview の stale payload は対象 phase 以外で無視する', () => {
    const cases: Array<{
      name: string;
      arrange: (internals: PhaseGuardInternals) => void;
      act: (engine: RunEngine) => void;
    }> = [
      {
        name: 'resolveBeat',
        arrange: (internals) => {
          internals.beat = { eventId: 'urgent-demo', kind: 'decision' };
        },
        act: (engine) => engine.resolveBeat(0),
      },
      {
        name: 'acknowledgeQuarterReview',
        arrange: (internals) => {
          internals.quarterReview = makeQuarterReview('met');
        },
        act: (engine) => engine.acknowledgeQuarterReview(),
      },
      {
        name: 'chooseGoalAdjustment',
        arrange: (internals) => {
          internals.quarterReview = makeQuarterReview('missed_adjustable');
        },
        act: (engine) => engine.chooseGoalAdjustment('cut_scope'),
      },
    ];

    for (const { name, arrange, act } of cases) {
      const engine = new RunEngine({ seed: `ri72-d1-${name}`, difficulty: 'easy' });
      engine.startRun();
      arrange(internalsOf(engine));
      const before = engine.snapshot();

      expect(() => act(engine)).not.toThrow();
      expect(engine.snapshot()).toEqual(before);
    }
  });
});

describe('フェーズ遷移の検証（setPhase / 遷移表。RI-39）', () => {
  type PhaseInternals = { setPhase(next: RunState['phase']): void };

  it('遷移表に無い遷移は RunPhaseError を投げる', () => {
    const e = new RunEngine({ seed: 'phase-guard', difficulty: 'normal' });
    const internals = e as unknown as PhaseInternals;
    // title からは setup 以外へ進めない。
    expect(() => internals.setPhase('won')).toThrow(RunPhaseError);
    expect(() => internals.setPhase('sprint')).toThrow(RunPhaseError);
    // 表にあるエッジ（title → setup）は通る。
    expect(() => internals.setPhase('setup')).not.toThrow();
    expect(e.snapshot().phase).toBe('setup');
    // setup からの逆行（→ title）は resetPhase の領分で、setPhase では不正。
    expect(() => internals.setPhase('title')).toThrow(RunPhaseError);
  });

  it('タイトル・終端フェーズでは組織レバーが発動しない', () => {
    const title = new RunEngine({ seed: 'lever-title', difficulty: 'normal' });
    expect(title.applyOrgLever('aiGuideline')).toBe(false);
    expect(title.snapshot().phase).toBe('title');

    const finished = new RunEngine({ seed: 'lever-finished', difficulty: 'easy' });
    const s = playRun(finished);
    expect(['won', 'lost']).toContain(s.phase);
    expect(finished.applyOrgLever('aiGuideline')).toBe(false);
    expect(finished.snapshot().phase).toBe(s.phase);
  });
});

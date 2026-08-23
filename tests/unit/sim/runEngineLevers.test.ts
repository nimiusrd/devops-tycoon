/**
 * RunEngine の advanceOtherTeams / applyOrgLever / buildOrgScale まわりの
 * ミューテーション回帰テスト。Stryker の Survived / NoCoverage mutation を
 * exact 断言で潰す（旧 RI-91-A5）。
 */
import { describe, expect, it } from 'vitest';
import type { CardInstance } from '../../../src/sim/cards';
import { activeEngineerCount, type RosterState } from '../../../src/sim/member';
import {
  deriveTeamCapacities,
  engineersFromRoster,
  type TeamRunState,
} from '../../../src/sim/orgscale';
import { RunEngine } from '../../../src/sim/run/engine';
import type { GoalAdjustmentId, RunState, RunTotals } from '../../../src/sim/run/types';
import type { OrgState, SprintState, Task } from '../../../src/sim/types';

type A5Internals = {
  activeTeamId: string;
  budget: number;
  coarseIncidentCarry: number;
  deck: CardInstance[];
  difficulty: RunState['difficulty'];
  evolution: RunState['evolution'];
  homeTeamId: string;
  org: OrgState;
  orgAdjust: {
    company: {
      aiDependencyDelta: number;
      infraBoost: number;
      extraTeams: number;
      reviewQueueDelta: number;
    };
    byDept: Record<
      string,
      {
        aiDependencyDelta: number;
        reviewQueueDelta: number;
        incidentDelta: number;
        moraleDelta: number;
        techDebtDelta: number;
        extraTeams: number;
        infraBoost: number;
      }
    >;
    byTeam: Record<string, unknown>;
  };
  goalCarryoverQuarter: number | null;
  goalCarryoverId: GoalAdjustmentId | null;
  phase: RunState['phase'];
  quarterNumber: number;
  quarterTotals: RunTotals;
  relics: string[];
  roster: RosterState;
  sprint: SprintState | null;
  sprintsPlayed: number;
  status: RunState['status'];
  teamLockUntilSprint: number;
  teamRosters: Record<string, RosterState>;
  teams: TeamRunState[];
  totals: RunTotals;
  trials: string[];
  advanceOtherTeams(stepKey: string): void;
  flushCoarseIncidentCarry(): void;
};

const asInternals = (engine: RunEngine): A5Internals => engine as unknown as A5Internals;

function createEngine(seed = 'ri-91-a5'): RunEngine {
  const engine = new RunEngine({ seed, difficulty: 'normal' });
  engine.startRun();
  return engine;
}

function makeRoster(template: RosterState, count: number, prefix: string): RosterState {
  return {
    nextId: count,
    members: Array.from({ length: count }, (_, n) => ({
      ...template.members[0]!,
      id: `${prefix}-${n}`,
      assignment: 'coding' as const,
      onLeave: false,
      stamina: template.members[0]!.staminaMax,
    })),
  };
}

function taskFrom(base: Task, patch: Partial<Task>): Task {
  return {
    ...base,
    id: patch.id ?? base.id,
    lane: patch.lane ?? base.lane,
    progress: patch.progress ?? base.progress,
    incident: patch.incident ?? false,
    burnTicksLeft: patch.burnTicksLeft,
    reworkAttempts: patch.reworkAttempts ?? 0,
    wasReworked: patch.wasReworked ?? false,
    debt: patch.debt ?? false,
  };
}

describe('RI-91-A5 advanceOtherTeams headcount/engineers sync', () => {
  it('ghost roster は無視し、teams[0] の idx===0 同期はスキップしない', () => {
    const engine = createEngine('ri-91-a5-ghost-idx0');
    const i = asInternals(engine);
    i.teamLockUntilSprint = 0;
    // active を teams[0] 以外へ移し、idx===0 枝を通す。
    const zero = i.teams[0]!;
    const other = i.teams.find((t) => t.id !== zero.id)!;
    expect(engine.enterTeam(other.id)).toBe(true);
    expect(i.activeTeamId).not.toBe(zero.id);
    expect(i.teams[0]!.id).toBe(zero.id);

    i.teamRosters.ghost = makeRoster(i.roster, 3, 'ghost');
    const roster0 = makeRoster(i.roster, 5, 'idx0');
    i.teamRosters[zero.id] = roster0;
    i.teams[0] = {
      ...i.teams[0]!,
      engineers: 1,
      headcount: 1,
      reviewCapacity: 11,
      incidentBias: 0.03,
    };
    const teams0Id = i.teams[0]!.id;
    const beforeGhostEngineers = i.teams.map((t) => t.engineers);

    i.advanceOtherTeams('ghost-idx0');

    const synced = i.teams.find((t) => t.id === teams0Id)!;
    const counts = engineersFromRoster(
      { engineers: 1, headcount: 1 },
      // recoverStamina 後も全員 coding なら稼働は 5 のまま
      i.teamRosters[teams0Id]!,
    );
    expect(synced.engineers).toBe(counts.engineers);
    expect(synced.headcount).toBe(counts.headcount);
    expect(synced.engineers).toBe(5);
    expect(synced.headcount).toBe(5);
    const caps = deriveTeamCapacities({
      engineers: 5,
      reviewQueue: synced.reviewQueue,
      incidents: synced.incidents,
      quality: synced.quality,
    });
    expect(synced.reviewCapacity).toBe(caps.reviewCapacity);
    expect(synced.incidentBias).toBe(caps.incidentBias);
    // ghost だけでは teams を壊さない（長さ維持）。
    expect(i.teams).toHaveLength(beforeGhostEngineers.length);
    expect(i.teamRosters.ghost).toBeTruthy();
  });

  it('headcount 未定義の一致時は同期をスキップし、不一致時は ?? 経由で書き戻す', () => {
    const engine = createEngine('ri-91-a5-headcount-nullish');
    const i = asInternals(engine);
    i.teamLockUntilSprint = 0;
    const zero = i.teams[0]!;
    const other = i.teams.find((t) => t.id !== zero.id)!;
    expect(engine.enterTeam(other.id)).toBe(true);

    // 一致ケース: engineers がロスター席以上 → (undefined ?? engineers) === counts.headcount
    const matchRoster = makeRoster(i.roster, 4, 'match');
    i.teamRosters[zero.id] = matchRoster;
    const matchTeam: TeamRunState = {
      ...i.teams[0]!,
      engineers: 8,
      reviewCapacity: 11,
      incidentBias: 0.03,
    };
    delete matchTeam.headcount;
    i.teams[0] = matchTeam;
    const matchCounts = engineersFromRoster(matchTeam, matchRoster);
    expect(matchCounts.engineers).toBe(8);
    expect(matchCounts.headcount).toBe(8);

    i.advanceOtherTeams('headcount-match');
    const afterMatch = i.teams.find((t) => t.id === zero.id)!;
    expect(afterMatch.engineers).toBe(8);
    expect(afterMatch.headcount).toBeUndefined();
    // 一致なら deriveTeamCapacities を呼ばない（偽の capacities が残る）。
    // ただし coarse 進行で capacities は再計算されるため、headcount 未定義の維持で判定する。

    // 不一致ケース: headcount 未定義 + engineers 不足 → NoCoverage の ?? 枝を通して同期
    const mismatchRoster = makeRoster(i.roster, 6, 'mismatch');
    i.teamRosters[zero.id] = mismatchRoster;
    const mismatchTeam: TeamRunState = {
      ...i.teams.find((t) => t.id === zero.id)!,
      engineers: 2,
      reviewCapacity: 11,
      incidentBias: 0.03,
    };
    delete mismatchTeam.headcount;
    const idx = i.teams.findIndex((t) => t.id === zero.id);
    i.teams[idx] = mismatchTeam;

    i.advanceOtherTeams('headcount-mismatch');
    const afterMismatch = i.teams.find((t) => t.id === zero.id)!;
    expect(afterMismatch.engineers).toBe(6);
    expect(afterMismatch.headcount).toBe(6);
    const caps = deriveTeamCapacities({
      engineers: 6,
      reviewQueue: afterMismatch.reviewQueue,
      incidents: afterMismatch.incidents,
      quality: afterMismatch.quality,
    });
    expect(afterMismatch.reviewCapacity).toBe(caps.reviewCapacity);
    expect(afterMismatch.incidentBias).toBe(caps.incidentBias);

    // engineers は一致、古い headcount だけ不一致 → 後段比較を無視する変異を殺す
    const headOnlyRoster = makeRoster(i.roster, 4, 'head-only');
    i.teamRosters[zero.id] = headOnlyRoster;
    const headOnlyIdx = i.teams.findIndex((t) => t.id === zero.id);
    i.teams[headOnlyIdx] = {
      ...i.teams[headOnlyIdx]!,
      engineers: 4,
      headcount: 2,
    };
    const headOnlyCounts = engineersFromRoster(i.teams[headOnlyIdx]!, headOnlyRoster);
    expect(headOnlyCounts.engineers).toBe(4);
    expect(headOnlyCounts.headcount).toBe(4);

    i.advanceOtherTeams('headcount-only-mismatch');
    const afterHeadOnly = i.teams.find((t) => t.id === zero.id)!;
    expect(afterHeadOnly.engineers).toBe(4);
    expect(afterHeadOnly.headcount).toBe(4);
  });

  it('active チームの roster は advanceOtherTeams の同期対象外', () => {
    const engine = createEngine('ri-91-a5-active-skip');
    const i = asInternals(engine);
    const activeId = i.activeTeamId;
    i.teamRosters[activeId] = makeRoster(i.roster, 6, 'active-cache');
    const activeIdx = i.teams.findIndex((t) => t.id === activeId);
    i.teams[activeIdx] = {
      ...i.teams[activeIdx]!,
      engineers: 1,
      headcount: 1,
    };
    i.roster = makeRoster(i.roster, 6, 'live-active');

    i.advanceOtherTeams('active-skip');
    expect(i.teams[activeIdx]!.engineers).toBe(1);
    expect(i.teams[activeIdx]!.headcount).toBe(1);
  });

  it('粗粒度の completed / aiAssisted 加算と before 側 reviewQueuePeak を exact に積む', () => {
    const engine = createEngine('ri-91-a5-totals-peak');
    const i = asInternals(engine);
    const inactive = i.teams.find((t) => t.id !== i.activeTeamId)!;
    const idx = i.teams.findIndex((t) => t.id === inactive.id);
    i.teams[idx] = { ...inactive, reviewQueue: 40 };
    i.totals.reviewQueuePeak = 10;
    i.quarterTotals.reviewQueuePeak = 10;
    i.totals.completed = 100;
    i.totals.aiAssisted = 50;
    i.quarterTotals.completed = 20;
    i.quarterTotals.aiAssisted = 10;

    i.advanceOtherTeams('totals-peak');

    // seed 固定: completed +5 / aiAssisted +1（加算削除や -= 変異を殺す）
    expect(i.totals.completed).toBe(105);
    expect(i.quarterTotals.completed).toBe(25);
    expect(i.totals.aiAssisted).toBe(51);
    expect(i.quarterTotals.aiAssisted).toBe(11);
    // ステップ前 40 がピークになる（after は 38 へ減る seed）
    expect(i.totals.reviewQueuePeak).toBe(40);
    expect(i.quarterTotals.reviewQueuePeak).toBe(40);
  });

  it('非中立な shipMul（pauseAiDebuff）が粗粒度 delivered に効く', () => {
    const engine = createEngine('ri-91-a5-mod-pause');
    const i = asInternals(engine);
    i.goalCarryoverQuarter = i.quarterNumber;
    i.goalCarryoverId = 'pause_ai_rollout';
    i.totals.delivered = 0;
    i.totals.completed = 0;
    i.quarterTotals.delivered = 0;
    i.quarterTotals.completed = 0;

    i.advanceOtherTeams('mod');

    // pause 無しなら delivered=25（RI-77 粗粒度 AI 出荷倍率後）。modifiers/shipMul 無視変異を殺す。
    expect(i.totals.delivered).toBe(21);
    expect(i.quarterTotals.delivered).toBe(21);
    expect(i.totals.completed).toBe(4);
  });

  it('RI-83: pause_ai の reworkRateAdd が粗粒度の非選択チーム行列を下げる', () => {
    const base = createEngine('ri-83-coarse-rework');
    const withPause = createEngine('ri-83-coarse-rework');
    const baseI = asInternals(base);
    const pauseI = asInternals(withPause);
    for (const i of [baseI, pauseI]) {
      i.teams = i.teams.map((t) =>
        t.id === i.activeTeamId ? t : { ...t, reviewQueue: 12, engineers: 8, reviewCapacity: 10 },
      );
    }
    pauseI.goalCarryoverQuarter = pauseI.quarterNumber;
    pauseI.goalCarryoverId = 'pause_ai_rollout';

    baseI.advanceOtherTeams('rework');
    pauseI.advanceOtherTeams('rework');

    const baseQueues = baseI.teams
      .filter((t) => t.id !== baseI.activeTeamId)
      .map((t) => t.reviewQueue);
    const pauseQueues = pauseI.teams
      .filter((t) => t.id !== pauseI.activeTeamId)
      .map((t) => t.reviewQueue);
    expect(pauseQueues.every((q, idx) => q <= baseQueues[idx]!)).toBe(true);
    expect(pauseQueues.some((q, idx) => q < baseQueues[idx]!)).toBe(true);
  });

  it('foldRunEffects 由来の粗粒度 modifiers が非 active へ効く', () => {
    const engine = createEngine('ri-91-a5-fold-mods');
    const i = asInternals(engine);
    // incidentRateMul / reviewMul / reviewCapacityMul / aiDependencyDrift を非中立化
    i.relics = ['postmortem', 'small-pr', 'flow-first'];
    i.trials = ['frontier-dependency'];
    i.teams = i.teams.map((t) =>
      t.id === i.activeTeamId ? t : { ...t, reviewQueue: 10, aiDependency: 40, incidents: 1 },
    );

    i.advanceOtherTeams('fold');

    const others = i.teams.filter((t) => t.id !== i.activeTeamId);
    // drift=5 (+稀に +1)。mods を 1/1/1/0 に固定する変異を殺す。
    expect(others.map((t) => t.aiDependency)).toEqual([46, 45, 45, 45, 45, 45, 45, 45, 46]);
    // reviewCapacityMul/reviewMul により行列が中立時より下がる
    expect(others.map((t) => t.reviewQueue)).toEqual([5, 7, 9, 6, 6, 7, 7, 6, 7]);
  });

  it('粗粒度炎上 carry を加算し flush で incidents へ繰り入れる', () => {
    const engine = createEngine('ri-91-a5-carry');
    const i = asInternals(engine);
    i.coarseIncidentCarry = 0.9;
    i.totals.incidents = 0;
    i.quarterTotals.incidents = 0;

    i.advanceOtherTeams('carry1');
    // incidents + incidentCarry（減算変異だと負寄りになり flush が潰れる）
    expect(i.coarseIncidentCarry).toBeCloseTo(1.1222222222222222, 10);
    expect(i.totals.incidents).toBe(0);

    i.flushCoarseIncidentCarry();
    expect(i.coarseIncidentCarry).toBe(0);
    expect(i.totals.incidents).toBe(1);
    expect(i.quarterTotals.incidents).toBe(1);
  });

  it('粗粒度進行後に増えた reviewQueue もピークへ反映する', () => {
    const engine = createEngine('ri-91-a5-peak-after-1');
    const i = asInternals(engine);
    // before ループだけでは peak=0 のまま。after ループが必須。
    i.teams = i.teams.map((t) =>
      t.id === i.activeTeamId
        ? t
        : {
            ...t,
            reviewQueue: 0,
            engineers: 14,
            aiDependency: 95,
            reviewCapacity: 8,
          },
    );
    i.totals.reviewQueuePeak = 0;
    i.quarterTotals.reviewQueuePeak = 0;

    i.advanceOtherTeams('peak-after');

    const afterMax = Math.max(
      ...i.teams.filter((t) => t.id !== i.activeTeamId).map((t) => t.reviewQueue),
    );
    expect(afterMax).toBe(11);
    expect(i.totals.reviewQueuePeak).toBe(11);
    expect(i.quarterTotals.reviewQueuePeak).toBe(11);
  });
});

describe('RI-91-A5 applyOrgLever effects', () => {
  it('phase===won / lost ではレバーを拒否し予算を消費しない', () => {
    for (const terminal of ['won', 'lost'] as const) {
      const engine = createEngine(`ri-91-a5-${terminal}-guard`);
      const i = asInternals(engine);
      i.phase = terminal;
      i.status = terminal;
      i.budget = 100;
      const teamsBefore = i.teams.map((t) => t.aiDependency);
      const adjustBefore = structuredClone(i.orgAdjust);
      expect(engine.applyOrgLever('aiGuideline')).toBe(false);
      expect(i.budget).toBe(100);
      expect(i.teams.map((t) => t.aiDependency)).toEqual(teamsBefore);
      expect(i.orgAdjust).toEqual(adjustBefore);
    }
  });

  it('入り込みロック中は他チームレバーを拒否し、解除後は成功する', () => {
    const engine = createEngine('ri-91-a5-team-lock');
    const i = asInternals(engine);
    i.budget = 100;
    const active = i.activeTeamId;
    const other = i.teams.find((t) => t.id !== active)!.id;
    const otherBefore = i.teams.find((t) => t.id === other)!.reviewQueue;
    const activeBefore = i.teams.find((t) => t.id === active)!.reviewQueue;

    i.teamLockUntilSprint = i.sprintsPlayed + 2;
    expect(engine.applyOrgLever('teamReviewHelp', undefined, other)).toBe(false);
    expect(i.budget).toBe(100);
    expect(i.teams.find((t) => t.id === other)!.reviewQueue).toBe(otherBefore);

    // ロック中でも滞在中チームへの施策は許可する（全拒否変異を殺す）
    expect(engine.applyOrgLever('teamReviewHelp', undefined, active)).toBe(true);
    expect(i.budget).toBe(94);
    expect(i.teams.find((t) => t.id === active)!.reviewQueue).toBe(Math.max(0, activeBefore - 5));

    i.teamLockUntilSprint = 0;
    expect(engine.applyOrgLever('teamReviewHelp', undefined, other)).toBe(true);
    expect(i.budget).toBe(88);
    expect(i.teams.find((t) => t.id === other)!.reviewQueue).toBe(Math.max(0, otherBefore - 5));
  });

  it('extraTeamsAdded===0 ではチーム数不変、recruitDraft では +1 と baseline 継承', () => {
    const engine = createEngine('ri-91-a5-extra-teams');
    const i = asInternals(engine);
    i.budget = 200;
    i.teamLockUntilSprint = 0;
    const teamCount = i.teams.length;
    const homeId = i.homeTeamId;
    const nonHome = i.teams.find((t) => t.id !== homeId)!;
    // home をテンプレにするため、active を非ホームへ移して sync で上書きしない
    expect(engine.enterTeam(nonHome.id)).toBe(true);

    i.deck = [
      {
        defId: 'auto-test',
        level: 1,
        baselineAppliedByTeam: { [homeId]: 1 },
      },
      ...i.deck,
    ];

    expect(engine.applyOrgLever('aiGuideline')).toBe(true);
    expect(i.teams).toHaveLength(teamCount);

    // recruit 直前に home / 非 home を分岐させ、テンプレ選択を固定する
    const homeIdx = i.teams.findIndex((t) => t.id === homeId);
    const nonHomeIdx = i.teams.findIndex((t) => t.id === nonHome.id);
    i.teams[homeIdx] = {
      ...i.teams[homeIdx]!,
      aiDependency: 55,
      morale: 88,
      techDebt: 11,
      engineers: 7,
      headcount: 7,
      shipping: 100,
    };
    i.teams[nonHomeIdx] = {
      ...i.teams[nonHomeIdx]!,
      aiDependency: 99,
      morale: 10,
      techDebt: 90,
      engineers: 2,
      headcount: 2,
      shipping: 10,
    };

    const existingNonHome = nonHome.id;
    const idsBefore = new Set(i.teams.map((t) => t.id));
    expect(engine.applyOrgLever('recruitDraft')).toBe(true);
    expect(i.teams).toHaveLength(teamCount + 1);
    const newIds = i.teams.filter((t) => !idsBefore.has(t.id)).map((t) => t.id);
    expect(newIds).toHaveLength(1);
    const card = i.deck.find((c) => c.defId === 'auto-test')!;
    expect(card.baselineAppliedByTeam?.[newIds[0]!]).toBe(1);
    expect(card.baselineAppliedByTeam?.[homeId]).toBe(1);
    // 既存の非ホームには継承しない（全チームへ newIds 誤伝播を殺す）
    expect(card.baselineAppliedByTeam?.[existingNonHome]).toBeUndefined();
    expect(Object.keys(card.baselineAppliedByTeam ?? {}).sort()).toEqual(
      [homeId, newIds[0]!].sort(),
    );

    // 新チームは home テンプレート由来（非 home を誤選択する変異を殺す）
    const neu = i.teams.find((t) => t.id === newIds[0]!)!;
    expect(neu.aiDependency).toBe(39);
    expect(neu.morale).toBe(79);
    expect(neu.techDebt).toBe(1);
    expect(neu.engineers).toBe(8);
    expect(Math.abs(neu.aiDependency - 55)).toBeLessThan(Math.abs(neu.aiDependency - 99));
    expect(Math.abs(neu.morale - 85)).toBeLessThan(Math.abs(neu.morale - 7));
  });

  it('company レバーは全チームへ焼き込み、org 同期と metric strip を行う', () => {
    const engine = createEngine('ri-91-a5-company-effect');
    const i = asInternals(engine);
    i.budget = 100;
    i.teamLockUntilSprint = 0;
    const homeId = i.homeTeamId;
    const nonHome = i.teams.find((t) => t.id !== homeId)!;
    expect(engine.enterTeam(nonHome.id)).toBe(true);
    expect(i.activeTeamId).toBe(nonHome.id);
    expect(i.activeTeamId).not.toBe(i.teams[0]!.id);

    // 非ホーム固有の依存度を付け、先頭チーム同期変異を殺す
    const activeIdx = i.teams.findIndex((t) => t.id === nonHome.id);
    i.teams[activeIdx] = { ...i.teams[activeIdx]!, aiDependency: 77 };
    i.org = { ...i.org, aiDependency: 77 };
    const homeIdx = i.teams.findIndex((t) => t.id === homeId);
    i.teams[homeIdx] = { ...i.teams[homeIdx]!, aiDependency: 40 };

    const beforeDeps = i.teams.map((t) => ({ id: t.id, aiDependency: t.aiDependency }));

    expect(engine.applyOrgLever('aiGuideline')).toBe(true);
    expect(i.budget).toBe(75);
    for (const prev of beforeDeps) {
      const team = i.teams.find((t) => t.id === prev.id)!;
      expect(team.aiDependency).toBe(prev.aiDependency - 16);
    }
    const active = i.teams.find((t) => t.id === i.activeTeamId)!;
    expect(active.id).toBe(nonHome.id);
    expect(i.org.aiDependency).toBe(61);
    expect(i.org.aiDependency).toBe(active.aiDependency);
    expect(i.org.aiDependency).not.toBe(i.teams[homeIdx]!.aiDependency);
    expect(i.orgAdjust.company.aiDependencyDelta).toBe(0);
    expect(i.orgAdjust.company.infraBoost).toBe(6);
  });

  it('sprint 中の全社レバーは盤面も align する', () => {
    const engine = createEngine('ri-91-a5-company-sprint-align');
    engine.beginSetupSprint();
    const i = asInternals(engine);
    i.budget = 100;
    i.teamLockUntilSprint = 0;
    i.sprint!.metrics.contained = 0;
    const base = i.sprint!.tasks[0]!;
    i.sprint!.tasks = [
      taskFrom(base, { id: 700, lane: 'review', incident: false, progress: 0.2 }),
      taskFrom(base, { id: 701, lane: 'review', incident: false, progress: 0.3 }),
      taskFrom(base, { id: 702, lane: 'review', incident: false, progress: 0.4 }),
      taskFrom(base, { id: 703, lane: 'review', incident: true, burnTicksLeft: 2 }),
    ];
    expect(i.sprint!.tasks.filter((t) => t.lane === 'review')).toHaveLength(4);

    // reviewQueueDelta -3 → sync(4) 後に 1。activeTouched 無しだと盤面は 4 のまま。
    expect(engine.applyOrgLever('infraInvest')).toBe(true);
    expect(i.budget).toBe(65);
    const remaining = i.sprint!.tasks.filter((t) => t.lane === 'review');
    expect(remaining).toHaveLength(1);
    expect(remaining.every((t) => t.incident)).toBe(true);
    const active = i.teams.find((t) => t.id === i.activeTeamId)!;
    expect(active.reviewQueue).toBe(1);
  });

  it('department レバーは対象部門のみ更新し、active が別部門なら org/align しない', () => {
    const engine = createEngine('ri-91-a5-dept-other');
    engine.beginSetupSprint();
    const i = asInternals(engine);
    i.budget = 100;
    i.teamLockUntilSprint = 0;

    const active = i.teams.find((t) => t.id === i.activeTeamId)!;
    const otherDeptTeam = i.teams.find((t) => t.deptId !== active.deptId)!;
    expect(otherDeptTeam).toBeTruthy();
    const targetDept = otherDeptTeam.deptId;

    const base = i.sprint!.tasks[0]!;
    i.sprint!.tasks = [
      taskFrom(base, { id: 500, lane: 'review', incident: false, progress: 0.2 }),
      taskFrom(base, { id: 501, lane: 'review', incident: false, progress: 0.3 }),
      taskFrom(base, { id: 502, lane: 'review', incident: true, burnTicksLeft: 3 }),
    ];
    const reviewBefore = i.sprint!.tasks.filter((t) => t.lane === 'review').length;
    const orgDepBefore = i.org.aiDependency;
    const targetBefore = i.teams
      .filter((t) => t.deptId === targetDept)
      .map((t) => ({ id: t.id, reviewQueue: t.reviewQueue }));
    // syncActiveTeamFromOrg が先に走るため、非 active の他部門だけ effect 非適用を検証する。
    const otherDeptBefore = i.teams
      .filter((t) => t.deptId !== targetDept && t.id !== active.id)
      .map((t) => ({ id: t.id, reviewQueue: t.reviewQueue }));

    expect(engine.applyOrgLever('reviewReinforce', targetDept)).toBe(true);
    expect(i.budget).toBe(88);

    for (const prev of targetBefore) {
      const team = i.teams.find((t) => t.id === prev.id)!;
      expect(team.reviewQueue).toBe(Math.max(0, prev.reviewQueue - 4));
    }
    for (const prev of otherDeptBefore) {
      const team = i.teams.find((t) => t.id === prev.id)!;
      expect(team.reviewQueue).toBe(prev.reviewQueue);
    }
    // active は別部門 → orgFromTeam 非適用・sprint 非 align（activeTouched=false）
    expect(i.org.aiDependency).toBe(orgDepBefore);
    expect(i.sprint!.tasks.filter((t) => t.lane === 'review')).toHaveLength(reviewBefore);
    // 部門 metric は焼き込み後に strip（二重適用を防ぐ）
    const deptAdj = i.orgAdjust.byDept[targetDept];
    expect(deptAdj).toBeTruthy();
    expect(deptAdj.reviewQueueDelta).toBe(0);
    expect(deptAdj.aiDependencyDelta).toBe(0);
    expect(deptAdj.incidentDelta).toBe(0);
    expect(deptAdj.moraleDelta).toBe(0);
    expect(deptAdj.techDebtDelta).toBe(0);
  });

  it('department レバーは active 部門なら org 同期と sprint 盤面 align を行う', () => {
    const engine = createEngine('ri-91-a5-dept-active');
    const i = asInternals(engine);
    i.budget = 100;
    i.teamLockUntilSprint = 0;
    // 先頭/ホーム以外へ入り、active 検索を teams[0] 固定する変異を殺す
    const nonHome = i.teams.find((t) => t.id !== i.homeTeamId && t.id !== i.teams[0]!.id)!;
    expect(engine.enterTeam(nonHome.id)).toBe(true);
    expect(i.activeTeamId).not.toBe(i.teams[0]!.id);
    i.teamLockUntilSprint = 0;
    engine.beginSetupSprint();
    i.sprint!.metrics.contained = 0;

    const activeIdx = i.teams.findIndex((t) => t.id === i.activeTeamId);
    i.teams[activeIdx] = { ...i.teams[activeIdx]!, aiDependency: 73 };
    i.org = { ...i.org, aiDependency: 73 };
    const active = i.teams[activeIdx]!;
    const targetDept = active.deptId;
    const base = i.sprint!.tasks[0]!;
    // 非炎上 Review 3 + 炎上 Review 1。sync→effect(-4)→align で非炎上だけ消え炎上1が残る。
    i.sprint!.tasks = [
      taskFrom(base, { id: 510, lane: 'review', incident: false, progress: 0.2 }),
      taskFrom(base, { id: 511, lane: 'review', incident: false, progress: 0.3 }),
      taskFrom(base, { id: 512, lane: 'review', incident: false, progress: 0.4 }),
      taskFrom(base, { id: 513, lane: 'review', incident: true, burnTicksLeft: 3 }),
    ];
    const reviewsBefore = i.sprint!.tasks.filter((t) => t.lane === 'review').length;
    expect(reviewsBefore).toBe(4);

    expect(engine.applyOrgLever('reviewReinforce', targetDept)).toBe(true);
    expect(i.budget).toBe(88);

    const updated = i.teams.find((t) => t.id === active.id)!;
    const remainingReviews = i.sprint!.tasks.filter((t) => t.lane === 'review');
    // activeTouched 経路が無いと盤面は 4 のまま残る
    expect(remainingReviews).toHaveLength(1);
    expect(remainingReviews.every((t) => t.incident)).toBe(true);
    expect(updated.reviewQueue).toBe(1);
    expect(i.org.aiDependency).toBe(updated.aiDependency);
    expect(i.org.aiDependency).toBe(73);
    expect(i.org.aiDependency).not.toBe(i.teams[0]!.aiDependency);
  });

  it('team レバーは非 active では org/align せず、active では盤面を揃える', () => {
    const engine = createEngine('ri-91-a5-team-scope');
    engine.beginSetupSprint();
    const i = asInternals(engine);
    i.budget = 100;
    i.teamLockUntilSprint = 0;
    i.sprint!.metrics.contained = 0;

    const activeId = i.activeTeamId;
    const otherId = i.teams.find((t) => t.id !== activeId)!.id;
    const base = i.sprint!.tasks[0]!;
    i.sprint!.tasks = [
      taskFrom(base, { id: 600, lane: 'review', incident: false, progress: 0.2 }),
      taskFrom(base, { id: 601, lane: 'review', incident: false, progress: 0.4 }),
      taskFrom(base, { id: 602, lane: 'review', incident: true, burnTicksLeft: 4 }),
    ];
    const reviewsBefore = i.sprint!.tasks.filter((t) => t.lane === 'review').length;
    const orgBefore = { ...i.org };
    const otherQueue = i.teams.find((t) => t.id === otherId)!.reviewQueue;

    expect(engine.applyOrgLever('teamReviewHelp', undefined, otherId)).toBe(true);
    expect(i.teams.find((t) => t.id === otherId)!.reviewQueue).toBe(Math.max(0, otherQueue - 5));
    expect(i.sprint!.tasks.filter((t) => t.lane === 'review')).toHaveLength(reviewsBefore);
    expect(i.org.aiDependency).toBe(orgBefore.aiDependency);
    expect(i.org.morale).toBe(orgBefore.morale);

    expect(engine.applyOrgLever('teamReviewHelp', undefined, activeId)).toBe(true);
    const remainingReviews = i.sprint!.tasks.filter((t) => t.lane === 'review');
    const active = i.teams.find((t) => t.id === activeId)!;
    expect(remainingReviews).toHaveLength(active.reviewQueue);
    expect(active.reviewQueue).toBe(remainingReviews.length);

    // active 施策後の org は対象チーム指標へ同期する（別チーム検索変異を殺す）
    const activeIdx = i.teams.findIndex((t) => t.id === activeId);
    const otherIdx = i.teams.findIndex((t) => t.id === otherId);
    i.teams[activeIdx] = { ...i.teams[activeIdx]!, aiDependency: 80, morale: 40 };
    i.teams[otherIdx] = { ...i.teams[otherIdx]!, aiDependency: 20, morale: 90 };
    i.org = { ...i.org, aiDependency: 80, morale: 40 };
    i.budget = 100;
    expect(engine.applyOrgLever('teamAiThrottle', undefined, activeId)).toBe(true);
    expect(i.teams.find((t) => t.id === activeId)!.aiDependency).toBe(64);
    expect(i.org.aiDependency).toBe(64);
    expect(i.org.aiDependency).not.toBe(i.teams.find((t) => t.id === otherId)!.aiDependency);
  });
});

describe('RI-91-A5 buildOrgScale', () => {
  it('liveEngineers は team.engineers と roster 稼働の Math.max', () => {
    const engine = createEngine('ri-91-a5-live-engineers');
    const i = asInternals(engine);
    const activeIdx = i.teams.findIndex((t) => t.id === i.activeTeamId);
    // roster 稼働 < team.engineers → max は team 側
    i.teams[activeIdx] = { ...i.teams[activeIdx]!, engineers: 9 };
    i.roster = makeRoster(i.roster, 3, 'live-low');
    expect(activeEngineerCount(i.roster)).toBe(3);
    engine.zoomTo('company');
    const highTeam = engine
      .snapshot()
      .orgScale!.departments.flatMap((d) => d.teams)
      .find((t) => t.id === i.activeTeamId)!;
    expect(highTeam.engineers).toBe(9);

    // roster 稼働 > team.engineers → max は roster 側（min 変異を殺す）
    i.teams[activeIdx] = { ...i.teams[activeIdx]!, engineers: 2 };
    i.roster = makeRoster(i.roster, 5, 'live-high');
    expect(activeEngineerCount(i.roster)).toBe(5);
    const lowTeam = engine
      .snapshot()
      .orgScale!.departments.flatMap((d) => d.teams)
      .find((t) => t.id === i.activeTeamId)!;
    expect(lowTeam.engineers).toBe(5);
  });

  it('active のライブ基盤値だけを全社 infra 集約へ載せる', () => {
    const engine = createEngine('ri-91-a5-infra');
    const i = asInternals(engine);
    i.teamLockUntilSprint = 0;
    const nonHome = i.teams.find((t) => t.id !== i.homeTeamId && t.id !== i.teams[0]!.id)!;
    expect(engine.enterTeam(nonHome.id)).toBe(true);
    expect(i.activeTeamId).not.toBe(i.teams[0]!.id);
    i.teamLockUntilSprint = 0;
    engine.beginSetupSprint();
    i.org = { ...i.org, testCoverage: 90, documentation: 80, aiLiteracy: 70 };
    i.teams = i.teams.map((t) =>
      t.id === i.activeTeamId
        ? { ...t, testCoverage: 10, documentation: 10, aiLiteracy: 10 }
        : { ...t, testCoverage: 20, documentation: 30, aiLiteracy: 40 },
    );
    engine.zoomTo('company');
    // active=org(90/80/70), 他9チーム=(20/30/40) → 平均 27/35/43
    // teams[0] 判定変異だとホーム側の TeamRunState(20/30/40) が混ざり平均がずれる
    expect(engine.snapshot().orgScale!.infra).toEqual({
      ci: 27,
      docs: 35,
      aiGuideline: 43,
    });
  });

  it('result フェーズは残存 sprint 盤面ではなく正本の行列・炎上を使う', () => {
    const engine = createEngine('ri-91-a5-result-board');
    engine.beginSetupSprint();
    const i = asInternals(engine);
    const base = i.sprint!.tasks[0]!;
    i.sprint!.tasks = [
      taskFrom(base, { id: 800, lane: 'review', incident: false }),
      taskFrom(base, { id: 801, lane: 'review', incident: true, burnTicksLeft: 2 }),
      taskFrom(base, { id: 802, lane: 'review', incident: true, burnTicksLeft: 1 }),
    ];
    const activeIdx = i.teams.findIndex((t) => t.id === i.activeTeamId);
    // 盤面 3/2 とも 0 とも異なる非ゼロ正本
    i.teams[activeIdx] = { ...i.teams[activeIdx]!, reviewQueue: 1, incidents: 5 };
    i.phase = 'result';
    i.teamLockUntilSprint = 0;
    engine.zoomTo('company');

    const projected = engine
      .snapshot()
      .orgScale!.departments.flatMap((d) => d.teams)
      .find((t) => t.id === i.activeTeamId)!;
    // phase==='sprint' 条件を外すと残存盤面の 3/2、&& 0 変異だと incidents=0
    expect(projected.reviewQueue).toBe(1);
    expect(projected.incidents).toBe(5);
  });
});

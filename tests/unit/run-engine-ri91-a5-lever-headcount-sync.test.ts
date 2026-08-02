/**
 * RI-91-A5: engine.ts advanceOtherTeams / applyOrgLever 周辺の Survived / NoCoverage を潰す。
 * 共有テストは触らず、単位専用ファイルで exact 断言する。
 */
import { describe, expect, it } from 'vitest';
import type { CardInstance } from '../../src/sim/cards';
import { activeEngineerCount, type RosterState } from '../../src/sim/member';
import {
  deriveTeamCapacities,
  engineersFromRoster,
  type TeamRunState,
} from '../../src/sim/orgscale';
import { RunEngine } from '../../src/sim/run/engine';
import type { RunState, RunTotals } from '../../src/sim/run/types';
import type { OrgState, SprintState, Task } from '../../src/sim/types';

type A5Internals = {
  activeTeamId: string;
  budget: number;
  deck: CardInstance[];
  homeTeamId: string;
  org: OrgState;
  orgAdjust: {
    company: { aiDependencyDelta: number; infraBoost: number; extraTeams: number };
    byDept: Record<string, unknown>;
    byTeam: Record<string, unknown>;
  };
  phase: RunState['phase'];
  quarterTotals: RunTotals;
  roster: RosterState;
  sprint: SprintState | null;
  sprintsPlayed: number;
  status: RunState['status'];
  teamLockUntilSprint: number;
  teamRosters: Record<string, RosterState>;
  teams: TeamRunState[];
  totals: RunTotals;
  advanceOtherTeams(stepKey: string): void;
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
  it('phase===won ではレバーを拒否し予算を消費しない', () => {
    const engine = createEngine('ri-91-a5-won-guard');
    const i = asInternals(engine);
    i.phase = 'won';
    i.status = 'won';
    i.budget = 100;
    const teamsBefore = i.teams.map((t) => t.aiDependency);
    expect(engine.applyOrgLever('aiGuideline')).toBe(false);
    expect(i.budget).toBe(100);
    expect(i.teams.map((t) => t.aiDependency)).toEqual(teamsBefore);
  });

  it('入り込みロック中は他チームレバーを拒否し、解除後は成功する', () => {
    const engine = createEngine('ri-91-a5-team-lock');
    const i = asInternals(engine);
    i.budget = 100;
    const active = i.activeTeamId;
    const other = i.teams.find((t) => t.id !== active)!.id;
    const otherBefore = i.teams.find((t) => t.id === other)!.reviewQueue;

    i.teamLockUntilSprint = i.sprintsPlayed + 2;
    expect(engine.applyOrgLever('teamReviewHelp', undefined, other)).toBe(false);
    expect(i.budget).toBe(100);
    expect(i.teams.find((t) => t.id === other)!.reviewQueue).toBe(otherBefore);

    i.teamLockUntilSprint = 0;
    expect(engine.applyOrgLever('teamReviewHelp', undefined, other)).toBe(true);
    expect(i.budget).toBe(94);
    expect(i.teams.find((t) => t.id === other)!.reviewQueue).toBe(Math.max(0, otherBefore - 5));
  });

  it('extraTeamsAdded===0 ではチーム数不変、recruitDraft では +1 と baseline 継承', () => {
    const engine = createEngine('ri-91-a5-extra-teams');
    const i = asInternals(engine);
    i.budget = 200;
    const teamCount = i.teams.length;
    const homeId = i.homeTeamId;

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

    const existingNonHome = i.teams.find((t) => t.id !== homeId)!.id;
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
  });

  it('company レバーは全チームへ焼き込み、org 同期と metric strip を行う', () => {
    const engine = createEngine('ri-91-a5-company-effect');
    const i = asInternals(engine);
    i.budget = 100;
    const beforeDeps = i.teams.map((t) => ({ id: t.id, aiDependency: t.aiDependency }));
    const activeBefore = i.org.aiDependency;

    expect(engine.applyOrgLever('aiGuideline')).toBe(true);
    expect(i.budget).toBe(75);
    for (const prev of beforeDeps) {
      const team = i.teams.find((t) => t.id === prev.id)!;
      expect(team.aiDependency).toBe(prev.aiDependency - 10);
    }
    const active = i.teams.find((t) => t.id === i.activeTeamId)!;
    expect(i.org.aiDependency).toBe(active.aiDependency);
    expect(i.org.aiDependency).toBe(activeBefore - 10);
    expect(i.orgAdjust.company.aiDependencyDelta).toBe(0);
    expect(i.orgAdjust.company.infraBoost).toBe(6);
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
  });
});

describe('RI-91-A5 buildOrgScale liveEngineers', () => {
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
});

/**
 * 組織スケールの RunEngine 連携検証（SPEC 第4.7〜4.11 / RI-64）。
 * ズーム階層の切り替え・部門フォーカス・レバー発動・業界ランキング生成を、
 * snapshot を通じて決定論で確認する。
 */
import { describe, expect, it } from 'vitest';
import { RunEngine } from '../../src/sim/run/engine';
import { DEPARTMENT_DEFS } from '../../src/data/departments';
import { diagnose } from '../../src/sim/diagnosis';
import {
  advanceCoarseTeams,
  assertDeptShippingInvariant,
  companyOrgFromTeams,
  deriveTeamCapacities,
  ENTER_TEAM_FOCUS_PENALTY,
  initTeamRunStates,
  normalizeCoarseTotalsDelta,
  orgFromTeam,
  syncTeamFromOrg,
} from '../../src/sim/orgscale';

function started(seed = 'org-engine'): RunEngine {
  const e = new RunEngine({ seed, difficulty: 'normal' });
  e.startRun('normal', [], seed);
  return e;
}

describe('RunEngine: ズーム階層', () => {
  it('初期は現場（team）で orgScale/industry は未生成', () => {
    const s = started().snapshot();
    expect(s.zoom.level).toBe('team');
    expect(s.orgScale).toBeNull();
    expect(s.industry).toBeNull();
    expect(s.teams.length).toBeGreaterThan(0);
    expect(s.activeTeamId).toBe('product-t0');
    expect(s.homeTeamId).toBe('product-t0');
  });

  it('全社へズームすると全社マップが生成される', () => {
    const e = started();
    e.zoomTo('company');
    const s = e.snapshot();
    expect(s.zoom.level).toBe('company');
    expect(s.orgScale).not.toBeNull();
    expect(s.orgScale!.teamCount).toBeGreaterThan(0);
    expect(s.industry).toBeNull();
  });

  it('部署へズームすると先頭部門がフォーカスされる', () => {
    const e = started();
    e.zoomTo('department');
    expect(e.snapshot().zoom.deptId).toBe(DEPARTMENT_DEFS[0].id);
  });

  it('部門を直接フォーカスすると部署ビューへ寄る', () => {
    const e = started();
    e.focusDepartment('platform');
    const s = e.snapshot();
    expect(s.zoom.level).toBe('department');
    expect(s.zoom.deptId).toBe('platform');
  });

  it('未知の部門 ID は無視される', () => {
    const e = started();
    e.focusDepartment('nope');
    expect(e.snapshot().zoom.level).toBe('team');
  });

  it('選択中のホームチームへ focus すると現場へ着地する', () => {
    const e = started();
    e.zoomTo('company');
    e.focusTeam('product-t0');
    const s = e.snapshot();
    expect(s.zoom.level).toBe('team');
    expect(s.zoom.teamId).toBe('product-t0');
    expect(s.orgScale).toBeNull();
  });

  it('他チームは状態確認として部署ビューへ寄せる（入り込みは enterTeam）', () => {
    const e = started();
    e.zoomTo('company');
    e.focusTeam('platform-t1');
    const s = e.snapshot();
    expect(s.zoom.level).toBe('department');
    expect(s.zoom.deptId).toBe('platform');
    expect(s.zoom.teamId).toBe('platform-t1');
    expect(s.orgScale).not.toBeNull();
  });

  it('enterTeam で他チームの現場へ入り込め、activeTeamId が切り替わる', () => {
    const e = started();
    e.zoomTo('company');
    expect(e.enterTeam('platform-t1')).toBe(true);
    const s = e.snapshot();
    expect(s.activeTeamId).toBe('platform-t1');
    expect(s.zoom.level).toBe('team');
    expect(s.teamLockUntilSprint).toBe(1);
    expect(s.pendingSprintModifiers.focusMaxAdd).toBe(ENTER_TEAM_FOCUS_PENALTY);
  });

  it('入り込み拘束中は他チームへ切り替えられない', () => {
    const e = started();
    expect(e.enterTeam('platform-t1')).toBe(true);
    expect(e.enterTeam('newbiz-t0')).toBe(false);
    expect(e.snapshot().activeTeamId).toBe('platform-t1');
  });

  it('未知のチーム ID は無視される', () => {
    const e = started();
    e.zoomTo('company');
    e.focusTeam('does-not-exist');
    expect(e.snapshot().zoom.level).toBe('company');
  });

  it('業界へズームするとランキングが生成され、種別を切り替えられる', () => {
    const e = started();
    e.zoomTo('industry');
    let s = e.snapshot();
    expect(s.industry).not.toBeNull();
    expect(s.industry!.kind).toBe('overall');
    expect(s.industry!.entries.length).toBeGreaterThan(1);
    e.setRankingKind('healthy');
    s = e.snapshot();
    expect(s.industry!.kind).toBe('healthy');
  });
});

describe('RunEngine: 独立チーム状態（RI-64）', () => {
  it('チーム状態はセーブ往復で維持される', () => {
    const e = started();
    e.zoomTo('company');
    e.applyOrgLever('teamAiThrottle', undefined, 'platform-t1');
    const before = e.snapshot().teams.find((t) => t.id === 'platform-t1')!;
    const persist = e.exportPersistState();
    expect(persist).not.toBeNull();
    const e2 = started('other-seed');
    e2.hydratePersistState(persist!);
    const after = e2.snapshot().teams.find((t) => t.id === 'platform-t1')!;
    expect(after.aiDependency).toBe(before.aiDependency);
    expect(e2.snapshot().activeTeamId).toBe('product-t0');
  });

  it('採用ドラフトは永続チーム配列へ append する', () => {
    const e = started();
    e.zoomTo('company');
    const before = e.snapshot().teams.length;
    expect(e.applyOrgLever('recruitDraft')).toBe(true);
    expect(e.snapshot().teams.length).toBe(before + 1);
    expect(e.snapshot().orgScale!.teamCount).toBe(before + 1);
  });

  it('粗粒度進行は選択チームを変えず他チームを更新する', () => {
    const e = started('coarse-seed');
    const before = e.snapshot();
    const active = before.teams.find((t) => t.id === before.activeTeamId)!;
    const otherBefore = before.teams.find((t) => t.id === 'platform-t0')!;
    const advanced = advanceCoarseTeams(before.teams, {
      seed: before.seed,
      stepKey: 'test-step',
      excludeId: before.activeTeamId,
    });
    expect(advanced.find((t) => t.id === active.id)).toEqual(active);
    const otherAfter = advanced.find((t) => t.id === 'platform-t0')!;
    expect(otherAfter.shipping).not.toBe(otherBefore.shipping);
  });

  it('集約の出荷合計はチーム合計と一致する', () => {
    const e = started();
    e.zoomTo('company');
    expect(assertDeptShippingInvariant(e.snapshot().orgScale!)).toBe(true);
  });

  it('同じ seed なら初期チーム状態が一致する', () => {
    const a = initTeamRunStates({
      seed: 'team-init',
      org: started('team-init').snapshot().org,
      homeEngineers: 3,
    });
    const b = initTeamRunStates({
      seed: 'team-init',
      org: started('team-init').snapshot().org,
      homeEngineers: 3,
    });
    expect(a).toEqual(b);
  });
});

describe('RunEngine: レバー', () => {
  it('全社レバーは予算を消費して全社へ波及する', () => {
    const e = started();
    e.zoomTo('company');
    const before = e.snapshot();
    const budget0 = before.budget;
    const aiDep0 = before.orgScale!.aiDependency;
    const ok = e.applyOrgLever('aiGuideline');
    expect(ok).toBe(true);
    const after = e.snapshot();
    expect(after.budget).toBe(budget0 - 25);
    expect(after.orgScale!.aiDependency).toBeLessThan(aiDep0);
  });

  it('予算不足のレバーは適用されない', () => {
    const e = started();
    e.zoomTo('company');
    // 予算を使い切るまで採用ドラフト(40)を撃つ。
    let guard = 0;
    while (e.snapshot().budget >= 40 && guard < 50) {
      e.applyOrgLever('recruitDraft');
      guard += 1;
    }
    const budget = e.snapshot().budget;
    expect(e.applyOrgLever('recruitDraft')).toBe(false);
    expect(e.snapshot().budget).toBe(budget);
  });

  it('部門レバーは deptId が必要', () => {
    const e = started();
    e.focusDepartment('product');
    expect(e.applyOrgLever('reviewReinforce')).toBe(false);
    expect(e.applyOrgLever('reviewReinforce', 'product')).toBe(true);
  });

  it('チームレバーは対象チームのみへ効く', () => {
    const e = started();
    e.zoomTo('company');
    const before = e.snapshot();
    const target0 = before.teams.find((t) => t.id === 'platform-t1')!.aiDependency;
    const other0 = before.teams.find((t) => t.id === 'newbiz-t0')!.aiDependency;
    expect(e.applyOrgLever('teamAiThrottle', undefined, 'platform-t1')).toBe(true);
    const after = e.snapshot();
    expect(after.teams.find((t) => t.id === 'platform-t1')!.aiDependency).toBeLessThan(target0);
    expect(after.teams.find((t) => t.id === 'newbiz-t0')!.aiDependency).toBe(other0);
  });

  it('全社レバーは正本へ焼き込まれ、入り込み先の詳細状態にも反映される', () => {
    const e = started();
    e.zoomTo('company');
    const before = e.snapshot().teams.find((t) => t.id === 'platform-t1')!.aiDependency;
    expect(e.applyOrgLever('aiGuideline')).toBe(true);
    const baked = e.snapshot().teams.find((t) => t.id === 'platform-t1')!.aiDependency;
    expect(baked).toBe(before - 10);
    expect(e.exportPersistState()!.extras.orgAdjust.company.aiDependencyDelta).toBe(0);
    expect(e.enterTeam('platform-t1')).toBe(true);
    expect(e.snapshot().org.aiDependency).toBe(baked);
  });

  it('粗粒度進行はレバー差分を永続値へ再加算しない', () => {
    const e = started('no-double-adjust');
    e.applyOrgLever('aiGuideline');
    const afterLever = e.snapshot().teams.find((t) => t.id === 'platform-t0')!.aiDependency;
    const stepped = advanceCoarseTeams(e.snapshot().teams, {
      seed: 'no-double-adjust',
      stepKey: 's1',
      excludeId: 'product-t0',
      adjust: e.exportPersistState()!.extras.orgAdjust,
    });
    const afterStep = stepped.find((t) => t.id === 'platform-t0')!.aiDependency;
    // 自然ドリフト（0 or +1）のみ。レバー -10 の再適用は起きない。
    expect(afterStep - afterLever).toBeGreaterThanOrEqual(0);
    expect(afterStep - afterLever).toBeLessThanOrEqual(1);
  });

  it('7人以上のチームへ入り込んでも総人数を失わない', () => {
    const e = started('big-team');
    const big = e.snapshot().teams.find((t) => t.engineers >= 7);
    expect(big).toBeTruthy();
    const headcount = big!.engineers;
    expect(e.enterTeam(big!.id)).toBe(true);
    // ロスターは最大6でも、正本の engineers は維持。
    expect(e.snapshot().roster.members.length).toBeLessThanOrEqual(6);
    expect(e.snapshot().teams.find((t) => t.id === big!.id)!.engineers).toBe(headcount);
    // スプリント無し sync（ロスター人数 < 総人数）でも縮めない。
    const synced = syncTeamFromOrg(big!, e.snapshot().org, {
      engineers: e.snapshot().roster.members.length,
    });
    expect(synced.engineers).toBe(headcount);
  });

  it('チーム同期は全ラン累計の行列・炎上で他チームを上書きしない', () => {
    const e = started('no-totals-bleed');
    expect(e.enterTeam('platform-t1')).toBe(true);
    const before = e.snapshot().teams.find((t) => t.id === 'platform-t1')!;
    // スプリント無しの flush 相当（切替時）でも既存の行列・炎上を保つ。
    const synced = syncTeamFromOrg(before, e.snapshot().org, {
      engineers: activeEngineers(e),
    });
    expect(synced.reviewQueue).toBe(before.reviewQueue);
    expect(synced.incidents).toBe(before.incidents);
  });

  it('俯瞰投影はラン累計で選択チームの行列を汚染しない', () => {
    const e = started('projection-no-totals');
    expect(e.enterTeam('platform-t1')).toBe(true);
    const teamQueue = e.snapshot().teams.find((t) => t.id === 'platform-t1')!.reviewQueue;
    e.zoomTo('company');
    const projected = e
      .snapshot()
      .orgScale!.departments.flatMap((d) => d.teams)
      .find((t) => t.id === 'platform-t1')!;
    expect(projected.reviewQueue).toBe(teamQueue);
  });

  it('チーム施策後に派生能力を再計算する', () => {
    const e = started();
    const before = e.snapshot().teams.find((t) => t.id === 'platform-t1')!;
    // 障害を増やしてから火消し
    e.applyOrgLever('teamFirefight', undefined, 'platform-t1');
    const after = e.snapshot().teams.find((t) => t.id === 'platform-t1')!;
    expect(after.incidents).toBeLessThanOrEqual(before.incidents);
    expect(after.incidentBias).toBeLessThanOrEqual(
      0.08 + after.incidents * 0.05 + (100 - after.quality) * 0.002 + 1e-9,
    );
    expect(after.reviewCapacity).toBe(
      Math.min(100, Math.max(10, 55 + after.engineers * 4 - after.reviewQueue * 2)),
    );
  });

  it('四半期レビュー中は他チームへ切り替えられない', () => {
    const e = started();
    // quarterReview を強制するため phase を直接は触れないので、enter 拒否だけを確認できるよう
    // 通常フェーズでの切替は成功し、won/lost/sprint/quarterReview は拒否、という契約のうち
    // quarterReview 相当は export 後に hydrate で再現する。
    e.zoomTo('company');
    const persist = e.exportPersistState()!;
    (persist as { phase: string }).phase = 'quarterReview';
    e.hydratePersistState(persist);
    expect(e.snapshot().phase).toBe('quarterReview');
    expect(e.enterTeam('platform-t1')).toBe(false);
    expect(e.enterTeam('product-t0')).toBe(true); // 同一アクティブへの復帰は可
  });

  it('投影の isActive は選択チームを指す', () => {
    const e = started();
    expect(e.enterTeam('platform-t1')).toBe(true);
    e.zoomTo('company');
    const teams = e.snapshot().orgScale!.departments.flatMap((d) => d.teams);
    expect(teams.find((t) => t.id === 'platform-t1')!.isActive).toBe(true);
    expect(teams.find((t) => t.id === 'product-t0')!.isActive).toBe(false);
    expect(teams.find((t) => t.id === 'product-t0')!.isPlayer).toBe(true);
  });

  it('result フェーズの施策は残存盤面同期で巻き戻らない', () => {
    const e = started('lever-after-sprint');
    e.beginSetupSprint();
    const internals = e as unknown as {
      phase: string;
      sprint: { tasks: Array<{ lane: string; incident?: boolean }> };
      syncActiveTeamFromOrg: () => void;
    };
    for (const task of internals.sprint.tasks.slice(0, 6)) {
      task.lane = 'review';
      task.incident = false;
    }
    internals.syncActiveTeamFromOrg();
    // result でも sprint オブジェクトが残る状況を再現する。
    internals.phase = 'result';
    const activeId = e.snapshot().activeTeamId;
    const before = e.snapshot().teams.find((t) => t.id === activeId)!.reviewQueue;
    expect(before).toBeGreaterThan(0);
    expect(e.applyOrgLever('teamReviewHelp', undefined, activeId)).toBe(true);
    const after = e.snapshot().teams.find((t) => t.id === activeId)!.reviewQueue;
    expect(after).toBe(Math.max(0, before - 5));
  });

  it('スプリント中のアクティブ施策は盤面件数も下げ、同期で消えない', () => {
    const e = started('lever-during-sprint');
    e.beginSetupSprint();
    const internals = e as unknown as {
      sprint: { tasks: Array<{ lane: string }> };
      syncActiveTeamFromOrg: () => void;
    };
    for (const task of internals.sprint.tasks.slice(0, 5)) {
      task.lane = 'review';
    }
    internals.syncActiveTeamFromOrg();
    const activeId = e.snapshot().activeTeamId;
    const deliveredBefore = e.snapshot().sprint!.metrics.delivered;
    expect(e.applyOrgLever('teamReviewHelp', undefined, activeId)).toBe(true);
    const boardReviews = e.snapshot().sprint!.tasks.filter((t) => t.lane === 'review').length;
    const teamQueue = e.snapshot().teams.find((t) => t.id === activeId)!.reviewQueue;
    expect(boardReviews).toBe(teamQueue);
    expect(teamQueue).toBe(0);
    // 施策で Done にした分は出荷集計へ載せる。
    expect(e.snapshot().sprint!.metrics.delivered).toBeGreaterThan(deliveredBefore);
  });

  it('v1 セーブの extraTeams を移行時に復元する', () => {
    const e = started('v1-extra-teams');
    const persist = e.exportPersistState()!;
    const baseCount = persist.extras.teams!.length;
    // v1 相当: teams 配列を落とし、購入済み extraTeams だけ残す。
    delete (persist.extras as { teams?: unknown }).teams;
    delete (persist.extras as { activeTeamId?: unknown }).activeTeamId;
    persist.extras.orgAdjust.company.extraTeams = 2;
    e.hydratePersistState(persist);
    expect(e.snapshot().teams.length).toBe(baseCount + 2);
    expect(e.snapshot().teams.filter((t) => t.deptId === 'product').length).toBeGreaterThan(
      persist.extras.orgAdjust.company.extraTeams,
    );
  });

  it('チーム切替で診断を現在指標から再計算する', () => {
    const e = started('diagnosis-switch');
    expect(e.enterTeam('platform-t1')).toBe(true);
    const s = e.snapshot();
    const team = s.teams.find((t) => t.id === 'platform-t1')!;
    expect(s.diagnosis).toBe(diagnose(orgFromTeam(team), s.totals));
  });

  it('粗粒度進行の incidentBias は更新後 quality と整合する', () => {
    const e = started('coarse-bias');
    const stepped = advanceCoarseTeams(e.snapshot().teams, {
      seed: 'coarse-bias',
      stepKey: 's1',
      excludeId: 'product-t0',
    });
    for (const team of stepped) {
      if (team.id === 'product-t0') continue;
      const expected = Math.min(
        0.45,
        Math.max(0.02, 0.08 + team.incidents * 0.05 + (100 - team.quality) * 0.002),
      );
      expect(team.incidentBias).toBeCloseTo(expected, 8);
    }
  });

  it('カードの恒久加算はチーム別に適用される', () => {
    const e = started('card-baseline-per-team');
    const persist = e.exportPersistState()!;
    persist.deck = [{ defId: 'auto-test', level: 1 }, ...persist.deck];
    e.hydratePersistState(persist);
    e.beginSetupSprint();
    const hand = e.snapshot().sprint!.cardPiles.hand;
    const deckIndex = hand.find((i) => e.snapshot().deck[i]?.defId === 'auto-test');
    expect(deckIndex).toBeDefined();
    const homeQuality = e.snapshot().org.quality;
    expect(e.playCard(deckIndex!).ok).toBe(true);
    expect(e.snapshot().org.quality).toBeGreaterThan(homeQuality);
    expect(e.snapshot().deck[deckIndex!]!.baselineAppliedByTeam?.['product-t0']).toBe(1);

    // スプリントを抜けて他チームへ入り、同じカードを再度発動できる（別チーム分）。
    const internals = e as unknown as { phase: string; sprint: unknown };
    internals.phase = 'setup';
    internals.sprint = null;
    expect(e.enterTeam('platform-t1')).toBe(true);
    const otherQuality = e.snapshot().org.quality;
    e.beginSetupSprint();
    const hand2 = e.snapshot().sprint!.cardPiles.hand;
    const idx2 = hand2.find((i) => e.snapshot().deck[i]?.defId === 'auto-test');
    expect(idx2).toBeDefined();
    expect(e.playCard(idx2!).ok).toBe(true);
    expect(e.snapshot().org.quality).toBeGreaterThan(otherQuality);
    expect(e.snapshot().deck[idx2!]!.baselineAppliedByTeam?.['platform-t1']).toBe(1);
  });

  it('粗粒度チームの出荷増分を四半期集計へ反映する', () => {
    const e = started('coarse-totals');
    const beforeDelivered = e.snapshot().quarterTotals.delivered;
    const others = e.snapshot().teams.filter((t) => t.id !== e.snapshot().activeTeamId);
    const beforeShipping = others.reduce((a, t) => a + t.shipping, 0);
    const internals = e as unknown as { advanceOtherTeams: (k: string) => void };
    internals.advanceOtherTeams('totals-step');
    const afterShipping = e
      .snapshot()
      .teams.filter((t) => t.id !== e.snapshot().activeTeamId)
      .reduce((a, t) => a + t.shipping, 0);
    const shippingGain = afterShipping - beforeShipping;
    expect(shippingGain).toBeGreaterThan(0);
    const normalized = Math.max(1, Math.round(shippingGain / others.length));
    expect(e.snapshot().quarterTotals.delivered).toBe(beforeDelivered + normalized);
    expect(e.snapshot().totals.delivered).toBe(beforeDelivered + normalized);
  });

  it('ビート提示中は他チームへ切り替えられない', () => {
    const e = started('beat-lock');
    const persist = e.exportPersistState()!;
    (persist as { phase: string }).phase = 'beat';
    e.hydratePersistState(persist);
    expect(e.snapshot().phase).toBe('beat');
    expect(e.enterTeam('platform-t1')).toBe(false);
    expect(e.enterTeam('product-t0')).toBe(true);
  });

  it('全社品質ボーナス後に incidentBias を再計算する', () => {
    const e = started('company-quality-bias');
    const before = e.snapshot().teams.find((t) => t.id === 'platform-t0')!;
    // qualityAdd を持つ進化ノード相当を applyCompanyBaseline 経由で焼く。
    const internals = e as unknown as {
      applyCompanyBaseline: (fx: {
        aiLiteracyAdd: number;
        aiDependencyAdd: number;
        qualityAdd: number;
        testCoverageAdd: number;
      }) => void;
    };
    internals.applyCompanyBaseline({
      aiLiteracyAdd: 0,
      aiDependencyAdd: 0,
      qualityAdd: 20,
      testCoverageAdd: 0,
    });
    const after = e.snapshot().teams.find((t) => t.id === 'platform-t0')!;
    expect(after.quality).toBe(Math.min(100, before.quality + 20));
    const expected = Math.min(
      0.45,
      Math.max(0.02, 0.08 + after.incidents * 0.05 + (100 - after.quality) * 0.002),
    );
    expect(after.incidentBias).toBeCloseTo(expected, 8);
  });

  it('行列削減は炎上中 Review を無料鎮火しない', () => {
    const e = started('no-free-contain');
    e.beginSetupSprint();
    const internals = e as unknown as {
      sprint: {
        tasks: Array<{ lane: string; incident: boolean; burnTicksLeft?: number }>;
        metrics: { contained: number };
      };
      syncActiveTeamFromOrg: () => void;
    };
    // Review を炎上付きで埋め、非炎上は少数だけにする。
    const tasks = internals.sprint.tasks;
    for (let i = 0; i < Math.min(5, tasks.length); i += 1) {
      tasks[i]!.lane = 'review';
      tasks[i]!.incident = i < 4;
      if (tasks[i]!.incident) tasks[i]!.burnTicksLeft = 3;
    }
    internals.syncActiveTeamFromOrg();
    const containedBefore = internals.sprint.metrics.contained;
    const burningBefore = internals.sprint.tasks.filter((t) => t.incident).length;
    expect(e.applyOrgLever('teamReviewHelp', undefined, e.snapshot().activeTeamId)).toBe(true);
    const burningAfter = e.snapshot().sprint!.tasks.filter((t) => t.incident).length;
    expect(burningAfter).toBe(burningBefore);
    expect(e.snapshot().sprint!.metrics.contained).toBe(containedBefore);
  });

  it('companyOrgFromTeams は品質等を平均し士気/HPは選択中を使う', () => {
    const e = started('company-org');
    const s = e.snapshot();
    const company = companyOrgFromTeams(s.teams, s.org);
    const avgQuality = Math.round(s.teams.reduce((a, t) => a + t.quality, 0) / s.teams.length);
    expect(company.quality).toBe(avgQuality);
    expect(company.morale).toBe(s.org.morale);
    expect(company.seniorHp).toBe(s.org.seniorHp);
    expect(company.deliveryScore).toBe(s.teams.reduce((a, t) => a + t.shipping, 0));
  });

  it('チーム切替後もラン累計出荷（totals.delivered）は維持される', () => {
    const e = started('run-delivery-persist');
    const internals = e as unknown as {
      totals: { delivered: number };
      advanceOtherTeams: (k: string) => void;
    };
    internals.totals.delivered = 420;
    internals.advanceOtherTeams('delivery-step');
    const afterAdvance = e.snapshot().totals.delivered;
    expect(afterAdvance).toBeGreaterThan(420);
    expect(e.enterTeam('platform-t1')).toBe(true);
    // 入り込みで org.deliveryScore はチーム出荷に置き換わっても、ラン累計は残る。
    expect(e.snapshot().totals.delivered).toBe(afterAdvance);
    expect(e.snapshot().org.deliveryScore).toBe(
      e.snapshot().teams.find((t) => t.id === 'platform-t1')!.shipping,
    );
  });

  it('粗粒度の新規炎上を他チーム平均相当で正規化する', () => {
    const before = [
      { id: 'product-t0', shipping: 10, incidents: 0 },
      { id: 'a', shipping: 10, incidents: 0 },
      { id: 'b', shipping: 10, incidents: 0 },
      { id: 'c', shipping: 10, incidents: 1 },
    ];
    const after = [
      { id: 'product-t0', shipping: 10, incidents: 0 },
      { id: 'a', shipping: 20, incidents: 3 },
      { id: 'b', shipping: 16, incidents: 3 },
      { id: 'c', shipping: 13, incidents: 1 },
    ];
    const delta = normalizeCoarseTotalsDelta(before, after, 'product-t0');
    // 出荷増分 10+6+3=19 → round(19/3)=6（最低 1 保証）
    expect(delta.delivered).toBe(6);
    // 炎上増分 3+3+0=6 → round(6/3)=2（0 切り捨て可）
    expect(delta.incidents).toBe(2);
    expect(normalizeCoarseTotalsDelta(before, before, 'product-t0').incidents).toBe(0);
  });

  it('四半期目標修正の org 効果は全チームへ焼き込まれる', () => {
    const e = started('goal-adj-all-teams');
    const persist = e.exportPersistState()!;
    persist.extras.teams = persist.extras.teams!.map((t) =>
      t.id === 'platform-t0' ? { ...t, techDebt: 40, morale: 70, seniorHp: 50 } : t,
    );
    e.hydratePersistState(persist);
    const reviewInternals = e as unknown as {
      quarterReview: { outcome: string; availableAdjustments: string[] } | null;
      phase: string;
      startNextQuarter: () => void;
    };
    reviewInternals.phase = 'quarterReview';
    reviewInternals.quarterReview = {
      outcome: 'missed_adjustable',
      availableAdjustments: ['quality_pivot'],
    };
    // startNextQuarter を潰して焼き込み結果だけ検証する。
    reviewInternals.startNextQuarter = () => undefined;
    const before = e.snapshot().teams.find((t) => t.id === 'platform-t0')!;
    e.chooseGoalAdjustment('quality_pivot');
    const after = e.snapshot().teams.find((t) => t.id === 'platform-t0')!;
    expect(after.techDebt).toBe(Math.max(0, before.techDebt - 8));
  });

  it('snapshot の baselineAppliedByTeam は独立コピー', () => {
    const e = started('clone-baseline-map');
    const persist = e.exportPersistState()!;
    persist.deck = [{ defId: 'auto-test', level: 1, baselineAppliedByTeam: { 'product-t0': 1 } }];
    e.hydratePersistState(persist);
    const snap = e.snapshot();
    const map = snap.deck[0]!.baselineAppliedByTeam!;
    map['hacked'] = 9;
    expect(e.snapshot().deck[0]!.baselineAppliedByTeam).toEqual({ 'product-t0': 1 });
  });

  it('hydrate 時にレガシー baselineAppliedLevel を全チームへ移行する', () => {
    const e = started('migrate-baseline');
    const persist = e.exportPersistState()!;
    persist.deck = [{ defId: 'auto-test', level: 2, baselineAppliedLevel: 1 }];
    // v1 相当: teams を落として復元経路を踏む。
    delete (persist.extras as { teams?: unknown }).teams;
    e.hydratePersistState(persist);
    const card = e.snapshot().deck[0]!;
    expect(card.baselineAppliedByTeam).toBeTruthy();
    for (const team of e.snapshot().teams) {
      expect(card.baselineAppliedByTeam?.[team.id]).toBe(1);
    }
  });

  it('入り込み先の行列・炎上を次スプリント盤面へ引き継ぐ', () => {
    const e = started('enter-board-carry');
    const persist = e.exportPersistState()!;
    const teams = persist.extras.teams!.map((t) => {
      if (t.id !== 'platform-t1') return t;
      const next = { ...t, reviewQueue: 5, incidents: 2 };
      return { ...next, ...deriveTeamCapacities(next) };
    });
    persist.extras.teams = teams;
    e.hydratePersistState(persist);
    expect(e.enterTeam('platform-t1')).toBe(true);
    e.beginSetupSprint();
    const sprint = e.snapshot().sprint!;
    expect(sprint.tasks.filter((t) => t.lane === 'review').length).toBe(5);
    expect(sprint.tasks.filter((t) => t.incident).length).toBe(2);
    // 鎮火集計と整合するよう、引き継ぎ炎上も発生母数へ含める。
    expect(sprint.metrics.incidentCount).toBe(2);
  });

  it('採用ドラフトの新チームはホームのカード基準を継承し二重適用しない', () => {
    const e = started('recruit-inherit-baseline');
    const persist = e.exportPersistState()!;
    persist.deck = [{ defId: 'auto-test', level: 1, baselineAppliedByTeam: { 'product-t0': 1 } }];
    // ホーム品質をカード加算済み相当にしておく。
    persist.extras.teams = persist.extras.teams!.map((t) =>
      t.id === 'product-t0' ? { ...t, quality: Math.min(100, t.quality + 10) } : t,
    );
    persist.org.quality = persist.extras.teams.find((t) => t.id === 'product-t0')!.quality;
    e.hydratePersistState(persist);
    const beforeIds = new Set(e.snapshot().teams.map((t) => t.id));
    expect(e.applyOrgLever('recruitDraft')).toBe(true);
    const added = e.snapshot().teams.find((t) => !beforeIds.has(t.id));
    expect(added).toBeTruthy();
    const card = e.snapshot().deck[0]!;
    expect(card.baselineAppliedByTeam?.[added!.id]).toBe(1);

    // 新チームへ入り同じカードを発動しても quality は増えない。
    const internals = e as unknown as {
      phase: string;
      sprint: unknown;
      teamLockUntilSprint: number;
    };
    internals.phase = 'setup';
    internals.sprint = null;
    internals.teamLockUntilSprint = 0;
    expect(e.enterTeam(added!.id)).toBe(true);
    const qualityBefore = e.snapshot().org.quality;
    e.beginSetupSprint();
    const hand = e.snapshot().sprint!.cardPiles.hand;
    const idx = hand.find((i) => e.snapshot().deck[i]?.defId === 'auto-test');
    expect(idx).toBeDefined();
    expect(e.playCard(idx!).ok).toBe(true);
    expect(e.snapshot().org.quality).toBe(qualityBefore);
  });

  it('行列＋炎上が taskCount を超えても炎上枠を先に確保する', () => {
    const e = started('enter-board-overflow');
    const persist = e.exportPersistState()!;
    // 通常スプリントの taskCount より大きい滞留を載せる。
    const teams = persist.extras.teams!.map((t) => {
      if (t.id !== 'platform-t1') return t;
      const next = { ...t, reviewQueue: 20, incidents: 8 };
      return { ...next, ...deriveTeamCapacities(next) };
    });
    persist.extras.teams = teams;
    e.hydratePersistState(persist);
    expect(e.enterTeam('platform-t1')).toBe(true);
    e.beginSetupSprint();
    const sprint = e.snapshot().sprint!;
    expect(sprint.tasks.length).toBeGreaterThanOrEqual(28);
    expect(sprint.tasks.filter((t) => t.incident).length).toBe(8);
    expect(sprint.tasks.filter((t) => t.lane === 'review').length).toBe(20);
  });

  it('未知の teamId ではチームレバーが予算を消費しない', () => {
    const e = started('unknown-team-lever');
    e.zoomTo('company');
    const before = e.snapshot().budget;
    expect(e.applyOrgLever('teamAiThrottle', undefined, 'no-such-team')).toBe(false);
    expect(e.snapshot().budget).toBe(before);
  });

  it('全社基盤集約はアクティブチームの最新 org を反映する', () => {
    const e = started('infra-live-org');
    e.zoomTo('company');
    const before = e.snapshot().orgScale!.infra.aiGuideline;
    const internals = e as unknown as { org: { aiLiteracy: number } };
    internals.org.aiLiteracy = Math.min(100, internals.org.aiLiteracy + 40);
    e.zoomTo('company');
    const after = e.snapshot().orgScale!.infra.aiGuideline;
    expect(after).toBeGreaterThan(before);
  });
});

function activeEngineers(e: RunEngine): number {
  return e.snapshot().roster.members.filter((m) => !m.onLeave).length;
}

describe('RunEngine: 決定論', () => {
  it('同じ seed・同じ操作なら同じ全社マップになる', () => {
    const a = started('det-seed');
    a.zoomTo('company');
    const b = started('det-seed');
    b.zoomTo('company');
    expect(a.snapshot().orgScale).toEqual(b.snapshot().orgScale);
  });
});

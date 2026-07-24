/**
 * 組織スケールの RunEngine 連携検証（SPEC 第4.7〜4.11 / RI-64）。
 * ズーム階層の切り替え・部門フォーカス・レバー発動・業界ランキング生成を、
 * snapshot を通じて決定論で確認する。
 */
import { describe, expect, it } from 'vitest';
import { RunEngine } from '../../src/sim/run/engine';
import { DEPARTMENT_DEFS } from '../../src/data/departments';
import {
  advanceCoarseTeams,
  assertDeptShippingInvariant,
  ENTER_TEAM_FOCUS_PENALTY,
  initTeamRunStates,
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
});

describe('RunEngine: 決定論', () => {
  it('同じ seed・同じ操作なら同じ全社マップになる', () => {
    const a = started('det-seed');
    a.zoomTo('company');
    const b = started('det-seed');
    b.zoomTo('company');
    expect(a.snapshot().orgScale).toEqual(b.snapshot().orgScale);
  });
});

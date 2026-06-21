/**
 * 組織スケールの RunEngine 連携検証（SPEC 第4.7〜4.11 / MVP5）。
 * ズーム階層の切り替え・部門フォーカス・レバー発動・業界ランキング生成を、
 * snapshot を通じて決定論で確認する。
 */
import { describe, expect, it } from 'vitest';
import { RunEngine } from '../../src/sim/run/engine';
import { DEPARTMENT_DEFS } from '../../src/data/departments';

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

  it('チームへドリルダウンすると現場へ着地する', () => {
    const e = started();
    e.zoomTo('company');
    e.focusTeam('product-t0');
    const s = e.snapshot();
    expect(s.zoom.level).toBe('team');
    expect(s.zoom.teamId).toBe('product-t0');
    expect(s.orgScale).toBeNull();
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

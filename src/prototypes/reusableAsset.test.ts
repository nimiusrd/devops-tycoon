import { describe, expect, it } from 'vitest';
import {
  applyReusableInput as apply,
  compareReusableStrategies,
  createReusablePrototype as create,
  summarizeReusable,
  viewReusable,
} from './reusableAsset';
import comparison from '../../docs/prototypes/reusable-asset-comparison.json';

describe('RI-180 再利用資産', () => {
  it('同じseedの初期状態は一致し、閲覧は資産の古さだけを足して状態を変えない', () => {
    const state = create(1, 'repeat');
    expect(create(1, 'repeat')).toEqual(state);
    expect(create(2, 'repeat').seed).toBe(2);
    const before = structuredClone(state);
    expect(viewReusable(state).stale).toBe(false);
    expect(state).toEqual(before);
  });
  it('新鮮な資産は同種だけを速くし、無関係な仕事は速度1のまま', () => {
    const base = create(1, 'single');
    const matching = apply(
      {
        ...base,
        asset: 'fresh',
        jobs: [{ id: 'm', kind: 'matching', effort: 4, progress: 0, value: 6 }],
      },
      { type: 'tick' },
    );
    const other = apply(
      {
        ...base,
        asset: 'fresh',
        jobs: [{ id: 'o', kind: 'other', effort: 4, progress: 0, value: 6 }],
      },
      { type: 'tick' },
    );
    expect(matching.jobs[0].progress).toBe(2);
    expect(other.jobs[0].progress).toBe(1);
    expect(viewReusable(matching).jobs[0].speed).toBe(2);
    expect(viewReusable(other).jobs[0].speed).toBe(1);
  });
  it('前提変更で古さが表示され、更新・見送り・継続利用が一度だけ定義どおり進む', () => {
    let state = apply(create(1, 'stale-few'), { type: 'build' });
    while (viewReusable(state).asset !== 'stale-held') state = apply(state, { type: 'tick' });
    const seen = viewReusable(state);
    expect(seen.stale).toBe(true);
    expect(seen.premiseVersion).toBe(1);
    expect(seen.assetPremise).toBe(0);
    expect(apply(state, { type: 'build' })).toBe(state);
    const retired = apply(state, { type: 'retire' });
    expect(retired.asset).toBe('retired');
    expect(viewReusable(retired).stale).toBe(false);
    expect(apply(retired, { type: 'update' })).toBe(retired);
    expect(apply(retired, { type: 'continue-stale' })).toBe(retired);
    const continued = apply(state, { type: 'continue-stale' });
    expect(continued.asset).toBe('stale-used');
    expect(apply(continued, { type: 'continue-stale' })).toBe(continued);
    const updating = apply(state, { type: 'update' });
    expect(updating.focusSpent).toBe(state.focusSpent + 1);
    expect(updating.busy).toEqual({ kind: 'update', remaining: 4 });
    let done = updating;
    while (done.busy) done = apply(done, { type: 'tick' });
    expect(done.asset).toBe('fresh');
    expect(done.assetPremise).toBe(1);
    expect(done.updateTicksSpent).toBe(4);
    const sped = apply(
      { ...done, jobs: [{ id: 'm', kind: 'matching', effort: 4, progress: 0, value: 6 }] },
      { type: 'tick' },
    );
    expect(sped.jobs[0].progress).toBe(2);
    expect(sped.stalePenalty).toBe(0);
  });
  it('継続利用は同種の完成だけに古さの損失を足し、整備中は出荷しない', () => {
    const stale = {
      ...create(1, 'single'),
      asset: 'stale-used' as const,
      premiseVersion: 1,
      jobs: [
        { id: 'm', kind: 'matching' as const, effort: 2, progress: 0, value: 6 },
        { id: 'o', kind: 'other' as const, effort: 2, progress: 0, value: 6 },
      ],
    };
    let state = apply(apply(stale, { type: 'tick' }), { type: 'tick' });
    expect(state.earnedValue).toBe(6);
    expect(state.stalePenalty).toBe(2);
    state = apply(apply(state, { type: 'tick' }), { type: 'tick' });
    expect(state.earnedValue).toBe(12);
    expect(state.stalePenalty).toBe(2);
    const building = apply(create(1, 'repeat'), { type: 'build' });
    const during = apply(building, { type: 'tick' });
    expect(during.jobs.every((item) => item.progress === 0)).toBe(true);
    expect(during.buildTicksSpent).toBe(1);
  });
  it('整備の二重開始・資源不足・期末の操作は無消費で拒否する', () => {
    const built = apply(create(1, 'repeat'), { type: 'build' });
    expect(apply(built, { type: 'build' })).toBe(built);
    const poor = { ...create(1, 'repeat'), focus: 0 };
    expect(apply(poor, { type: 'build' })).toBe(poor);
    const fresh = { ...create(1, 'repeat'), asset: 'fresh' as const };
    expect(apply(fresh, { type: 'update' })).toBe(fresh);
    expect(apply(fresh, { type: 'retire' })).toBe(fresh);
    const ended = { ...create(1, 'repeat'), tick: 20 };
    for (const type of ['build', 'update', 'retire', 'continue-stale', 'tick'] as const)
      expect(apply(ended, { type })).toBe(ended);
  });
  it('単発は直接納品、反復は整備、残件の多少で更新と見送りが入れ替わる', () => {
    const rows = compareReusableStrategies();
    expect(rows).toEqual(comparison.results);
    const net = (scenario: string, strategy: string) =>
      rows.find((row) => row.scenario === scenario && row.strategy === strategy)!.result.netValue;
    expect(net('single', 'direct')).toBe(12);
    expect(net('single', 'build')).toBe(11);
    expect(net('repeat', 'direct')).toBe(30);
    expect(net('repeat', 'build')).toBe(47);
    expect(net('stale-many', 'update')).toBe(40);
    expect(net('stale-many', 'continue')).toBe(33);
    expect(net('stale-many', 'retire')).toBe(29);
    expect(net('stale-few', 'retire')).toBe(17);
    expect(net('stale-few', 'continue')).toBe(13);
    expect(net('stale-few', 'update')).toBe(10);
    const built = rows.find((row) => row.scenario === 'repeat' && row.strategy === 'build')!;
    expect(built.result.buildTicksSpent).toBe(4);
    expect(built.result.focusSpent).toBe(1);
  });
  it('全入力の再生と毎入力JSON保存再開が一致し、元状態を変えない', () => {
    for (const row of compareReusableStrategies()) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeReusable(live)).toEqual(row.result);
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  createBundlePrototype,
  applyBundleInput,
  compareBundleStrategies,
  summarizeBundle,
} from './prBundle';
import comparison from '../../docs/prototypes/pr-bundle-comparison.json';
describe('RI-167 関連PRの束ね', () => {
  it('同領域の未着手2件だけを束ね、価値と元IDを保持する', () => {
    const initial = createBundlePrototype('RI-167');
    const bundled = applyBundleInput(initial, { type: 'bundle', ids: ['b', 'a'] });
    expect(bundled.groups).toEqual([
      { ids: ['a', 'b'], workLeft: 4, started: false, failed: false },
    ]);
    expect(bundled.jobs).toEqual(initial.jobs);
    expect(bundled).toEqual(applyBundleInput(initial, { type: 'bundle', ids: ['a', 'b'] }));
    expect(bundled.inputs).toEqual([{ type: 'bundle', ids: ['a', 'b'] }]);
    expect(applyBundleInput(bundled, { type: 'bundle', ids: ['a', 'b'] })).toBe(bundled);
    expect(initial.groups).toHaveLength(2);
  });
  it('無関係・重複・未知・Done・着手済み・期末を無消費で拒否する', () => {
    const initial = createBundlePrototype('RI-167');
    for (const ids of [['a'], ['a', 'a'], ['a', 'missing'], ['a', 'b', 'c']])
      expect(applyBundleInput(initial, { type: 'bundle', ids })).toBe(initial);
    const other = structuredClone(initial);
    other.jobs[1].domain = 'platform';
    expect(applyBundleInput(other, { type: 'bundle', ids: ['a', 'b'] })).toBe(other);
    const started = applyBundleInput(initial, { type: 'work', id: 'a' });
    expect(applyBundleInput(started, { type: 'bundle', ids: ['a', 'b'] })).toBe(started);
    let done = initial;
    for (let i = 0; i < 3; i++) done = applyBundleInput(done, { type: 'work', id: 'a' });
    expect(applyBundleInput(done, { type: 'bundle', ids: ['a', 'b'] })).toBe(done);
    expect(applyBundleInput(done, { type: 'work', id: 'a' })).toBe(done);
    const ended = { ...initial, tick: initial.horizon };
    expect(applyBundleInput(ended, { type: 'wait' })).toBe(ended);
  });
  it('初回失敗後の再確認待ちを未着手PRとして束ね直さない', () => {
    let state = createBundlePrototype('RI-167', true);
    for (let i = 0; i < 3; i++) state = applyBundleInput(state, { type: 'work', id: 'b' });
    expect(state.groups[1]).toMatchObject({ started: false, failed: true, workLeft: 3 });
    expect(applyBundleInput(state, { type: 'bundle', ids: ['a', 'b'] })).toBe(state);
    expect(summarizeBundle(state).fixedCost).toBe(2);
  });
  it('一部の失敗は束全員の再確認になり、完了は元IDごとに一度記録する', () => {
    let state = applyBundleInput(createBundlePrototype('RI-167', true), {
      type: 'bundle',
      ids: ['a', 'b'],
    });
    state = { ...state, horizon: 9 };
    for (let i = 0; i < 4; i++) state = applyBundleInput(state, { type: 'work', id: 'a' });
    expect(state.jobs.map((j) => j.rechecks)).toEqual([1, 1]);
    expect(summarizeBundle(state).value).toBe(0);
    for (let i = 0; i < 4; i++) state = applyBundleInput(state, { type: 'work', id: 'b' });
    expect(state.jobs.map((j) => j.doneTick)).toEqual([8, 8]);
    expect(summarizeBundle(state).value).toBe(12);
    expect(applyBundleInput(state, { type: 'work', id: 'a' })).toBe(state);
  });
  it('安全なら固定費を節約し、失敗時は個別の先行成果が有利になる', () => {
    const rows = compareBundleStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    expect(rows[1].result.value).toBe(rows[0].result.value);
    expect(rows[1].result.fixedCost).toBeLessThan(rows[0].result.fixedCost);
    expect(rows[2].result.value).toBeGreaterThan(rows[3].result.value);
    expect(rows[2].result.jobs.map((j) => j.rechecks)).toEqual([0, 1]);
  });
  it('毎入力の保存再開と同じ初期状態からの再生が一致する', () => {
    for (const row of compareBundleStrategies(comparison.seed)) {
      let live = row.initial;
      let restored = structuredClone(live);
      for (const input of row.inputs) {
        const before = structuredClone(live);
        const previous = live;
        live = applyBundleInput(live, input);
        expect(previous).toEqual(before);
        restored = applyBundleInput(JSON.parse(JSON.stringify(restored)), input);
        expect(restored).toEqual(live);
      }
      expect(summarizeBundle(live)).toEqual(row.result);
    }
  });
});

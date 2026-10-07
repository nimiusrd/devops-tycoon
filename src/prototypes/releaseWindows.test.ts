import { describe, expect, it } from 'vitest';
import {
  createWindowPrototype,
  tickWindowPrototype,
  summarizeWindows,
  compareWindowStrategies,
} from './releaseWindows';
import comparison from '../../docs/prototypes/release-windows-comparison.json';
describe('RI-160 リリース便', () => {
  it('レビュー完了を出荷へ加算せず、便のtickで一度だけ公開する', () => {
    const initial = createWindowPrototype('RI-160', 'low');
    const snapshot = structuredClone(initial);
    const one = initial;
    expect(summarizeWindows(one)).toMatchObject({ reviewed: 1, published: 0, value: 0 });
    const two = tickWindowPrototype(one, { holdIds: [] });
    expect(two.tasks[0]).toMatchObject({ publishedTick: 2, value: 10, loss: 2 });
    let state = two;
    while (state.tick < state.horizon) state = tickWindowPrototype(state, { holdIds: [] });
    expect(summarizeWindows(state)).toMatchObject({ published: 1, value: 10 });
    expect(initial).toEqual(snapshot);
  });
  it('最終便を逃した仕事は未出荷の繰越となり、期末以降は無操作', () => {
    let state = createWindowPrototype(1, 'high');
    while (state.tick < state.horizon) state = tickWindowPrototype(state, { holdIds: ['change'] });
    expect(summarizeWindows(state)).toMatchObject({
      published: 0,
      carryover: ['change'],
      value: 0,
    });
    expect(tickWindowPrototype(state, { holdIds: [] })).toBe(state);
  });
  it('無効ID・重複搭載保留・公開済みの確認を無消費で拒否する', () => {
    const state = createWindowPrototype(1, 'high');
    expect(tickWindowPrototype(state, { holdIds: ['unknown'] })).toBe(state);
    expect(tickWindowPrototype(state, { holdIds: ['change', 'change'] })).toBe(state);
    expect(tickWindowPrototype(state, { holdIds: [], verifyId: 'unknown' })).toBe(state);
    const published = tickWindowPrototype(tickWindowPrototype(state, { holdIds: [] }), {
      holdIds: [],
    });
    expect(tickWindowPrototype(published, { holdIds: [], verifyId: 'change' })).toBe(published);
  });
  it('低リスクでは早期便、高リスクでは追加確認が有利となる比較を再現する', () => {
    expect(compareWindowStrategies(comparison.seed)).toEqual(comparison.results);
    const [lowEarly, lowVerify, highEarly, highVerify] = comparison.results;
    expect(lowEarly.result.netValue).toBeGreaterThan(lowVerify.result.netValue);
    expect(highVerify.result.netValue).toBeGreaterThan(highEarly.result.netValue);
    expect(highVerify.result.verificationWork).toBe(2);
  });
  it('便の前後の保存再開・入力再生が一致する', () => {
    for (const row of comparison.results) {
      let live = createWindowPrototype(comparison.seed, row.impact as 'low' | 'high');
      let restored = structuredClone(live);
      for (const input of row.inputs) {
        live = tickWindowPrototype(live, input);
        restored = tickWindowPrototype(JSON.parse(JSON.stringify(restored)), input);
      }
      expect(restored).toEqual(live);
      expect(summarizeWindows(live)).toEqual(row.result);
    }
  });
});

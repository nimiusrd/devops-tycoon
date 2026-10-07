import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/parallel-conflicts-comparison.json';
import {
  compareParallelStrategies,
  createParallelPrototype,
  tickParallelPrototype,
} from './parallelConflicts';

describe('RI-157 並列実装の競合', () => {
  it('同領域の同時Codingだけに一度統合工数を追加する', () => {
    const initial = createParallelPrototype('RI-157');
    const first = tickParallelPrototype(initial, ['a', 'b']);
    expect(first.conflicts).toEqual([{ pair: ['a', 'b'], owner: 'b', tick: 1, effort: 2 }]);
    expect(first.tasks[1].integrationLeft).toBe(2);
    expect(tickParallelPrototype(first, ['a', 'b']).conflicts).toHaveLength(1);
    expect(tickParallelPrototype(initial, ['a', 'c']).conflicts).toEqual([]);
    expect(tickParallelPrototype(initial, ['a']).conflicts).toEqual([]);
    expect(tickParallelPrototype(initial, ['b', 'a']).tasks).toEqual(first.tasks);
  });
  it('統合完了まで出荷せず、Codingと統合を同tickに二重進行しない', () => {
    let state = createParallelPrototype(1);
    for (let i = 0; i < 3; i++) state = tickParallelPrototype(state, ['a', 'b']);
    expect(state.tasks[0].completedTick).toBe(3);
    expect(state.tasks[1].codingLeft).toBe(0);
    expect(state.tasks[1].integrationLeft).toBe(2);
    expect(state.tasks[1].completedTick).toBeNull();
    state = tickParallelPrototype(state, ['b', 'c']);
    expect(state.conflicts).toHaveLength(1);
    state = tickParallelPrototype(state, ['b']);
    expect(state.tasks[1].completedTick).toBe(5);
    expect(tickParallelPrototype(state, ['b'])).toBe(state);
  });
  it('不正入力・枠超過・重複入力・終了後を無消費で拒否する', () => {
    const state = createParallelPrototype(1);
    for (const ids of [['unknown'], ['a', 'a'], ['a', 'b', 'c']])
      expect(tickParallelPrototype(state, ids)).toBe(state);
    const ended = { ...state, tick: state.horizon };
    expect(tickParallelPrototype(ended, [])).toBe(ended);
  });
  it('保存再開・入力再生・元状態不変を検証する', () => {
    const initial = createParallelPrototype('RI-157');
    const snapshot = structuredClone(initial);
    const first = tickParallelPrototype(initial, ['a', 'b']);
    let live = first;
    let restored = JSON.parse(JSON.stringify(first));
    let replayed = initial;
    const inputs = [
      ['a', 'b'],
      ['a', 'b'],
      ['a', 'b'],
      ['b', 'c'],
      ['b', 'c'],
    ];
    for (const ids of inputs.slice(1)) {
      live = tickParallelPrototype(live, ids);
      restored = tickParallelPrototype(restored, ids);
    }
    for (const ids of inputs) replayed = tickParallelPrototype(replayed, ids);
    expect(restored).toEqual(live);
    expect(replayed).toEqual(live);
    expect(initial).toEqual(snapshot);
  });
  it('同条件比較と構成によって変わる並列化の価値を再現する', () => {
    expect(createParallelPrototype(comparison.seed)).toEqual(comparison.initial);
    expect(compareParallelStrategies(comparison.seed)).toEqual(comparison.results);
    const [serial, parallel, , mixedSerial, mixedSame, distributed] = comparison.results;
    expect(parallel.tick).toBeLessThan(serial.tick);
    expect(parallel.integrationEffort).toBeGreaterThan(serial.integrationEffort);
    expect(distributed.tick).toBeLessThan(mixedSame.tick);
    expect(distributed.tick).toBeLessThan(mixedSerial.tick);
    expect(distributed.integrationEffort).toBe(0);
  });
});

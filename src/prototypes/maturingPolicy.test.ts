import { describe, expect, it } from 'vitest';
import {
  applyMatureInput as apply,
  compareMatureStrategies,
  createMaturePrototype as create,
  summarizeMature,
  viewMature,
} from './maturingPolicy';
import comparison from '../../docs/prototypes/maturing-policy-comparison.json';

describe('RI-185 使って育つ施策', () => {
  it('成熟前は速度1で、3件の新しい完了の次tickから速度3になる', () => {
    let state = apply(create(1, 10), { type: 'adopt', card: 'growing' });
    expect(viewMature(state)).toMatchObject({
      card: 'growing',
      cardLevel: 0,
      stage: 0,
      progress: 0,
      nextAt: 3,
      throughput: 1,
    });
    for (let i = 0; i < 3; i++) state = apply(state, { type: 'tick' });
    expect(viewMature(state)).toMatchObject({
      stage: 1,
      progress: 3,
      cardLevel: 0,
      nextAt: null,
      throughput: 3,
      completed: 3,
    });
    state = apply(state, { type: 'tick' });
    expect(state.earnedValue).toBe(6);
    expect(state.progress).toBe(3);
    expect(state.cardLevel).toBe(0);
  });
  it('手戻りは同じ完了を進捗にも価値にも数えない', () => {
    let state = apply(apply(create(1, 6), { type: 'adopt', card: 'growing' }), { type: 'tick' });
    const before = structuredClone(state);
    state = apply(state, { type: 'rework' });
    expect(state.progress).toBe(before.progress);
    expect(state.earnedValue).toBe(before.earnedValue);
    expect(state.completedIds).toEqual(before.completedIds);
    expect(state.reworks).toBe(1);
    expect(state.stage).toBe(0);
    const fresh = create(1, 6);
    expect(apply(fresh, { type: 'rework' })).toBe(fresh);
  });
  it('即効カードは成熟せず、二重の採用と期末の操作は無消費で拒否する', () => {
    const steady = apply(create(1, 4), { type: 'adopt', card: 'steady' });
    expect(viewMature(steady)).toMatchObject({
      stage: 0,
      progress: 0,
      nextAt: null,
      throughput: 2,
    });
    expect(apply(steady, { type: 'adopt', card: 'growing' })).toBe(steady);
    const ended = { ...create(1, 4), tick: 4 };
    expect(apply(ended, { type: 'adopt', card: 'steady' })).toBe(ended);
    expect(apply(ended, { type: 'tick' })).toBe(ended);
    expect(apply(ended, { type: 'rework' })).toBe(ended);
  });
  it('短い期末は即効、長い期末は育成が有力で、育成は常に最善ではない', () => {
    const rows = compareMatureStrategies();
    expect(rows).toEqual(comparison.results);
    const net = (horizon: number, strategy: string) =>
      rows.find((row) => row.horizon === horizon && row.strategy === strategy)!.result.netValue;
    expect(net(4, 'steady')).toBe(7);
    expect(net(4, 'growing')).toBe(5);
    expect(net(4, 'none')).toBe(4);
    expect(net(10, 'growing')).toBe(23);
    expect(net(10, 'steady')).toBe(19);
    expect(net(10, 'none')).toBe(10);
    const grown = rows.find((row) => row.horizon === 10 && row.strategy === 'growing')!;
    expect(grown.result.cardLevel).toBe(0);
    expect(grown.result.stage).toBe(1);
    expect(grown.result.progress).toBe(3);
  });
  it('全入力の再生と毎入力JSON保存再開が一致し、元状態を変えない', () => {
    for (const row of compareMatureStrategies()) {
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
      expect(summarizeMature(live)).toEqual(row.result);
    }
  });
});

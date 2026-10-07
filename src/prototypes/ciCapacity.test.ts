import { describe, expect, it } from 'vitest';
import { createCiPrototype, tickCiPrototype, summarizeCi, compareCiStrategies } from './ciCapacity';
import comparison from '../../docs/prototypes/ci-capacity-comparison.json';
describe('RI-161 CI枠', () => {
  it('容量上限とFIFOを守り、失敗は1工数手戻り後に末尾へ再投入する', () => {
    let state = createCiPrototype(1, 'ci', 1);
    const snapshot = structuredClone(state);
    state = tickCiPrototype(state, 'all');
    expect(state.jobs.map((j) => j.stage)).toEqual(['ci', 'queue', 'queue']);
    state = tickCiPrototype(state, 'all');
    expect(state.jobs[0]).toMatchObject({ stage: 'done', completedTick: 2, attempts: 1 });
    state = tickCiPrototype(tickCiPrototype(state, 'all'), 'all');
    expect(state.jobs[1]).toMatchObject({ stage: 'rework', attempts: 1, completedTick: null });
    state = tickCiPrototype(state, 'all');
    expect(state.jobs[2].stage).toBe('ci');
    expect(state.jobs[1]).toMatchObject({ stage: 'queue', queuedOrder: 3 });
    expect(snapshot.tick).toBe(0);
    expect(snapshot.jobs.every((j) => j.stage === 'review')).toBe(true);
  });
  it('各tickの仕事を欠落・重複させず、CI処理中を枠以内に保つ', () => {
    for (const capacity of [1, 2] as const)
      for (const flow of ['all', 'paced'] as const) {
        let state = createCiPrototype(1, 'ci', capacity);
        while (state.tick < state.horizon) {
          state = tickCiPrototype(state, flow);
          expect(new Set(state.jobs.map((j) => j.id)).size).toBe(3);
          expect(state.jobs.filter((j) => j.stage === 'ci').length).toBeLessThanOrEqual(capacity);
          expect(
            state.jobs.filter((j) => j.stage === 'done').every((j) => j.completedTick !== null),
          ).toBe(true);
        }
        expect(tickCiPrototype(state, flow)).toBe(state);
      }
  });
  it('容量投資と流入抑制を比較し、レビューが詰まると投資が劣る', () => {
    expect(compareCiStrategies(comparison.seed)).toEqual(comparison.results);
    const [one, two, paced, reviewOne, reviewTwo] = comparison.results;
    expect(two.result.netValue).toBeGreaterThan(one.result.netValue);
    expect(reviewOne.result.netValue).toBeGreaterThan(reviewTwo.result.netValue);
    expect(paced.result.queueWait).toBeLessThan(one.result.queueWait);
    expect(paced.result.upstreamWait).toBeGreaterThan(0);
  });
  it('再実行中の保存再開・入力再生が一致し、資源不足では停止する', () => {
    for (const row of comparison.results) {
      let state = createCiPrototype(
        comparison.seed,
        row.bottleneck as 'ci' | 'review',
        row.capacity as 1 | 2,
      );
      let restored = structuredClone(state);
      for (const input of row.inputs) {
        state = tickCiPrototype(state, input as 'all' | 'paced');
        restored = tickCiPrototype(JSON.parse(JSON.stringify(restored)), input as 'all' | 'paced');
      }
      expect(restored).toEqual(state);
      expect(summarizeCi(state)).toEqual(row.result);
    }
    const exhausted = { ...createCiPrototype(1, 'ci', 2), budget: 1 };
    expect(tickCiPrototype(exhausted, 'all')).toBe(exhausted);
  });
});

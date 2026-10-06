import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/task-dependencies-comparison.json';
import {
  compareDependencyStrategies,
  createDependencyPrototype,
  dependencyEligibility,
  tickDependencyPrototype,
  validateDependencyTasks,
} from './taskDependencies';

describe('RI-154 同一スプリントの一段依存', () => {
  it('自動流入・手動差配を共に止め、前提と理由を返す', () => {
    const state = createDependencyPrototype('RI-154');
    expect(dependencyEligibility(state, 'a')).toEqual({ eligible: false, blocked: ['foundation'] });
    expect(tickDependencyPrototype(state, { kind: 'assign', id: 'a' })).toBe(state);
    const next = tickDependencyPrototype(state, { kind: 'auto', order: ['a', 'b'] });
    expect(next.tick).toBe(1);
    expect(next.tasks).toEqual(state.tasks);
    expect(next.history[0]).toEqual({ tick: 1, id: null, blocked: ['a', 'b'] });
  });
  it('基盤完了後に依存先だけを解除し、同tickには進めない', () => {
    let state = createDependencyPrototype('RI-154');
    state.tasks.push({ id: 'other', requires: ['direct'], workLeft: 1, value: 1, done: false });
    while (!state.tasks[0].done)
      state = tickDependencyPrototype(state, { kind: 'assign', id: 'foundation' });
    expect(dependencyEligibility(state, 'a').eligible).toBe(true);
    expect(dependencyEligibility(state, 'b').eligible).toBe(true);
    expect(dependencyEligibility(state, 'other').eligible).toBe(false);
    expect(state.tasks[1].workLeft).toBe(2);
    expect(tickDependencyPrototype(state, { kind: 'assign', id: 'foundation' })).toBe(state);
  });
  it('循環・欠落・ゼロ工数の未完了・重複IDを検出する', () => {
    const tasks = createDependencyPrototype(1).tasks;
    expect(() =>
      validateDependencyTasks([{ ...tasks[0], requires: ['a'] }, ...tasks.slice(1)]),
    ).toThrow('循環');
    expect(() => validateDependencyTasks(tasks.slice(1))).toThrow('欠落');
    expect(() => validateDependencyTasks([{ ...tasks[0], workLeft: 0 }])).toThrow('不正');
    expect(() => validateDependencyTasks([tasks[0], tasks[0]])).toThrow('重複');
    expect(() => dependencyEligibility(createDependencyPrototype(1), 'unknown')).toThrow();
  });
  it('記録と戦略による出荷時期・残作業・待ち時間の違いを再現する', () => {
    expect(createDependencyPrototype(comparison.seed)).toEqual(comparison.initial);
    expect(compareDependencyStrategies(comparison.seed)).toEqual(comparison.results);
    const [foundation, direct] = compareDependencyStrategies(comparison.seed);
    expect(foundation.waitingTaskTicks).toBeLessThan(direct.waitingTaskTicks);
    expect(foundation.remaining).not.toEqual(direct.remaining);
    expect(direct.shipped[0]).toEqual({ id: 'direct', tick: 3, value: 7 });
  });
  it('元状態を変えず、保存再開と入力再生が一致し、終了後に加算しない', () => {
    const initial = createDependencyPrototype('RI-154');
    const snapshot = structuredClone(initial);
    let state = tickDependencyPrototype(initial, { kind: 'assign', id: 'foundation' });
    expect(initial).toEqual(snapshot);
    let restored = JSON.parse(JSON.stringify(state));
    while (state.tick < state.horizon) {
      const input = { kind: 'auto' as const, order: ['foundation', 'a', 'b', 'direct'] };
      state = tickDependencyPrototype(state, input);
      restored = tickDependencyPrototype(restored, input);
    }
    expect(restored).toEqual(state);
    expect(tickDependencyPrototype(state, { kind: 'wait' })).toBe(state);
  });
});

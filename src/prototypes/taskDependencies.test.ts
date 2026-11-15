import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/task-dependencies-comparison.json';
import factors from '../../docs/prototypes/task-dependencies-factor-comparison.json';
import {
  DEPENDENCY_STRATEGY_ORDERS,
  compareDependencyFactorReversals,
  compareDependencyStrategies,
  createDependencyFactorState,
  createDependencyPrototype,
  dependencyEligibility,
  tickDependencyPrototype,
  validateDependencyTasks,
  type DependencyFactorName,
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
  it('期末・後続価値・納期を一つずつ動かし、価値の優劣が反転する位置を再現する', () => {
    const report = compareDependencyFactorReversals();
    expect(report).toEqual(factors);
    const baseline = createDependencyPrototype(comparison.seed);
    expect(baseline.tasks).toEqual(comparison.initial.tasks);
    expect(baseline.horizon).toBe(report.baseline.horizon);
    const classic = compareDependencyStrategies(comparison.seed);
    const board = (factor: DependencyFactorName, key: number) => {
      const found = report.boards.find((item) => {
        if (item.factor !== factor) return false;
        if (factor === 'horizon') return item.horizon === key;
        if (factor === 'successor-value') return item.successorValue === key;
        return item.successorDeadlineTick === key;
      });
      if (!found) throw new Error(`missing ${factor} ${key}`);
      return found;
    };
    for (const item of report.boards) {
      const changed = [
        item.horizon !== report.baseline.horizon,
        item.successorValue !== report.baseline.successorValue,
        item.successorDeadlineTick !== report.baseline.successorDeadlineTick,
      ].filter(Boolean);
      expect(changed).toHaveLength(1);
      expect(item.tasks.map((task) => task.workLeft)).toEqual(
        baseline.tasks.map((task) => task.workLeft),
      );
      expect(item.tasks.find((task) => task.id === 'foundation')?.value).toBe(1);
      expect(item.tasks.find((task) => task.id === 'direct')?.value).toBe(7);
      expect(item.results.map((result) => result.waitingTaskTicks)).toEqual([6, 12]);
      expect(item.results.map((result) => result.order)).toEqual([
        [...DEPENDENCY_STRATEGY_ORDERS['foundation-first']],
        [...DEPENDENCY_STRATEGY_ORDERS['direct-first']],
      ]);
      item.results.forEach((result, index) => {
        let state = createDependencyFactorState(item);
        for (const id of result.inputs) {
          state = tickDependencyPrototype(
            state,
            id === null ? { kind: 'wait' } : { kind: 'assign', id },
          );
        }
        expect(state.history).toEqual(result.history);
        expect(state.shipped).toEqual(
          result.shipped.map(({ id, tick, value }) => ({ id, tick, value })),
        );
        expect(classic[index]?.strategy).toBe(result.strategy);
      });
      if (item.horizon === report.baseline.horizon) {
        expect(item.results.map((result) => result.inputs)).toEqual(
          classic.map((result) => result.history.map((entry) => entry.id)),
        );
      }
    }
    const week = board('horizon', 7);
    const eight = board('horizon', 8);
    const nine = board('horizon', 9);
    expect(week.valueLeader).toBe('foundation-first');
    expect(week.results[0]?.countedValue).toBe(13);
    expect(week.results[1]?.countedValue).toBe(8);
    expect(week.results[0]?.shipped.map((shipment) => shipment.id)).toEqual([
      'foundation',
      'a',
      'b',
    ]);
    expect(eight.valueLeader).toBe('direct-first');
    expect(eight.results.map((result) => result.countedValue)).toEqual([13, 14]);
    expect(nine.valueLeader).toBe('direct-first');
    expect(nine.results.map((result) => result.countedValue)).toEqual([13, 14]);
    const low = board('successor-value', 3);
    expect(low.verdict).toBe('direct-first');
    expect(low.results.map((result) => result.countedValue)).toEqual([4, 8]);
    const tied = board('successor-value', 7);
    expect(tied.valueLeader).toBe('tie');
    expect(tied.verdict).toBe('foundation-first');
    expect(board('successor-value', 8).valueLeader).toBe('foundation-first');
    const missed = board('successor-deadline', 2);
    expect(missed.verdict).toBe('direct-first');
    expect(missed.results[0]?.countedValue).toBe(1);
    expect(missed.results[0]?.shipped.find((shipment) => shipment.id === 'a')).toMatchObject({
      tick: 5,
      value: 6,
      counted: false,
    });
    expect(missed.results[1]?.countedValue).toBe(8);
    expect(new Set(report.boards.map((item) => item.verdict))).toEqual(
      new Set(['foundation-first', 'direct-first']),
    );
  });
});

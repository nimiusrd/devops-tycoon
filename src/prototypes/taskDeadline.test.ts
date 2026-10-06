import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/task-deadline-comparison.json';
import {
  compareDeadlineStrategies,
  createDeadlinePrototype,
  deadlineValue,
  tickDeadlinePrototype,
} from './taskDeadline';

describe('RI-155 期限tickによる単一価値切替', () => {
  it('期限前・同tick・超過の境界を定義し、超過後も出荷できる', () => {
    const initial = createDeadlinePrototype('RI-155', 'recoverable');
    for (const tick of [2, 3, 4]) {
      let state = {
        ...initial,
        board: {
          ...initial.board,
          tick: tick - 1,
          tasks: [{ ...initial.board.tasks[0], workLeft: 1 }],
        },
      };
      state = tickDeadlinePrototype(state, 'work');
      expect(state.board.shipped).toEqual([{ id: 'campaign', tick, value: tick <= 3 ? 12 : 5 }]);
      expect(tickDeadlinePrototype(state, 'boost')).toBe(state);
    }
    expect(deadlineValue(initial, 3)).toBe(12);
    expect(deadlineValue(initial, 4)).toBe(5);
  });
  it('介入で間に合う盤面と介入しても遅れる盤面の代償を比較する', () => {
    const results = compareDeadlineStrategies(comparison.seed);
    expect(results).toEqual(comparison.results);
    expect(results[0].shipped[0]).toEqual({ id: 'campaign', tick: 4, value: 5 });
    expect(results[1].shipped[0]).toEqual({ id: 'campaign', tick: 3, value: 12 });
    expect(results[2].shipped[0].value).toBe(results[3].shipped[0].value);
    expect(results[2].stamina).toBeGreaterThan(results[3].stamina);
    expect(results[2].focus).toBeGreaterThan(results[3].focus);
  });
  it('集中力・体力不足の介入を拒否し、待機で作業を進めない', () => {
    const state = createDeadlinePrototype(1, 'recoverable');
    for (const limited of [
      { ...state, focus: 0 },
      { ...state, stamina: 2 },
    ])
      expect(tickDeadlinePrototype(limited, 'boost')).toBe(limited);
    const waiting = tickDeadlinePrototype(state, 'wait');
    expect(waiting.board.tasks).toEqual(state.board.tasks);
    expect(waiting.board.tick).toBe(1);
    expect(waiting.focus).toBe(2);
  });
  it('ブーストの二重計上を防ぎ、保存再開と入力再生を一致させる', () => {
    const initial = createDeadlinePrototype('RI-155', 'recoverable');
    const snapshot = structuredClone(initial);
    let state = tickDeadlinePrototype(initial, 'boost');
    expect(initial).toEqual(snapshot);
    let restored = JSON.parse(JSON.stringify(state));
    for (const action of ['wait', 'work', 'work', 'boost'] as const) {
      state = tickDeadlinePrototype(state, action);
      restored = tickDeadlinePrototype(restored, action);
    }
    expect(state).toEqual(restored);
    expect(state.board.shipped).toHaveLength(1);
    expect(state.boosts).toEqual([1]);
    const expired = { ...initial, board: { ...initial.board, tick: 8 } };
    expect(tickDeadlinePrototype(expired, 'boost')).toBe(expired);
  });
});

import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/task-cancellation-comparison.json';
import {
  applyCancellationPrototype,
  compareCancellationStrategies,
  createCancellationPrototype,
  summarizeCancellation,
  type CancellationInput,
} from './taskCancellation';

const cancel: CancellationInput = { kind: 'cancel', id: 'obsolete', reason: '需要がなくなった' };
describe('RI-159 途中キャンセル', () => {
  it('Coding枠を解放し、Doneや出荷価値へ加算せず廃棄理由と投入量を残す', () => {
    const initial = createCancellationPrototype('RI-159', 'shallow');
    const snapshot = structuredClone(initial);
    expect(applyCancellationPrototype(initial, { kind: 'work', ids: ['needed'] })).toBe(initial);
    const cancelled = applyCancellationPrototype(initial, cancel);
    expect(cancelled.activeId).toBeNull();
    expect(cancelled.board.tick).toBe(initial.board.tick);
    expect(cancelled.board.tasks.map((task) => task.id)).toEqual(['needed']);
    expect(summarizeCancellation(cancelled)).toMatchObject({
      doneCount: 0,
      value: 0,
      shipped: [],
      focus: 0,
      trust: 5,
    });
    expect(cancelled.cancelled[0]).toMatchObject({
      status: 'cancelled',
      spentWork: 1,
      reason: '需要がなくなった',
      task: { id: 'obsolete', codingLeft: 3 },
    });
    const next = applyCancellationPrototype(cancelled, { kind: 'work', ids: ['needed'] });
    expect(next.board.tasks[0].codingLeft).toBe(2);
    expect(next.activeId).toBe('needed');
    expect(initial).toEqual(snapshot);
  });
  it('未知・重複・空理由・資源不足・炎上・統合中・Done・期末の拒否は無消費', () => {
    const state = createCancellationPrototype(1, 'shallow', true);
    const cancelled = applyCancellationPrototype(state, cancel);
    expect(applyCancellationPrototype(cancelled, cancel)).toBe(cancelled);
    expect(applyCancellationPrototype(state, { ...cancel, id: 'unknown' })).toBe(state);
    expect(applyCancellationPrototype(state, { ...cancel, reason: '  ' })).toBe(state);
    for (const rejected of [
      { ...state, focus: 0 },
      { ...state, burningIds: ['obsolete'] },
      { ...state, board: { ...state.board, tick: state.board.horizon } },
      {
        ...state,
        board: {
          ...state.board,
          tasks: state.board.tasks.map((task) =>
            task.id === 'obsolete' ? { ...task, codingLeft: 0, integrationLeft: 2 } : task,
          ),
        },
      },
      {
        ...state,
        board: {
          ...state.board,
          tasks: state.board.tasks.map((task) =>
            task.id === 'obsolete' ? { ...task, codingLeft: 0, completedTick: 1 } : task,
          ),
        },
      },
    ])
      expect(applyCancellationPrototype(rejected, cancel)).toBe(rejected);
  });
  it('契約中止の信頼費用を一度だけ払い、拒否時には減らさない', () => {
    const state = createCancellationPrototype(1, 'shallow', true);
    const rejected = { ...state, burningIds: ['obsolete'] };
    expect(applyCancellationPrototype(rejected, cancel)).toBe(rejected);
    const next = applyCancellationPrototype(state, cancel);
    expect(next.trust).toBe(3);
    expect(next.focus).toBe(0);
    expect(next.cancelled[0].trustCost).toBe(2);
    expect(applyCancellationPrototype(next, cancel)).toBe(next);
  });
  it('浅い投入では中止、完了間近では継続が有利となる比較を再現する', () => {
    expect(compareCancellationStrategies(comparison.seed)).toEqual(comparison.results);
    const [shallowContinue, shallowCancel, nearContinue, nearCancel] = comparison.results;
    expect(shallowCancel.value).toBeGreaterThan(shallowContinue.value);
    expect(nearContinue.value).toBeGreaterThan(nearCancel.value);
    expect(shallowCancel.cancelled[0].spentWork).toBe(1);
    expect(nearCancel.cancelled[0].spentWork).toBe(3);
  });
  it('廃棄後の保存再開と初期状態からの入力再生が一致する', () => {
    const initial = createCancellationPrototype('RI-159', 'shallow');
    const cancelled = applyCancellationPrototype(initial, cancel);
    let live = cancelled;
    let restored = JSON.parse(JSON.stringify(cancelled));
    let replay = applyCancellationPrototype(initial, cancel);
    for (let i = 0; i < 3; i++) {
      const input: CancellationInput = { kind: 'work', ids: ['needed'] };
      live = applyCancellationPrototype(live, input);
      restored = applyCancellationPrototype(restored, input);
      replay = applyCancellationPrototype(replay, input);
    }
    expect(restored).toEqual(live);
    expect(replay).toEqual(live);
    expect(summarizeCancellation(live)).toMatchObject({ doneCount: 1, value: 8 });
    expect(applyCancellationPrototype(live, { kind: 'work', ids: ['obsolete'] })).toBe(live);
  });
});

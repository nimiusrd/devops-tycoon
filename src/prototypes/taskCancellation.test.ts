import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/task-cancellation-comparison.json';
import sensitivity from '../../docs/prototypes/task-cancellation-sensitivity.json';
import {
  applyCancellationPrototype,
  compareCancellationFactors,
  compareCancellationStrategies,
  createCancellationPrototype,
  summarizeCancellation,
  type CancellationInput,
  type CancellationState,
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
  it('同じ浅い盤面で要因を一つずつ動かし、出荷価値の優劣が反転する位置を再現する', () => {
    expect(compareCancellationFactors(sensitivity.seed)).toEqual(sensitivity);
    expect(sensitivity).toMatchObject({
      investment: 'shallow',
      metric: 'shipped-value',
      humanPlay: false,
      adaptive: false,
    });
    expect(sensitivity.boundaries).toEqual([
      { factor: 'focus', cancel: [1], continue: [2, 3], tie: [], unavailable: [] },
      { factor: 'cancel-cost', cancel: [0, 1], continue: [2], tie: [], unavailable: [] },
      { factor: 'contract-ratio', cancel: [0, 2, 4, 5], continue: [], tie: [], unavailable: [6] },
      { factor: 'no-alternative', cancel: [-1], continue: [1, 2], tie: [0], unavailable: [] },
      { factor: 'announce', cancel: [1, 2], continue: [3], tie: [4, 5], unavailable: [] },
    ]);
    const shallow = comparison.results[0].initial;
    for (const row of sensitivity.results) {
      expect(row.initial.board.tick).toBe(1);
      expect(row.initial.board.history).toHaveLength(1);
      expect(row.doneCount).toBe(row.shipped.length);
      for (const item of row.cancelled) {
        expect(row.shipped.some((shipped) => shipped.id === item.task.id)).toBe(false);
      }
      if (
        row.factor === 'announce' ||
        row.factor === 'cancel-cost' ||
        (row.factor === 'focus' && row.level === 1)
      ) {
        expect(row.initial).toEqual(shallow);
      }
    }
    const judgment = (factor: string, level: number) =>
      sensitivity.judgments.find((row) => row.factor === factor && row.level === level);
    expect(judgment('focus', 1)).toMatchObject({ continueValue: 2, cancelValue: 8 });
    expect(judgment('focus', 2)).toMatchObject({ continueValue: 10, cancelValue: 8 });
    expect(judgment('cancel-cost', 1)).toMatchObject({ continueValue: 2, cancelValue: 8 });
    expect(judgment('cancel-cost', 2)).toMatchObject({ continueValue: 2, cancelValue: 0 });
    expect(judgment('contract-ratio', 5)).toMatchObject({
      judgment: 'cancel',
      continueValue: 2,
      cancelValue: 8,
      valueGap: 6,
      trustSpent: 5,
    });
    expect(judgment('contract-ratio', 6)).toMatchObject({
      judgment: 'cancel-unavailable',
      cancelValue: 0,
      trustSpent: 0,
    });
    expect(judgment('no-alternative', 0)).toMatchObject({
      judgment: 'tie',
      continueValue: 0,
      cancelValue: 0,
    });
    expect(judgment('no-alternative', -1)).toMatchObject({ continueValue: -1, cancelValue: 0 });
    expect(judgment('announce', 2)).toMatchObject({ cancelValue: 8 });
    expect(judgment('announce', 3)).toMatchObject({ continueValue: 2, cancelValue: 0 });
  });
  it('感度比較の入力列を同じ規則で再生し、中止を成果に戻さない', () => {
    for (const row of sensitivity.results) {
      let state = structuredClone(row.initial) as CancellationState;
      for (const input of row.inputs) {
        state = applyCancellationPrototype(state, input as CancellationInput, row.rules);
      }
      expect(summarizeCancellation(state)).toEqual({
        tick: row.tick,
        shipped: row.shipped,
        value: row.value,
        integrationEffort: row.integrationEffort,
        remaining: row.remaining,
        workSpent: row.workSpent,
        focus: row.focus,
        trust: row.trust,
        doneCount: row.doneCount,
        cancelled: row.cancelled,
      });
      expect(state.inputs).toEqual(row.inputs);
    }
  });
  it('無償の中止、払えない費用、占有を外す作業は資源を消費しない', () => {
    const state = createCancellationPrototype('RI-159', 'shallow');
    const snapshot = structuredClone(state);
    expect(
      applyCancellationPrototype(state, cancel, {
        cancelFocusCost: 0,
        cancelTickCost: 0,
        contractRatio: null,
        announceTick: null,
      }),
    ).toBe(state);
    expect(applyCancellationPrototype(state, cancel, { cancelFocusCost: 2 })).toBe(state);
    expect(applyCancellationPrototype(state, cancel, { announceTick: 3 })).toBe(state);
    const parallel = createCancellationPrototype('RI-159', 'shallow');
    parallel.board = { ...parallel.board, slots: 2 };
    parallel.focus = 2;
    expect(applyCancellationPrototype(parallel, { kind: 'work', ids: ['needed'] })).toBe(parallel);
    const both = applyCancellationPrototype(parallel, {
      kind: 'work',
      ids: ['obsolete', 'needed'],
    });
    expect(both.board.tasks.map((task) => task.codingLeft)).toEqual([2, 2]);
    expect(both.activeId).toBe('obsolete');
    const swapped = applyCancellationPrototype(parallel, {
      kind: 'work',
      ids: ['needed', 'obsolete'],
    });
    expect(swapped.board.tasks.map((task) => task.codingLeft)).toEqual([2, 2]);
    expect(applyCancellationPrototype(swapped, { kind: 'work', ids: ['needed'] })).toBe(swapped);
    expect(applyCancellationPrototype(swapped, { kind: 'work', ids: ['obsolete'] })).toBe(swapped);
    const kept = applyCancellationPrototype(swapped, {
      kind: 'work',
      ids: ['needed', 'obsolete'],
    });
    expect(kept.board.tasks.map((task) => task.codingLeft)).toEqual([1, 1]);
    expect(kept.activeId).toBe('obsolete');
    expect(state).toEqual(snapshot);
    const unaffordable = sensitivity.results.find(
      (row) => row.factor === 'contract-ratio' && row.level === 6 && row.strategy === 'cancel',
    );
    expect(unaffordable).toMatchObject({
      cancelRejected: true,
      value: 0,
      focus: 1,
      trust: 5,
      cancelled: [],
    });
    expect(unaffordable?.remaining.map((task) => task.codingLeft)).toEqual([3, 3]);
  });
});

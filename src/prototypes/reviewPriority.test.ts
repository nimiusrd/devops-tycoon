import { describe, expect, it } from 'vitest';
import {
  createPriorityPrototype,
  applyPriorityInput,
  summarizePriority,
  comparePriorityStrategies,
} from './reviewPriority';
import comparison from '../../docs/prototypes/review-priority-comparison.json';

describe('RI-165 レビュー追い越し', () => {
  it('対象だけ先頭へ動かし、他の順序・進捗・時刻を保持する', () => {
    const initial = createPriorityPrototype(1, 'b');
    const snapshot = structuredClone(initial);
    const promoted = applyPriorityInput(initial, { type: 'promote', id: 'b' });
    expect(promoted.board.jobs.map((job) => job.id)).toEqual(['b', 'a', 'c']);
    expect(promoted.board.jobs.every((job) => job.reviewLeft === 2 && job.stage === 'review')).toBe(
      true,
    );
    expect(promoted.board.tick).toBe(0);
    expect(promoted.focus).toBe(4);
    expect(applyPriorityInput(promoted, { type: 'promote', id: 'b' })).toBe(promoted);
    expect(initial).toEqual(snapshot);
  });
  it('先頭の処理後も他PRが安定順序で続き、後回しの待ちを記録する', () => {
    let state = applyPriorityInput(createPriorityPrototype(1, 'b'), { type: 'promote', id: 'b' });
    for (let i = 0; i < 3; i++) state = applyPriorityInput(state, { type: 'tick' });
    expect(state.board.jobs.find((job) => job.id === 'b')).toMatchObject({
      stage: 'done',
      completedTick: 3,
    });
    expect(state.board.jobs.find((job) => job.id === 'a')).toMatchObject({
      stage: 'review',
      reviewLeft: 1,
    });
    expect(state.reviewWait).toEqual({ a: 2, b: 0, c: 3 });
    expect(applyPriorityInput(state, { type: 'promote', id: 'c' })).toBe(state);
  });
  it('未知対象・Review以外・資源不足・期末を無消費で拒否する', () => {
    const initial = createPriorityPrototype(1, 'b');
    expect(applyPriorityInput(initial, { type: 'promote', id: 'missing' })).toBe(initial);
    const poor = { ...initial, focus: 1 };
    expect(applyPriorityInput(poor, { type: 'promote', id: 'b' })).toBe(poor);
    expect(applyPriorityInput(poor, { type: 'rush' })).toBe(poor);
    let state = initial;
    for (let i = 0; i < 2; i++) state = applyPriorityInput(state, { type: 'tick' });
    expect(applyPriorityInput(state, { type: 'promote', id: 'a' })).toBe(state);
    const exhausted = { ...state, board: { ...state.board, budget: 0 } };
    expect(applyPriorityInput(exhausted, { type: 'tick' })).toBe(exhausted);
    const ended = { ...state, board: { ...state.board, tick: state.board.horizon } };
    expect(applyPriorityInput(ended, { type: 'rush' })).toBe(ended);
  });
  it('一括即処理は先頭2件のレビューだけを完了し、CIを飛ばさない', () => {
    const rushed = applyPriorityInput(createPriorityPrototype(1, 'b'), { type: 'rush' });
    expect(rushed.board.jobs.map((job) => job.reviewLeft)).toEqual([0, 0, 2]);
    expect(rushed.board.jobs.every((job) => job.stage === 'review')).toBe(true);
    expect(rushed.focusSpent).toBe(6);
    expect(summarizePriority(rushed).value).toBe(0);
  });
  it('期限が変わると順番維持と追い越しの優劣が反転する', () => {
    expect(comparePriorityStrategies(comparison.seed)).toEqual(comparison.results);
    const [aFifo, aPromote, , bFifo, bPromote, bRush] = comparison.results;
    expect(aFifo.result.netValue).toBeGreaterThan(aPromote.result.netValue);
    expect(bPromote.result.netValue).toBeGreaterThan(bFifo.result.netValue);
    expect(bPromote.result.netValue).toBeGreaterThan(bRush.result.netValue);
    expect(bPromote.result.reviewWait.a).toBeGreaterThan(bFifo.result.reviewWait.a);
    expect(bPromote.result.focusSpent).toBeLessThan(bRush.result.focusSpent);
  });
  it('順序変更後・Review途中・CI待ちの保存再開と入力再生が一致する', () => {
    for (const row of comparePriorityStrategies(comparison.seed)) {
      let live = row.initial;
      let restored = structuredClone(live);
      for (const input of row.inputs) {
        live = applyPriorityInput(live, input);
        restored = applyPriorityInput(JSON.parse(JSON.stringify(restored)), input);
        expect(restored).toEqual(live);
        expect(new Set(live.board.jobs.map((job) => job.id)).size).toBe(3);
      }
      expect(summarizePriority(live)).toEqual(row.result);
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  createSequencePrototype,
  applySequenceInput,
  compareSequenceStrategies,
  summarizeSequence,
} from './interventionSequence';
import comparison from '../../docs/prototypes/intervention-sequence-comparison.json';
describe('RI-168 原因に沿った2手介入', () => {
  it('同系統の分割後レビューだけが統合失敗を防ぎ、逆順・別対象では変わらない', () => {
    const initial = createSequencePrototype('RI-168');
    const split = applySequenceInput(initial, { type: 'split', id: 'parent' });
    const reviewed = applySequenceInput(split, { type: 'pairReview', id: 'split-1' });
    expect(reviewed.board.integrationFails).toBe(false);
    expect(reviewed.board.focusSpent).toBe(4);
    expect(reviewed.board.tick).toBe(1);
    expect(split.board.integrationFails).toBe(true);
    const reverse = applySequenceInput(
      applySequenceInput(initial, { type: 'pairReview', id: 'parent' }),
      { type: 'split', id: 'parent' },
    );
    expect(reverse.board.integrationFails).toBe(true);
    expect(
      applySequenceInput(split, { type: 'pairReview', id: 'other' }).board.integrationFails,
    ).toBe(true);
  });
  it('同系統での連打を無消費で拒否し、期限後の確認には連携効果がない', () => {
    let state = applySequenceInput(createSequencePrototype('RI-168'), {
      type: 'split',
      id: 'parent',
    });
    const reviewed = applySequenceInput(state, { type: 'pairReview', id: 'split-1' });
    expect(applySequenceInput(reviewed, { type: 'pairReview', id: 'split-2' })).toBe(reviewed);
    for (let i = 0; i < 3; i++) state = applySequenceInput(state, { type: 'wait' });
    const late = applySequenceInput(state, { type: 'pairReview', id: 'split-1' });
    expect(late.board.integrationFails).toBe(true);
    expect(late.board.focusSpent).toBe(4);
  });
  it('未知・退役・Done・資源不足・期末を拒否する', () => {
    const initial = createSequencePrototype('RI-168');
    expect(applySequenceInput(initial, { type: 'pairReview', id: 'missing' })).toBe(initial);
    const split = applySequenceInput(initial, { type: 'split', id: 'parent' });
    expect(applySequenceInput(split, { type: 'pairReview', id: 'parent' })).toBe(split);
    expect(applySequenceInput(split, { type: 'pairReview', id: 'split-3' })).toBe(split);
    const poor = { ...split, board: { ...split.board, focus: 1 } };
    expect(applySequenceInput(poor, { type: 'pairReview', id: 'split-1' })).toBe(poor);
    const ended = { ...split, board: { ...split.board, tick: split.board.horizon } };
    expect(applySequenceInput(ended, { type: 'pairReview', id: 'split-1' })).toBe(ended);
    let done = split;
    for (let i = 0; i < 3; i++) done = applySequenceInput(done, { type: 'work', id: 'split-1' });
    expect(applySequenceInput(done, { type: 'pairReview', id: 'split-1' })).toBe(done);
  });
  it('連携の余裕があれば有効だが、緊急時は分割だけの即時対応が有力', () => {
    const rows = compareSequenceStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    expect(rows[0].result.netValue).toBeGreaterThan(rows[1].result.netValue);
    expect(rows[5].result.netValue).toBeGreaterThan(rows[4].result.netValue);
    expect(rows[5].result.netValue).toBeGreaterThan(rows[6].result.netValue);
    expect(rows[6].result.focusSpent).toBe(rows[5].result.focusSpent);
  });
  it('毎入力のJSON保存再開と再生が一致し、元状態を変更しない', () => {
    for (const row of compareSequenceStrategies(comparison.seed)) {
      let live = row.initial;
      let restored = structuredClone(live);
      for (const input of row.inputs) {
        const before = structuredClone(live);
        const previous = live;
        live = applySequenceInput(live, input);
        expect(previous).toEqual(before);
        restored = applySequenceInput(JSON.parse(JSON.stringify(restored)), input);
        expect(restored).toEqual(live);
      }
      expect(summarizeSequence(live)).toEqual(row.result);
    }
  });
});

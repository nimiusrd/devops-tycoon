import { describe, expect, it } from 'vitest';
import {
  applySplitInput,
  createSplitPrototype,
  compareSplitStrategies,
  summarizeSplit,
} from './prSplit';
import comparison from '../../docs/prototypes/pr-split-comparison.json';
describe('RI-166 子タスクへのPR分割', () => {
  it('系譜・価値保存・追加工数・巻き戻しを記録し、再分割しない', () => {
    const initial = createSplitPrototype('RI-166');
    const snapshot = structuredClone(initial);
    const split = applySplitInput(initial, { type: 'split', id: 'parent' });
    expect(split.tasks[0].children).toEqual(['split-1', 'split-2', 'split-3']);
    expect(split.tasks.slice(1).every((t) => t.parentId === 'parent')).toBe(true);
    expect(split.tasks.slice(1).reduce((n, t) => n + t.value, 0)).toBe(12);
    expect(split.tasks.slice(1).reduce((n, t) => n + t.workLeft, 0)).toBe(8);
    expect(split.discardedWork).toBe(2);
    expect(applySplitInput(split, { type: 'split', id: 'parent' })).toBe(split);
    expect(applySplitInput(split, { type: 'split', id: 'split-1' })).toBe(split);
    expect(initial).toEqual(snapshot);
  });
  it('採番は既存IDを避け、未知・資源不足・期末は無消費で拒否する', () => {
    const initial = createSplitPrototype('RI-166');
    initial.tasks.push({ ...initial.tasks[0], id: 'split-1' });
    const split = applySplitInput(initial, { type: 'split', id: 'parent' });
    expect(new Set(split.tasks.map((t) => t.id)).size).toBe(split.tasks.length);
    expect(split.tasks[0].children).toEqual(['split-2', 'split-3', 'split-4']);
    expect(applySplitInput(initial, { type: 'split', id: 'missing' })).toBe(initial);
    const poor = { ...initial, focus: 1 };
    expect(applySplitInput(poor, { type: 'split', id: 'parent' })).toBe(poor);
    const ended = { ...initial, tick: initial.horizon };
    expect(applySplitInput(ended, { type: 'work', id: 'parent' })).toBe(ended);
  });
  it('子の出荷前に統合できず、統合失敗でも先行成果を失わない', () => {
    let state = applySplitInput(createSplitPrototype('RI-166', 10, true), {
      type: 'split',
      id: 'parent',
    });
    expect(applySplitInput(state, { type: 'work', id: 'split-3' })).toBe(state);
    for (const id of ['split-1', 'split-2'])
      for (let i = 0; i < 3; i++) state = applySplitInput(state, { type: 'work', id });
    for (let i = 0; i < 2; i++) state = applySplitInput(state, { type: 'work', id: 'split-3' });
    expect(summarizeSplit(state)).toMatchObject({
      value: 8,
      failures: 1,
      remaining: [{ id: 'split-3', workLeft: 2 }],
    });
    expect(applySplitInput(state, { type: 'work', id: 'split-1' })).toBe(state);
    for (let i = 0; i < 2; i++) state = applySplitInput(state, { type: 'work', id: 'split-3' });
    expect(summarizeSplit(state)).toMatchObject({ value: 12, failures: 1, remaining: [] });
  });
  it('期末が近いと分割、余裕があると単一PRが有利になる', () => {
    const rows = compareSplitStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    expect(rows[1].result.netValue).toBeGreaterThan(rows[0].result.netValue);
    expect(rows[4].result.netValue).toBeGreaterThan(rows[5].result.netValue);
  });
  it('全比較を毎入力保存再開・再生し、元状態を変更しない', () => {
    for (const row of compareSplitStrategies(comparison.seed)) {
      let live = row.initial;
      let restored = structuredClone(live);
      for (const input of row.inputs) {
        const before = structuredClone(live);
        const previous = live;
        live = applySplitInput(live, input);
        expect(previous).toEqual(before);
        restored = applySplitInput(JSON.parse(JSON.stringify(restored)), input);
        expect(restored).toEqual(live);
      }
      expect(summarizeSplit(live)).toEqual(row.result);
    }
  });
});

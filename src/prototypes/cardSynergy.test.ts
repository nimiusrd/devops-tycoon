import { describe, expect, it } from 'vitest';
import {
  applySynergyInput as apply,
  compareSynergyStrategies,
  createSynergyPrototype as create,
  summarizeSynergy,
  viewSynergy,
} from './cardSynergy';
import comparison from '../../docs/prototypes/card-synergy-comparison.json';

describe('RI-184 条件付き相乗効果', () => {
  it('所持だけでは自動処理が始まらず、閲覧は状態を変えない', () => {
    const state = create(1, 'routine');
    expect(create(1, 'routine')).toEqual(state);
    const before = structuredClone(state);
    expect(viewSynergy(state)).toMatchObject({
      owned: { test: true, ai: true },
      active: { test: false, ai: false },
      manualRoutine: 1,
      autoRoutine: 0,
    });
    expect(state).toEqual(before);
  });
  it('片方の発動は係数だけを足し、両方で自動処理が1件だけ別枠になる', () => {
    const testOnly = apply(create(1, 'routine'), { type: 'activate', id: 'test' });
    expect(viewSynergy(testOnly)).toMatchObject({ manualRoutine: 2, autoRoutine: 0 });
    expect(apply(testOnly, { type: 'tick' })).toMatchObject({ routineCleared: 2, autoCleared: 0 });
    const both = apply(apply(create(1, 'routine'), { type: 'activate', id: 'test' }), {
      type: 'activate',
      id: 'ai',
    });
    expect(viewSynergy(both)).toMatchObject({ manualRoutine: 3, autoRoutine: 1 });
    expect(apply(both, { type: 'tick' })).toMatchObject({ routineCleared: 4, autoCleared: 1 });
    const reversed = apply(apply(create(1, 'routine'), { type: 'activate', id: 'ai' }), {
      type: 'activate',
      id: 'test',
    });
    expect(apply(reversed, { type: 'tick' })).toMatchObject({ routineCleared: 4, autoCleared: 1 });
  });
  it('同じカードの再発動と集中力不足、期末の操作は無消費で拒否する', () => {
    const once = apply(create(1, 'routine'), { type: 'activate', id: 'test' });
    expect(apply(once, { type: 'activate', id: 'test' })).toBe(once);
    const poor = { ...create(1, 'routine'), focus: 0 };
    expect(apply(poor, { type: 'activate', id: 'ai' })).toBe(poor);
    const ended = { ...create(1, 'routine'), tick: 6 };
    expect(apply(ended, { type: 'activate', id: 'test' })).toBe(ended);
    expect(apply(ended, { type: 'tick' })).toBe(ended);
  });
  it('定型は両方発動、障害は無発動が有力で、組合せは固定必須にならない', () => {
    const rows = compareSynergyStrategies();
    expect(rows).toEqual(comparison.results);
    const net = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.netValue;
    expect(net('routine', 'both')).toBe(22);
    expect(net('routine', 'test')).toBe(11);
    expect(net('routine', 'ai')).toBe(11);
    expect(net('routine', 'none')).toBe(6);
    expect(net('incident', 'none')).toBe(6);
    expect(net('incident', 'test')).toBe(5);
    expect(net('incident', 'ai')).toBe(5);
    expect(net('incident', 'both')).toBe(4);
    const combo = rows.find((row) => row.board === 'routine' && row.strategy === 'both')!;
    expect(combo.result.autoCleared).toBe(6);
    expect(combo.result.routineCleared - combo.result.autoCleared).toBe(18);
  });
  it('全入力の再生と毎入力JSON保存再開が一致し、元状態を変えない', () => {
    for (const row of compareSynergyStrategies()) {
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
      expect(summarizeSynergy(live)).toEqual(row.result);
    }
  });
});

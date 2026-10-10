import { describe, expect, it } from 'vitest';
import {
  applySlotInput as apply,
  compareSlotStrategies,
  createSlotPrototype as create,
  summarizeSlots,
  viewSlots,
} from './operationSlots';
import comparison from '../../docs/prototypes/operation-slots-comparison.json';

describe('RI-183 施策の運用枠', () => {
  it('所持3枚と運用枠2を分けて表示し、閲覧は状態を変えない', () => {
    const state = create(1, 'routine');
    expect(create(1, 'routine')).toEqual(state);
    const before = structuredClone(state);
    expect(viewSlots(state)).toMatchObject({
      slotCap: 2,
      owned: ['lint', 'tests', 'platform'],
      active: [],
      usedSlots: 0,
      basePerTick: 1,
    });
    expect(state).toEqual(before);
  });
  it('枠を超える有効化は集中力が残っていても拒否し、無効化は恒久の基礎値を残す', () => {
    const platform = apply(create(1, 'routine'), { type: 'enable', id: 'platform' });
    expect(viewSlots(platform)).toMatchObject({ usedSlots: 2, focus: 2, bonusPerTick: 2 });
    expect(apply(platform, { type: 'enable', id: 'lint' })).toBe(platform);
    let state = apply(platform, { type: 'tick' });
    expect(state.earnedValue).toBe(3);
    expect(state.upkeepPaid).toBe(1);
    state = apply(state, { type: 'disable', id: 'platform' });
    expect(state.active).toEqual([]);
    expect(state.owned).toEqual(['lint', 'tests', 'platform']);
    state = apply(state, { type: 'tick' });
    expect(state.earnedValue).toBe(4);
    expect(state.upkeepPaid).toBe(1);
    state = apply(state, { type: 'enable', id: 'platform' });
    state = apply(state, { type: 'tick' });
    expect(state.earnedValue).toBe(7);
    expect(state.upkeepPaid).toBe(2);
    expect(viewSlots(state).basePerTick).toBe(1);
  });
  it('軽量2つの同時運用は枠ちょうどで、3つ目は無消費で拒否する', () => {
    const state = apply(apply(create(1, 'migration'), { type: 'enable', id: 'lint' }), {
      type: 'enable',
      id: 'tests',
    });
    expect(viewSlots(state)).toMatchObject({ usedSlots: 2, freeSlots: 0, bonusPerTick: 0 });
    expect(apply(state, { type: 'enable', id: 'platform' })).toBe(state);
    expect(apply(state, { type: 'enable', id: 'lint' })).toBe(state);
    expect(apply(state, { type: 'disable', id: 'platform' })).toBe(state);
    const poor = { ...state, focus: 0 };
    expect(apply(poor, { type: 'disable', id: 'lint' })).toBe(poor);
  });
  it('期末の操作は無消費で拒否する', () => {
    const ended = { ...create(1, 'routine'), tick: 6 };
    expect(apply(ended, { type: 'enable', id: 'lint' })).toBe(ended);
    expect(apply(ended, { type: 'disable', id: 'lint' })).toBe(ended);
    expect(apply(ended, { type: 'tick' })).toBe(ended);
  });
  it('定型は軽量の組合せ、移行は大型施策が有力で、維持費は大型だけが毎tick払う', () => {
    const rows = compareSlotStrategies();
    expect(rows).toEqual(comparison.results);
    const net = (workload: string, strategy: string) =>
      rows.find((row) => row.workload === workload && row.strategy === strategy)!.result.netValue;
    expect(net('routine', 'lights')).toBe(16);
    expect(net('routine', 'platform')).toBe(11);
    expect(net('migration', 'platform')).toBe(23);
    expect(net('migration', 'lights')).toBe(4);
    const platform = rows.find(
      (row) => row.workload === 'migration' && row.strategy === 'platform',
    )!;
    const lights = rows.find((row) => row.workload === 'routine' && row.strategy === 'lights')!;
    expect(platform.result.upkeepPaid).toBe(6);
    expect(lights.result.upkeepPaid).toBe(0);
    expect(rows.every((row) => row.result.ownedCount === 3 && row.result.usedSlots === 2)).toBe(
      true,
    );
  });
  it('全入力の再生と毎入力JSON保存再開が一致し、元状態を変えない', () => {
    for (const row of compareSlotStrategies()) {
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
      expect(summarizeSlots(live)).toEqual(row.result);
    }
  });
});

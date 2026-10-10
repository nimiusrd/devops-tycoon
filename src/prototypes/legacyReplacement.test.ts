import { describe, expect, it } from 'vitest';
import {
  applyLegacyInput as apply,
  chooseLegacyAction,
  compareLegacyStrategies,
  createLegacyPrototype as create,
  summarizeLegacy,
} from './legacyReplacement';
import comparison from '../../docs/prototypes/legacy-replacement-comparison.json';

describe('RI-179 レガシーの段階置換', () => {
  it('3件が揃う前は二重負担が残り、部分完了では新系の改善が出ない', () => {
    let state = apply(create('RI-179', 10), { type: 'start' });
    expect(state.mode).toBe('dual');
    state = apply(state, { type: 'migrate' });
    const shipped = apply(state, { type: 'ship' });
    expect(shipped).toMatchObject({ mode: 'dual', dualValue: 2, modernValue: 0, legacyValue: 0 });
    expect(shipped.tasks.filter((task) => task.done)).toHaveLength(1);
    expect(apply(shipped, { type: 'cutover' })).toBe(shipped);
    state = apply(apply(state, { type: 'migrate' }), { type: 'ship' });
    expect(summarizeLegacy(state)).toMatchObject({
      doneTasks: 2,
      mode: 'dual',
      modernValue: 0,
      netValue: 2,
    });
  });
  it('切替後は新系だけが増え、旧系の成果を重ねない', () => {
    let state = apply(create('RI-179', 10), { type: 'start' });
    for (let i = 0; i < 3; i++) state = apply(state, { type: 'migrate' });
    const before = structuredClone(state);
    state = apply(state, { type: 'cutover' });
    expect(state.mode).toBe('modern');
    expect(state.tick).toBe(before.tick);
    expect(state.legacyValue).toBe(0);
    expect(state.dualValue).toBe(0);
    expect(state.modernValue).toBe(0);
    state = apply(state, { type: 'ship' });
    expect(state).toMatchObject({ legacyValue: 0, dualValue: 0, modernValue: 8 });
    state = apply(state, { type: 'ship' });
    expect(state.modernValue).toBe(16);
    expect(state.legacyValue + state.dualValue).toBe(0);
    expect(apply(state, { type: 'migrate' })).toBe(state);
    expect(apply(state, { type: 'abandon' })).toBe(state);
  });
  it('切替前の撤回は負担を止め、進捗は残して改善は出さない', () => {
    let state = apply(apply(create('RI-179', 8), { type: 'start' }), { type: 'migrate' });
    state = apply(state, { type: 'abandon' });
    expect(state).toMatchObject({ mode: 'legacy', tick: 1 });
    expect(state.tasks.filter((task) => task.done)).toHaveLength(1);
    state = apply(state, { type: 'ship' });
    expect(state).toMatchObject({ legacyValue: 4, dualValue: 0, modernValue: 0 });
    expect(apply(create('RI-179', 8), { type: 'abandon' })).toEqual(create('RI-179', 8));
  });
  it('未開始の置換・二重開始・期末は無消費で拒否する', () => {
    const initial = create('RI-179', 5);
    expect(apply(initial, { type: 'migrate' })).toBe(initial);
    expect(apply(initial, { type: 'cutover' })).toBe(initial);
    const dual = apply(initial, { type: 'start' });
    expect(apply(dual, { type: 'start' })).toBe(dual);
    const ended = { ...initial, tick: initial.horizon };
    for (const type of ['start', 'abandon', 'cutover', 'migrate', 'ship'] as const)
      expect(apply(ended, { type })).toBe(ended);
  });
  it('短い期末は見送り、長い期末は置換完了が有利で、途中停止は改善を得ない', () => {
    const rows = compareLegacyStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const net = (horizon: number, strategy: string) =>
      rows.find((row) => row.horizon === horizon && row.strategy === strategy)!.result.netValue;
    expect([net(5, 'ship'), net(5, 'replace'), net(5, 'partial')]).toEqual([20, 16, 6]);
    expect([net(10, 'ship'), net(10, 'replace'), net(10, 'partial')]).toEqual([40, 56, 16]);
    const replaced = rows.find((row) => row.horizon === 10 && row.strategy === 'replace')!;
    const halfway = rows.find((row) => row.horizon === 10 && row.strategy === 'partial')!;
    expect(replaced.result).toMatchObject({
      mode: 'modern',
      doneTasks: 3,
      legacyValue: 0,
      modernValue: 56,
    });
    expect(halfway.result).toMatchObject({
      mode: 'dual',
      doneTasks: 2,
      modernValue: 0,
      dualValue: 16,
    });
  });
  it('全入力の再生と毎入力JSON保存再開が一致し、三つの価値を二重計上しない', () => {
    for (const row of compareLegacyStrategies(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
        expect(chooseLegacyAction(previous, row.strategy)).toEqual(input);
        expect(live.legacyValue + live.dualValue + live.modernValue).toBe(
          summarizeLegacy(live).netValue,
        );
      }
      expect(summarizeLegacy(live)).toEqual(row.result);
    }
  });
});

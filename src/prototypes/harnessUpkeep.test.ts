import { describe, expect, it } from 'vitest';
import {
  applyHarnessInput as apply,
  chooseHarnessAction,
  compareHarnessStrategies,
  createHarnessPrototype as create,
  summarizeHarness,
  viewHarness,
} from './harnessUpkeep';
import comparison from '../../docs/prototypes/harness-upkeep-comparison.json';

describe('RI-198 内製ハーネスの保守', () => {
  it('導入直後は満額で、猶予と失効後の効果を最初から表示する', () => {
    const first = create(198, 4);
    expect(create(198, 4)).toEqual(first);
    expect(create(199, 4).generation).not.toBe(first.generation);
    const before = structuredClone(first);
    const blank = viewHarness(first);
    for (let i = 0; i < 10; i++) expect(viewHarness(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toMatchObject({
      grace: 4,
      updateTicks: 2,
      freshValue: 6,
      staleValue: 2,
      dueIn: null,
    });
    const chosen = apply(first, { type: 'choose', kind: 'inhouse' });
    expect(viewHarness(chosen)).toMatchObject({ dueIn: 4, effect: 6, updating: 0 });
    expect(summarizeHarness(chosen).netValue).toBe(0);
    let state = chosen;
    for (let i = 0; i < 4; i++) state = apply(state, { type: 'tick' });
    expect(state).toMatchObject({ value: 24, dueIn: 0, staleTicks: 0, fees: 0 });
    expect(viewHarness(state).effect).toBe(2);
  });
  it('保守の2tickは自動化を止め、期限を戻す。外部利用費とは別会計', () => {
    let state = apply(apply(create(198, 10), { type: 'choose', kind: 'inhouse' }), {
      type: 'update',
    });
    expect(state).toMatchObject({ updating: 2, tick: 0, value: 0 });
    expect(apply(state, { type: 'update' })).toBe(state);
    state = apply(state, { type: 'tick' });
    expect(state).toMatchObject({ updating: 1, value: 0, upkeepTicks: 1 });
    state = apply(state, { type: 'tick' });
    expect(state).toMatchObject({ updating: 0, dueIn: 4, value: 0, upkeepTicks: 2 });
    const external = apply(create(198, 4), { type: 'choose', kind: 'external' });
    expect(apply(external, { type: 'update' })).toBe(external);
    const billed = apply(external, { type: 'tick' });
    expect(billed).toMatchObject({ value: 6, fees: 2 });
    expect(summarizeHarness(billed).netValue).toBe(4);
  });
  it('未選択のtick、二重選択、保守中の別操作、期末は無消費で拒否する', () => {
    const initial = create(198, 4);
    expect(apply(initial, { type: 'tick' })).toBe(initial);
    expect(apply(initial, { type: 'update' })).toBe(initial);
    const chosen = apply(initial, { type: 'choose', kind: 'inhouse' });
    expect(apply(chosen, { type: 'choose', kind: 'external' })).toBe(chosen);
    const ended = { ...initial, tick: initial.horizon };
    expect(apply(ended, { type: 'tick' })).toBe(ended);
    expect(apply(ended, { type: 'choose', kind: 'external' })).toBe(ended);
  });
  it('猶予内は保守せず内製が有利で、期限を超えると到来時の更新が外部利用を上回る', () => {
    const rows = compareHarnessStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const net = (horizon: number, strategy: string) =>
      rows.find((row) => row.horizon === horizon && row.strategy === strategy)!.result.netValue;
    expect([net(4, 'external'), net(4, 'skip'), net(4, 'on-time'), net(4, 'early')]).toEqual([
      16, 24, 24, 12,
    ]);
    expect([net(10, 'external'), net(10, 'skip'), net(10, 'on-time'), net(10, 'early')]).toEqual([
      40, 36, 48, 32,
    ]);
    const maintained = rows.find((row) => row.horizon === 10 && row.strategy === 'on-time')!;
    expect(maintained.result).toMatchObject({
      freshTicks: 8,
      staleTicks: 0,
      upkeepTicks: 2,
      fees: 0,
    });
    const skipped = rows.find((row) => row.horizon === 10 && row.strategy === 'skip')!;
    expect(skipped.result.staleTicks).toBe(6);
  });
  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareHarnessStrategies(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseHarnessAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeHarness(live)).toEqual(row.result);
    }
  });
});

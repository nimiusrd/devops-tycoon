import { describe, expect, it } from 'vitest';
import {
  applyProcedureInput as apply,
  chooseProcedureAction,
  compareProcedureStrategies,
  createProcedurePrototype as create,
  summarizeProcedure,
  viewProcedure,
} from './emergencyProcedure';
import comparison from '../../docs/prototypes/emergency-procedure-comparison.json';

describe('RI-176 予約した非常手順', () => {
  it('予約集中力は通常介入から分かれ、二重に消費されない', () => {
    const armed = apply(create('RI-176', 'calm'), { type: 'reserve' });
    expect(armed).toMatchObject({ availableFocus: 4, reservedFocus: 2, armed: true, tick: 0 });
    expect(apply(armed, { type: 'reserve' })).toBe(armed);
    const shipped = apply(armed, { type: 'tick', manual: 'ship' });
    expect(shipped).toMatchObject({
      availableFocus: 2,
      reservedFocus: 2,
      availableSpent: 2,
      reservedSpent: 0,
      shippedValue: 9,
    });
    const locked = { ...armed, availableFocus: 0 };
    const skipped = apply(locked, { type: 'tick', manual: 'ship' });
    expect(skipped.reservedFocus).toBe(2);
    expect(skipped.shippedValue).toBe(0);
    expect(skipped.availableSpent).toBe(armed.availableSpent);
  });
  it('条件成立で一度だけ先に発動し、対象なしは保留して解除できる', () => {
    let state = apply(create('RI-176', 'crisis'), { type: 'reserve' });
    state.arrivals[5] = 1;
    state = apply(state, { type: 'tick' });
    state = apply(state, { type: 'tick', manual: 'firefight' });
    expect(state.resolutions[1]).toBe('t2:arrive+2,auto,manual:firefight,loss:0');
    expect(state).toMatchObject({
      fired: true,
      firedTick: 2,
      incidents: 0,
      reservedSpent: 2,
      armed: false,
    });
    state = apply(apply(apply(state, { type: 'tick' }), { type: 'tick' }), { type: 'tick' });
    expect(state).toMatchObject({ tick: 5, firedTick: 2, incidents: 1, reservedSpent: 2 });
    expect(state.resolutions[state.resolutions.length - 1]).toContain('auto:skip');
    const blind = apply(apply(create('RI-176', 'untargetable'), { type: 'reserve' }), {
      type: 'tick',
    });
    const held = apply(blind, { type: 'tick' });
    expect(held).toMatchObject({ held: true, fired: false, reservedFocus: 2, incidents: 2 });
    expect(held.resolutions[held.resolutions.length - 1]).toContain('auto:hold');
    const refunded = apply(held, { type: 'cancel' });
    expect(refunded).toMatchObject({
      availableFocus: held.availableFocus + 2,
      reservedFocus: 0,
      armed: false,
      held: false,
    });
    expect(apply(state, { type: 'cancel' })).toBe(state);
    const planned = apply(apply(create('RI-176', 'calm'), { type: 'reserve' }), { type: 'cancel' });
    expect(planned).toMatchObject({ availableFocus: 6, reservedFocus: 0, armed: false, tick: 0 });
    const waiting = apply(apply(create('RI-176', 'calm'), { type: 'reserve' }), { type: 'tick' });
    expect(apply(waiting, { type: 'cancel' })).toBe(waiting);
  });
  it('閲覧では発火せず、資源不足・再武装・期末は無消費で拒否する', () => {
    const initial = create('RI-176', 'crisis');
    const before = structuredClone(initial);
    for (let i = 0; i < 30; i++) viewProcedure(initial);
    expect(initial).toEqual(before);
    expect(viewProcedure(initial)).toMatchObject({ fired: false, firedTick: null, incidents: 0 });
    const poor = { ...initial, availableFocus: 1 };
    expect(apply(poor, { type: 'reserve' })).toBe(poor);
    const ended = { ...initial, tick: initial.horizon };
    expect(apply(ended, { type: 'tick', manual: 'firefight' })).toBe(ended);
    expect(apply(ended, { type: 'reserve' })).toBe(ended);
    expect(apply(ended, { type: 'cancel' })).toBe(ended);
  });
  it('平穏は予約見送り、炎上は同時解消が有利で、対象なしの解除は出荷を戻す', () => {
    const rows = compareProcedureStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const net = (scenario: string, strategy: string) =>
      rows.find((row) => row.scenario === scenario && row.strategy === strategy)!.result.netValue;
    expect([net('calm', 'react'), net('calm', 'reserve')]).toEqual([18, 9]);
    expect([net('crisis', 'react'), net('crisis', 'reserve')]).toEqual([4, 9]);
    expect([net('untargetable', 'reserve'), net('untargetable', 'refund')]).toEqual([-32, -23]);
    const crisis = rows.find((row) => row.scenario === 'crisis' && row.strategy === 'reserve')!;
    expect(crisis.result.resolutions[1]).toBe('t2:arrive+2,auto,manual:firefight,loss:0');
    expect(crisis.result.firedTick).toBe(2);
    const calm = rows.find((row) => row.scenario === 'calm' && row.strategy === 'reserve')!;
    expect(calm.result).toMatchObject({
      fired: false,
      reservedFocus: 2,
      incidentLoss: 0,
      shippedValue: 9,
    });
  });
  it('全入力の再生と毎入力JSON保存再開が一致し、口座合計が崩れない', () => {
    for (const row of compareProcedureStrategies(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
        expect(chooseProcedureAction(previous, row.strategy)).toEqual(input);
        expect(
          live.availableFocus + live.reservedFocus + live.availableSpent + live.reservedSpent,
        ).toBe(6);
      }
      expect(summarizeProcedure(live)).toEqual(row.result);
      const again = row.inputs.reduce((state, input) => apply(state, input), row.initial);
      expect(again).toEqual(live);
    }
  });
});

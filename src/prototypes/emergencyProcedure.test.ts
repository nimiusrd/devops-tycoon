import { describe, expect, it } from 'vitest';
import {
  applyProcedureInput as apply,
  baselineProcedureRules,
  chooseProcedureAction,
  compareProcedureFactorReversals,
  compareProcedureStrategies,
  createProcedurePrototype as create,
  summarizeProcedure,
  viewProcedure,
  type ProcedureRules,
} from './emergencyProcedure';
import comparison from '../../docs/prototypes/emergency-procedure-comparison.json';
import factors from '../../docs/prototypes/emergency-procedure-factor-comparison.json';

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

function changedKeys(rules: ProcedureRules): (keyof ProcedureRules)[] {
  return (Object.keys(baselineProcedureRules) as (keyof ProcedureRules)[]).filter(
    (key) => rules[key] !== baselineProcedureRules[key],
  );
}

describe('RI-176 要因の反転', () => {
  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareProcedureFactorReversals();
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 'RI-176',
      horizon: 6,
      focus: 6,
      manualCost: 2,
      shipValue: 9,
      lossPerIncident: 5,
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    });
    const nets = (axis: keyof typeof data.sweeps) =>
      data.sweeps[axis].map((item) => [
        item.parameter,
        item.scenarios.map((scenario) => [
          scenario.scenario,
          scenario.manual.result.netValue,
          scenario.reserved.result.netValue,
          scenario.preference,
        ]),
      ]);
    expect(nets('reserveAmount')).toEqual([
      [
        '0',
        [
          ['calm', 18, 18, 'tie'],
          ['crisis', 4, 9, 'reserved'],
          ['untargetable', -23, -23, 'tie'],
        ],
      ],
      [
        '1',
        [
          ['calm', 18, 3, 'manual'],
          ['crisis', 4, 9, 'reserved'],
          ['untargetable', -23, -32, 'manual'],
        ],
      ],
      [
        '2',
        [
          ['calm', 18, 9, 'manual'],
          ['crisis', 4, 9, 'reserved'],
          ['untargetable', -23, -32, 'manual'],
        ],
      ],
      [
        '3',
        [
          ['calm', 18, -6, 'manual'],
          ['crisis', 4, -16, 'manual'],
          ['untargetable', -23, -41, 'manual'],
        ],
      ],
      [
        '4',
        [
          ['calm', 18, 0, 'manual'],
          ['crisis', 4, 0, 'manual'],
          ['untargetable', -23, -41, 'manual'],
        ],
      ],
      [
        '5',
        [
          ['calm', 18, -15, 'manual'],
          ['crisis', 4, -25, 'manual'],
          ['untargetable', -23, -50, 'manual'],
        ],
      ],
      [
        '6',
        [
          ['calm', 18, -15, 'manual'],
          ['crisis', 4, -25, 'manual'],
          ['untargetable', -23, -50, 'manual'],
        ],
      ],
    ]);
    expect(nets('incidentThreshold')).toEqual([
      [
        '1',
        [
          ['calm', 18, 9, 'manual'],
          ['crisis', 4, 9, 'reserved'],
          ['untargetable', -23, -32, 'manual'],
        ],
      ],
      [
        '2',
        [
          ['calm', 18, 9, 'manual'],
          ['crisis', 4, 9, 'reserved'],
          ['untargetable', -23, -32, 'manual'],
        ],
      ],
      [
        '3',
        [
          ['calm', 18, 9, 'manual'],
          ['crisis', 4, -16, 'manual'],
          ['untargetable', -23, -32, 'manual'],
        ],
      ],
      [
        '4',
        [
          ['calm', 18, 9, 'manual'],
          ['crisis', 4, -16, 'manual'],
          ['untargetable', -23, -32, 'manual'],
        ],
      ],
    ]);
    expect(nets('resolveOrder')).toEqual([
      [
        'auto-first',
        [
          ['calm', 18, 9, 'manual'],
          ['crisis', 4, 9, 'reserved'],
          ['untargetable', -23, -32, 'manual'],
        ],
      ],
      [
        'manual-first',
        [
          ['calm', 18, 9, 'manual'],
          ['crisis', 4, -16, 'manual'],
          ['untargetable', -23, -32, 'manual'],
        ],
      ],
    ]);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.scenario,
        item.before.parameter,
        item.before.preference,
        item.after.parameter,
        item.after.preference,
      ]),
    ).toEqual([
      ['reserveAmount', 'calm', '0', 'tie', '1', 'manual'],
      ['reserveAmount', 'untargetable', '0', 'tie', '1', 'manual'],
      ['reserveAmount', 'crisis', '2', 'reserved', '3', 'manual'],
      ['incidentThreshold', 'crisis', '2', 'reserved', '3', 'manual'],
      ['resolveOrder', 'crisis', 'auto-first', 'reserved', 'manual-first', 'manual'],
    ]);
  });

  it('基準行は初回の手動と予約と一致し、動かした規則は一つである', () => {
    const data = compareProcedureFactorReversals();
    const first = compareProcedureStrategies(comparison.seed);
    for (const point of [
      data.sweeps.reserveAmount.find((item) => item.parameter === '2'),
      data.sweeps.incidentThreshold.find((item) => item.parameter === '2'),
      data.sweeps.resolveOrder.find((item) => item.parameter === 'auto-first'),
    ]) {
      if (!point) throw new Error('baseline');
      expect(changedKeys(point.rules)).toEqual([]);
      for (const scenario of point.scenarios) {
        const reserved = first.find(
          (row) => row.scenario === scenario.scenario && row.strategy === 'reserve',
        );
        if (!reserved) throw new Error('first reserve');
        expect(scenario.reserved.inputs).toEqual(reserved.inputs);
        expect(scenario.reserved.result).toEqual(reserved.result);
        const manual = first.find(
          (row) => row.scenario === scenario.scenario && row.strategy === 'react',
        );
        if (scenario.scenario === 'untargetable') {
          expect(manual).toBeUndefined();
          continue;
        }
        if (!manual) throw new Error('first manual');
        expect(scenario.manual.inputs).toEqual(manual.inputs);
        expect(scenario.manual.result).toEqual(manual.result);
      }
    }
    expect(first.some((row) => row.strategy === 'refund')).toBe(true);
    const only: Record<string, keyof ProcedureRules> = {
      reserveAmount: 'reserveAmount',
      incidentThreshold: 'incidentThreshold',
      resolveOrder: 'resolveOrder',
    };
    for (const [axis, key] of Object.entries(only)) {
      for (const item of data.sweeps[axis as keyof typeof data.sweeps]) {
        expect(changedKeys(item.rules).every((name) => name === key)).toBe(true);
        for (const scenario of item.scenarios) {
          expect(scenario.manual.result.netValue).toBe(
            scenario.scenario === 'calm' ? 18 : scenario.scenario === 'crisis' ? 4 : -23,
          );
          expect(scenario.manual.inputs.some((input) => input.type === 'cancel')).toBe(false);
          expect(scenario.reserved.inputs.some((input) => input.type === 'cancel')).toBe(false);
        }
      }
    }
    const crisis = (axis: keyof typeof data.sweeps, parameter: string) =>
      data.sweeps[axis]
        .find((item) => item.parameter === parameter)
        ?.scenarios.find((item) => item.scenario === 'crisis');
    const autoFirst = crisis('resolveOrder', 'auto-first');
    const manualFirst = crisis('resolveOrder', 'manual-first');
    expect(manualFirst?.reserved.inputs).toEqual(autoFirst?.reserved.inputs);
    expect(autoFirst?.reserved.result.resolutions[1]).toBe(
      't2:arrive+2,auto,manual:firefight,loss:0',
    );
    expect(manualFirst?.reserved.result.resolutions[1]).toBe(
      't2:arrive+2,manual:firefight,auto:skip,loss:5',
    );
    const thresholdTwo = crisis('incidentThreshold', '2');
    const thresholdThree = crisis('incidentThreshold', '3');
    expect(thresholdThree?.reserved.inputs).toEqual(thresholdTwo?.reserved.inputs);
    expect(thresholdThree?.reserved.result).toMatchObject({
      fired: false,
      reservedFocus: 2,
      netValue: -16,
    });
    expect(crisis('reserveAmount', '3')?.reserved.result.resolutions[1]).toBe(
      't2:arrive+2,auto,loss:5',
    );
    expect(crisis('reserveAmount', '4')?.reserved.result).toMatchObject({
      fired: true,
      shippedValue: 0,
      incidentLoss: 0,
      netValue: 0,
    });
    expect(crisis('reserveAmount', '4')?.preference).toBe('manual');
    const calmZero = data.sweeps.reserveAmount
      .find((item) => item.parameter === '0')
      ?.scenarios.find((item) => item.scenario === 'calm');
    expect(calmZero?.reserved.result).toMatchObject({
      fired: false,
      shippedValue: 18,
      reservedSpent: 0,
      netValue: 18,
    });
  });

  it('要因比較の入力を再生すると差引が一致し、口座合計が崩れない', () => {
    const data = compareProcedureFactorReversals();
    for (const item of Object.values(data.sweeps).flat()) {
      for (const scenario of item.scenarios) {
        for (const strategy of ['manual', 'reserved'] as const) {
          const run = scenario[strategy];
          let state = create(data.conditions.seed, scenario.scenario);
          const snapshot = structuredClone(state);
          const chosen = strategy === 'manual' ? 'react' : 'reserve';
          for (const input of run.inputs) {
            const previous = state;
            const before = structuredClone(state);
            expect(chooseProcedureAction(state, chosen, item.rules)).toEqual(input);
            state = apply(state, input, item.rules);
            const restored = apply(JSON.parse(JSON.stringify(before)), input, item.rules);
            expect(previous).toEqual(before);
            expect(restored).toEqual(state);
            expect(
              state.availableFocus +
                state.reservedFocus +
                state.availableSpent +
                state.reservedSpent,
            ).toBe(data.conditions.focus);
          }
          expect(snapshot.tick).toBe(0);
          expect(summarizeProcedure(state)).toEqual(run.result);
          expect(state.inputs).toEqual(run.inputs);
          expect(apply(state, { type: 'tick', manual: 'ship' }, item.rules)).toBe(state);
        }
      }
    }
  });
});

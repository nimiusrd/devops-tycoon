import { describe, expect, it } from 'vitest';
import {
  applyHarnessInput as apply,
  baselineHarnessRules,
  chooseHarnessAction,
  compareHarnessFactorReversals,
  compareHarnessStrategies,
  createHarnessPrototype as create,
  summarizeHarness,
  viewHarness,
} from './harnessUpkeep';
import comparison from '../../docs/prototypes/harness-upkeep-comparison.json';
import factors from '../../docs/prototypes/harness-upkeep-factor-comparison.json';

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

describe('RI-198 要因の反転', () => {
  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareHarnessFactorReversals();
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 198,
      horizons: [4, 10],
      freshValue: 6,
      externalFee: 2,
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    });
    const nets = (axis: keyof typeof data.sweeps) =>
      data.sweeps[axis].map((item) => [
        item.parameter,
        ...item.horizons.flatMap((horizon) => [
          horizon.maintain.result.netValue,
          horizon.skip.result.netValue,
          horizon.preference,
        ]),
      ]);
    expect(nets('grace')).toEqual([
      ['1', 12, 12, 'tie', 24, 24, 'tie'],
      ['2', 12, 16, 'skip', 36, 28, 'maintain'],
      ['3', 18, 20, 'skip', 36, 32, 'maintain'],
      ['4', 24, 24, 'tie', 48, 36, 'maintain'],
      ['5', 24, 24, 'tie', 48, 40, 'maintain'],
      ['6', 24, 24, 'tie', 48, 44, 'maintain'],
      ['7', 24, 24, 'tie', 48, 48, 'tie'],
      ['8', 24, 24, 'tie', 48, 52, 'skip'],
      ['9', 24, 24, 'tie', 54, 56, 'skip'],
      ['10', 24, 24, 'tie', 60, 60, 'tie'],
    ]);
    expect(nets('updateTicks')).toEqual([
      ['1', 24, 24, 'tie', 48, 36, 'maintain'],
      ['2', 24, 24, 'tie', 48, 36, 'maintain'],
      ['3', 24, 24, 'tie', 42, 36, 'maintain'],
      ['4', 24, 24, 'tie', 36, 36, 'tie'],
      ['5', 24, 24, 'tie', 30, 36, 'skip'],
      ['6', 24, 24, 'tie', 24, 36, 'skip'],
    ]);
    expect(nets('staleValue')).toEqual([
      ['0', 24, 24, 'tie', 48, 24, 'maintain'],
      ['1', 24, 24, 'tie', 48, 30, 'maintain'],
      ['2', 24, 24, 'tie', 48, 36, 'maintain'],
      ['3', 24, 24, 'tie', 48, 42, 'maintain'],
      ['4', 24, 24, 'tie', 48, 48, 'tie'],
      ['5', 24, 24, 'tie', 48, 54, 'skip'],
      ['6', 24, 24, 'tie', 48, 60, 'skip'],
    ]);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.horizon,
        item.before.parameter,
        item.before.preference,
        item.after.parameter,
        item.after.preference,
      ]),
    ).toEqual([
      ['grace', 4, '1', 'tie', '2', 'skip'],
      ['grace', 4, '3', 'skip', '4', 'tie'],
      ['grace', 10, '1', 'tie', '2', 'maintain'],
      ['grace', 10, '6', 'maintain', '7', 'tie'],
      ['grace', 10, '7', 'tie', '8', 'skip'],
      ['grace', 10, '9', 'skip', '10', 'tie'],
      ['updateTicks', 10, '3', 'maintain', '4', 'tie'],
      ['updateTicks', 10, '4', 'tie', '5', 'skip'],
      ['staleValue', 10, '3', 'maintain', '4', 'tie'],
      ['staleValue', 10, '4', 'tie', '5', 'skip'],
    ]);
  });

  it('基準行は初回の到来時更新と見送りに一致し、動かした規則は一つである', () => {
    const data = compareHarnessFactorReversals();
    const first = compareHarnessStrategies(comparison.seed);
    const baselines = [
      data.sweeps.grace.find((item) => item.parameter === '4'),
      data.sweeps.updateTicks.find((item) => item.parameter === '2'),
      data.sweeps.staleValue.find((item) => item.parameter === '2'),
    ];
    for (const point of baselines) {
      if (!point) throw new Error('baseline');
      expect(point.sameAsFirstComparison).toBe(true);
      expect(point.rules).toEqual(baselineHarnessRules);
      for (const horizon of [4, 10]) {
        const row = point.horizons.find((item) => item.horizon === horizon);
        if (!row) throw new Error('horizon');
        for (const [decision, strategy] of [
          ['maintain', 'on-time'],
          ['skip', 'skip'],
        ] as const) {
          const original = first.find(
            (item) => item.horizon === horizon && item.strategy === strategy,
          );
          if (!original) throw new Error('first');
          expect(row[decision].inputs).toEqual(original.inputs);
          expect(row[decision].result).toEqual(original.result);
        }
      }
    }
    expect(first.some((row) => row.strategy === 'external')).toBe(true);
    expect(first.some((row) => row.strategy === 'early')).toBe(true);
    expect(Object.keys(data.sweeps)).toEqual(['grace', 'updateTicks', 'staleValue']);
    for (const item of data.sweeps.grace) {
      expect(item.rules).toMatchObject({
        updateTicks: 2,
        freshValue: 6,
        staleValue: 2,
        externalFee: 2,
      });
      expect(item.rules.grace).toBe(Number(item.parameter));
      expect(item.sameAsFirstComparison).toBe(item.parameter === '4');
    }
    for (const item of data.sweeps.updateTicks) {
      expect(item.rules).toMatchObject({ grace: 4, freshValue: 6, staleValue: 2, externalFee: 2 });
      expect(item.rules.updateTicks).toBe(Number(item.parameter));
      expect(item.sameAsFirstComparison).toBe(item.parameter === '2');
      const long = item.horizons.find((row) => row.horizon === 10);
      expect(long?.skip.result.netValue).toBe(36);
    }
    for (const item of data.sweeps.staleValue) {
      expect(item.rules).toMatchObject({ grace: 4, updateTicks: 2, freshValue: 6, externalFee: 2 });
      expect(item.rules.staleValue).toBe(Number(item.parameter));
      expect(item.sameAsFirstComparison).toBe(item.parameter === '2');
      const long = item.horizons.find((row) => row.horizon === 10);
      expect(long?.maintain.result.netValue).toBe(48);
    }
    for (const item of [...data.sweeps.updateTicks, ...data.sweeps.staleValue]) {
      const short = item.horizons.find((row) => row.horizon === 4);
      expect(short?.preference).toBe('tie');
      expect(short?.maintain.inputs).toEqual(short?.skip.inputs);
      expect(short?.maintain.inputs.some((input) => input.type === 'update')).toBe(false);
    }
    const shortGrace = data.sweeps.grace.find((item) => item.parameter === '1');
    const shortTie = shortGrace?.horizons.find((row) => row.horizon === 4);
    expect(shortTie?.preference).toBe('tie');
    expect(shortTie?.maintain.inputs).not.toEqual(shortTie?.skip.inputs);
    expect(shortTie?.maintain.result).toMatchObject({
      freshTicks: 2,
      staleTicks: 0,
      upkeepTicks: 2,
    });
    expect(shortTie?.skip.result).toMatchObject({ freshTicks: 1, staleTicks: 3, upkeepTicks: 0 });
    const shortRules = { ...baselineHarnessRules, grace: 1 };
    let shown = apply(create(198, 2, shortRules), { type: 'choose', kind: 'inhouse' }, shortRules);
    expect(viewHarness(shown, shortRules)).toMatchObject({ dueIn: 1, effect: 6, grace: 1 });
    shown = apply(shown, { type: 'tick' }, shortRules);
    expect(viewHarness(shown, shortRules)).toMatchObject({ dueIn: 0, effect: 2, grace: 1 });
    expect(viewHarness(create(198, 4)).grace).toBe(4);
  });

  it('要因比較の入力を再生すると差引が一致し、期末では同じ状態を返す', () => {
    const data = compareHarnessFactorReversals();
    for (const item of Object.values(data.sweeps).flat()) {
      for (const horizon of item.horizons) {
        for (const decision of ['maintain', 'skip'] as const) {
          const strategy = decision === 'maintain' ? 'on-time' : 'skip';
          const run = horizon[decision];
          let state = create(data.conditions.seed, horizon.horizon, item.rules);
          const snapshot = structuredClone(state);
          for (const input of run.inputs) {
            const previous = state;
            const before = structuredClone(state);
            expect(chooseHarnessAction(state, strategy, item.rules)).toEqual(input);
            state = apply(state, input, item.rules);
            const restored = apply(JSON.parse(JSON.stringify(before)), input, item.rules);
            expect(previous).toEqual(before);
            expect(restored).toEqual(state);
          }
          expect(snapshot.tick).toBe(0);
          expect(snapshot.inputs).toEqual([]);
          expect(summarizeHarness(state)).toEqual(run.result);
          expect(state.inputs).toEqual(run.inputs);
          expect(state.fees).toBe(0);
          expect(apply(state, { type: 'tick' }, item.rules)).toBe(state);
        }
      }
    }
  });
});

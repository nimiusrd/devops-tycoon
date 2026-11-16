import { describe, expect, it } from 'vitest';
import {
  applyUncertaintyInput as apply,
  chooseUncertaintyAction,
  compareUncertaintyFactorReversals,
  compareUncertaintyPolicies,
  createUncertaintyPrototype as create,
  summarizeUncertainty,
  viewUncertainty,
} from './uncertaintyCheck';
import comparison from '../../docs/prototypes/uncertainty-check-comparison.json';
import factors from '../../docs/prototypes/uncertainty-check-factor-comparison.json';

describe('RI-196 不確実な出力の確認', () => {
  it('兆候は確認対象だけで、同じseedの表示を繰り返しても実リスクを出さない', () => {
    const first = create(196, 5, 'thick');
    expect(create(196, 5, 'thick')).toEqual(first);
    expect(create(197, 5, 'thick').generation).not.toBe(first.generation);
    const before = structuredClone(first);
    const seen = viewUncertainty(first);
    for (let i = 0; i < 10; i++) expect(viewUncertainty(first)).toEqual(seen);
    expect(first).toEqual(before);
    expect(JSON.stringify(seen)).not.toContain('actualRisk');
    expect(seen.tasks.map((task) => [task.id, task.signal, task.riskReduced])).toEqual([
      ['alarm', 'uncertain', null],
      ['flagged', 'uncertain', null],
      ['miss', 'clear', null],
    ]);
    expect(viewUncertainty(create(197, 10, 'thin')).tasks).toEqual(seen.tasks);
    expect(first.tasks.find((task) => task.id === 'miss')!.actualRisk).toBe(4);
    expect(first.tasks.find((task) => task.id === 'alarm')!.actualRisk).toBe(0);
  });
  it('誤警報は時間だけを記録し、見落としは未確認出荷のあとでリスクが残る', () => {
    let alarm = apply(create(196, 8, 'thick'), { type: 'check', id: 'alarm' });
    alarm = apply(alarm, { type: 'tick' });
    expect(alarm.tasks[0]).toMatchObject({
      checkTicksSpent: 1,
      riskReduced: 0,
      shipped: false,
    });
    expect(summarizeUncertainty(alarm).shippedValue).toBe(0);
    const partial = apply(apply(create(196, 8, 'thin'), { type: 'check', id: 'flagged' }), {
      type: 'tick',
    });
    expect(partial.tasks[1]).toMatchObject({ checkTicksSpent: 1, riskReduced: null });
    let missed = apply(create(196, 8, 'thick'), { type: 'ship', id: 'miss' });
    expect(viewUncertainty(missed).tasks[2]!.riskReduced).toBeNull();
    missed = apply(missed, { type: 'tick' });
    expect(summarizeUncertainty(missed).tasks[2]).toMatchObject({
      shipped: true,
      realizedRisk: 4,
      riskReduced: null,
      checkTicksSpent: 0,
    });
    let checked = apply(create(196, 8, 'thick'), { type: 'check', id: 'miss' });
    checked = apply(apply(checked, { type: 'tick' }), { type: 'ship', id: 'miss' });
    checked = apply(checked, { type: 'tick' });
    expect(summarizeUncertainty(checked).tasks[2]).toMatchObject({
      shipped: true,
      realizedRisk: 0,
      riskReduced: 4,
      checkTicksSpent: 1,
    });
  });
  it('作業中・確認済み・存在しない対象・期末は無消費で拒否する', () => {
    const initial = create(196, 5, 'thin');
    expect(apply(initial, { type: 'tick' })).toBe(initial);
    expect(apply(initial, { type: 'check', id: 'missing' })).toBe(initial);
    const busy = apply(initial, { type: 'check', id: 'alarm' });
    expect(apply(busy, { type: 'ship', id: 'flagged' })).toBe(busy);
    expect(apply(busy, { type: 'check', id: 'flagged' })).toBe(busy);
    let done = apply(apply(create(196, 5, 'thick'), { type: 'check', id: 'alarm' }), {
      type: 'tick',
    });
    expect(apply(done, { type: 'check', id: 'alarm' })).toBe(done);
    done = apply(apply(done, { type: 'ship', id: 'alarm' }), { type: 'tick' });
    expect(apply(done, { type: 'ship', id: 'alarm' })).toBe(done);
    const ended = { ...initial, tick: initial.horizon };
    expect(apply(ended, { type: 'tick' })).toBe(ended);
    expect(apply(ended, { type: 'ship', id: 'alarm' })).toBe(ended);
  });
  it('検証が薄く期末が短いときは未確認出荷、厚い検証の長い期末は全件確認が有利', () => {
    const rows = compareUncertaintyPolicies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const net = (verifier: string, horizon: number, policy: string) =>
      rows.find(
        (row) => row.verifier === verifier && row.horizon === horizon && row.policy === policy,
      )!.result.netValue;
    expect([net('thin', 5, 'ship'), net('thin', 5, 'flagged'), net('thin', 5, 'all')]).toEqual([
      20, -9, -9,
    ]);
    expect([net('thin', 10, 'ship'), net('thin', 10, 'flagged'), net('thin', 10, 'all')]).toEqual([
      20, 26, 4,
    ]);
    expect([net('thick', 5, 'ship'), net('thick', 5, 'flagged'), net('thick', 5, 'all')]).toEqual([
      20, 26, 17,
    ]);
    expect([
      net('thick', 10, 'ship'),
      net('thick', 10, 'flagged'),
      net('thick', 10, 'all'),
    ]).toEqual([20, 26, 30]);
    const thickShort = rows.find(
      (row) => row.verifier === 'thick' && row.horizon === 5 && row.policy === 'flagged',
    )!;
    expect(thickShort.result.tasks.find((task) => task.id === 'alarm')).toMatchObject({
      falseAlarm: true,
      realizedRisk: 0,
    });
    expect(thickShort.result.tasks.find((task) => task.id === 'miss')).toMatchObject({
      missedSignal: true,
      realizedRisk: 4,
      checkTicksSpent: 0,
    });
  });
  it('全入力の再生と毎入力JSON保存再開が一致し、方針は兆候だけを見る', () => {
    for (const row of compareUncertaintyPolicies(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseUncertaintyAction(previous, row.policy)).toEqual(input);
        if (input.type === 'check' && row.policy === 'flagged') {
          expect(previous.tasks.find((task) => task.id === input.id)!.signal).toBe('uncertain');
        }
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeUncertainty(live)).toEqual(row.result);
    }
  });
});

function changedSignals(
  left: { alarm: string; flagged: string; miss: string },
  right: { alarm: string; flagged: string; miss: string },
) {
  return (['alarm', 'flagged', 'miss'] as const).filter((id) => left[id] !== right[id]);
}

describe('RI-196 要因の反転', () => {
  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareUncertaintyFactorReversals();
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 196,
      horizons: [5, 10],
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      allPolicyRecomputed: false,
      productionAdoption: false,
    });
    expect(comparison.results.filter((row) => row.policy === 'all')).toHaveLength(4);
    const nets = (axis: keyof typeof data.sweeps) =>
      data.sweeps[axis].map((item) => [
        item.parameter,
        item.cells.map((cell) => [
          cell.resource,
          cell.horizon,
          cell.ship.result.netValue,
          cell.check.result.netValue,
          cell.preference,
        ]),
      ]);
    expect(nets('hitRate')).toEqual([
      [
        '0/3',
        [
          ['thin', 5, 20, 11, 'ship'],
          ['thin', 10, 20, 20, 'tie'],
          ['thick', 5, 20, 20, 'tie'],
          ['thick', 10, 20, 20, 'tie'],
        ],
      ],
      [
        '1/3',
        [
          ['thin', 5, 20, -9, 'ship'],
          ['thin', 10, 20, 26, 'check'],
          ['thick', 5, 20, 26, 'check'],
          ['thick', 10, 20, 26, 'check'],
        ],
      ],
      [
        '2/3',
        [
          ['thin', 5, 20, 17, 'ship'],
          ['thin', 10, 20, 26, 'check'],
          ['thick', 5, 20, 26, 'check'],
          ['thick', 10, 20, 26, 'check'],
        ],
      ],
      [
        '3/3',
        [
          ['thin', 5, 20, -9, 'ship'],
          ['thin', 10, 20, 30, 'check'],
          ['thick', 5, 20, 30, 'check'],
          ['thick', 10, 20, 30, 'check'],
        ],
      ],
    ]);
    expect(nets('checkTicks')).toEqual([
      [
        '1',
        [
          ['ticks', 5, 20, 26, 'check'],
          ['ticks', 10, 20, 26, 'check'],
        ],
      ],
      [
        '2',
        [
          ['ticks', 5, 20, 4, 'ship'],
          ['ticks', 10, 20, 26, 'check'],
        ],
      ],
      [
        '3',
        [
          ['ticks', 5, 20, -9, 'ship'],
          ['ticks', 10, 20, 26, 'check'],
        ],
      ],
      [
        '4',
        [
          ['ticks', 5, 20, -9, 'ship'],
          ['ticks', 10, 20, 17, 'ship'],
        ],
      ],
      [
        '5',
        [
          ['ticks', 5, 20, -9, 'ship'],
          ['ticks', 10, 20, -9, 'ship'],
        ],
      ],
    ]);
    expect(nets('unfinishedPenalty')).toEqual([
      [
        '0',
        [
          ['thin', 5, 20, 0, 'ship'],
          ['thin', 10, 20, 26, 'check'],
          ['thick', 5, 20, 26, 'check'],
          ['thick', 10, 20, 26, 'check'],
        ],
      ],
      [
        '1',
        [
          ['thin', 5, 20, -3, 'ship'],
          ['thin', 10, 20, 26, 'check'],
          ['thick', 5, 20, 26, 'check'],
          ['thick', 10, 20, 26, 'check'],
        ],
      ],
      [
        '3',
        [
          ['thin', 5, 20, -9, 'ship'],
          ['thin', 10, 20, 26, 'check'],
          ['thick', 5, 20, 26, 'check'],
          ['thick', 10, 20, 26, 'check'],
        ],
      ],
      [
        '6',
        [
          ['thin', 5, 20, -18, 'ship'],
          ['thin', 10, 20, 26, 'check'],
          ['thick', 5, 20, 26, 'check'],
          ['thick', 10, 20, 26, 'check'],
        ],
      ],
    ]);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.resource,
        item.horizon,
        item.before.parameter,
        item.before.preference,
        item.before.ship,
        item.before.check,
        item.after.parameter,
        item.after.preference,
        item.after.ship,
        item.after.check,
      ]),
    ).toEqual([
      ['hitRate', 'thin', 10, '0/3', 'tie', 20, 20, '1/3', 'check', 20, 26],
      ['hitRate', 'thick', 5, '0/3', 'tie', 20, 20, '1/3', 'check', 20, 26],
      ['hitRate', 'thick', 10, '0/3', 'tie', 20, 20, '1/3', 'check', 20, 26],
      ['checkTicks', 'ticks', 5, '1', 'check', 20, 26, '2', 'ship', 20, 4],
      ['checkTicks', 'ticks', 10, '3', 'check', 20, 26, '4', 'ship', 20, 17],
    ]);
    expect(data.reversals.some((item) => item.axis === 'unfinishedPenalty')).toBe(false);
  });

  it('基準行は初回のそのまま出す判断と確認してから出す判断に一致し、動かした要因は一つである', () => {
    const data = compareUncertaintyFactorReversals();
    const first = (verifier: string, horizon: number, policy: string) => {
      const row = comparison.results.find(
        (item) => item.verifier === verifier && item.horizon === horizon && item.policy === policy,
      );
      if (!row) throw new Error(`${verifier}:${horizon}:${policy}`);
      return row;
    };
    const baselineSignals = { alarm: 'uncertain', flagged: 'uncertain', miss: 'clear' };
    for (const point of [
      data.sweeps.hitRate.find((item) => item.parameter === '1/3'),
      data.sweeps.unfinishedPenalty.find((item) => item.parameter === '3'),
    ]) {
      if (!point) throw new Error('baseline');
      expect(point.signals).toEqual(baselineSignals);
      expect(point.hits).toBe(1);
      expect(point.unfinishedPenalty).toBe(3);
      for (const cell of point.cells) {
        expect(cell.resource === 'thin' || cell.resource === 'thick').toBe(true);
        expect(cell.checkTicks).toBe(cell.resource === 'thin' ? 3 : 1);
        const ship = first(cell.resource, cell.horizon, 'ship');
        const flagged = first(cell.resource, cell.horizon, 'flagged');
        expect(cell.ship.inputs).toEqual(ship.inputs);
        expect(cell.ship.result).toEqual(ship.result);
        expect(cell.check.inputs).toEqual(flagged.inputs);
        expect(cell.check.result).toEqual(flagged.result);
      }
    }
    for (const entry of [
      { parameter: '1', verifier: 'thick' },
      { parameter: '3', verifier: 'thin' },
    ] as const) {
      const point = data.sweeps.checkTicks.find((item) => item.parameter === entry.parameter);
      if (!point) throw new Error(entry.parameter);
      expect(point.signals).toEqual(baselineSignals);
      expect(point.unfinishedPenalty).toBe(3);
      for (const cell of point.cells) {
        expect(cell.resource).toBe('ticks');
        expect(cell.checkTicks).toBe(Number(entry.parameter));
        const ship = first(entry.verifier, cell.horizon, 'ship');
        const flagged = first(entry.verifier, cell.horizon, 'flagged');
        expect(cell.ship.inputs).toEqual(ship.inputs);
        expect(cell.ship.result).toEqual(ship.result);
        expect(cell.check.inputs).toEqual(flagged.inputs);
        expect(cell.check.result).toEqual(flagged.result);
      }
    }
    for (const point of data.sweeps.checkTicks.concat(data.sweeps.unfinishedPenalty)) {
      expect(point.signals).toEqual(baselineSignals);
      expect(point.hits).toBe(1);
    }
    for (const point of data.sweeps.hitRate.concat(data.sweeps.checkTicks)) {
      expect(point.unfinishedPenalty).toBe(3);
    }
    for (let index = 1; index < data.sweeps.hitRate.length; index += 1) {
      const before = data.sweeps.hitRate[index - 1];
      const after = data.sweeps.hitRate[index];
      if (!before || !after) throw new Error('hit rate');
      expect(changedSignals(before.signals, after.signals)).toHaveLength(1);
      expect(after.hits).toBe(before.hits + 1);
    }
    const shipInputs = new Map<number, { type: string; id?: string }[]>();
    for (const point of Object.values(data.sweeps).flat()) {
      for (const cell of point.cells) {
        expect(cell.margin).toBe(cell.check.result.netValue - cell.ship.result.netValue);
        expect(cell.ship.result.netValue).toBe(20);
        expect(cell.ship.inputs.every((input) => input.type !== 'check')).toBe(true);
        const seen = shipInputs.get(cell.horizon);
        if (seen) expect(cell.ship.inputs).toEqual(seen);
        else shipInputs.set(cell.horizon, cell.ship.inputs);
      }
    }
  });

  it('要因比較の入力を再生すると差引が一致し、期末では同じ状態を返す', () => {
    const data = compareUncertaintyFactorReversals();
    for (const point of Object.values(data.sweeps).flat()) {
      for (const cell of point.cells) {
        const overrides = {
          checkTicks: cell.checkTicks,
          unfinishedPenalty: point.unfinishedPenalty,
          signals: point.signals,
        };
        const verifier = cell.resource === 'thick' ? 'thick' : 'thin';
        for (const policy of ['ship', 'check'] as const) {
          const run = cell[policy];
          let state = create(data.conditions.seed, cell.horizon, verifier, overrides);
          expect(state.tasks.map((task) => [task.id, task.actualRisk, task.value])).toEqual([
            ['alarm', 0, 10],
            ['flagged', 6, 10],
            ['miss', 4, 10],
          ]);
          expect(state.tasks.map((task) => task.signal)).toEqual([
            point.signals.alarm,
            point.signals.flagged,
            point.signals.miss,
          ]);
          for (const input of run.inputs) {
            const previous = state;
            const before = structuredClone(state);
            expect(
              chooseUncertaintyAction(previous, policy === 'check' ? 'flagged' : 'ship'),
            ).toEqual(input);
            if (input.type === 'check') {
              expect(previous.tasks.find((task) => task.id === input.id)!.signal).toBe('uncertain');
            }
            state = apply(state, input, overrides);
            const restored = apply(JSON.parse(JSON.stringify(before)), input, overrides);
            expect(previous).toEqual(before);
            expect(restored).toEqual(state);
          }
          expect(summarizeUncertainty(state, overrides)).toEqual(run.result);
          expect(state.inputs).toEqual(run.inputs);
          expect(apply(state, { type: 'ship', id: 'alarm' }, overrides)).toBe(state);
        }
      }
    }
  });
});

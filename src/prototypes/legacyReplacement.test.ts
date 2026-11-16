import { describe, expect, it } from 'vitest';
import {
  applyLegacyInput as apply,
  baselineLegacyRules,
  chooseLegacyAction,
  compareLegacyFactorReversals,
  compareLegacyStrategies,
  createLegacyPrototype as create,
  summarizeLegacy,
  type LegacyRules,
} from './legacyReplacement';
import comparison from '../../docs/prototypes/legacy-replacement-comparison.json';
import factors from '../../docs/prototypes/legacy-replacement-factor-comparison.json';

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

function changedKeys(rules: LegacyRules): (keyof LegacyRules)[] {
  return (Object.keys(baselineLegacyRules) as (keyof LegacyRules)[]).filter(
    (key) => rules[key] !== baselineLegacyRules[key],
  );
}

describe('RI-179 要因の反転', () => {
  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareLegacyFactorReversals();
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 'RI-179',
      horizons: [5, 10],
      migrationYield: 0,
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    });
    const nets = (axis: keyof typeof data.sweeps) =>
      data.sweeps[axis].map((item) => [
        item.parameter,
        item.horizons.map((horizon) => [
          horizon.horizon,
          horizon.keep.result.netValue,
          horizon.replace.result.netValue,
          horizon.preference,
        ]),
      ]);
    expect(nets('migrationTicks')).toEqual([
      [
        '1',
        [
          [5, 20, 32, 'replace'],
          [10, 40, 72, 'replace'],
        ],
      ],
      [
        '2',
        [
          [5, 20, 24, 'replace'],
          [10, 40, 64, 'replace'],
        ],
      ],
      [
        '3',
        [
          [5, 20, 16, 'keep'],
          [10, 40, 56, 'replace'],
        ],
      ],
      [
        '4',
        [
          [5, 20, 8, 'keep'],
          [10, 40, 48, 'replace'],
        ],
      ],
      [
        '5',
        [
          [5, 20, 0, 'keep'],
          [10, 40, 40, 'tie'],
        ],
      ],
      [
        '6',
        [
          [5, 20, 0, 'keep'],
          [10, 40, 32, 'keep'],
        ],
      ],
    ]);
    expect(nets('dualBurden')).toEqual([
      [
        '0',
        [
          [5, 20, 16, 'keep'],
          [10, 40, 56, 'replace'],
        ],
      ],
      [
        '2',
        [
          [5, 20, 16, 'keep'],
          [10, 40, 56, 'replace'],
        ],
      ],
      [
        '4',
        [
          [5, 20, 16, 'keep'],
          [10, 40, 56, 'replace'],
        ],
      ],
    ]);
    expect(nets('modernMultiplier')).toEqual([
      [
        '1',
        [
          [5, 20, 8, 'keep'],
          [10, 40, 28, 'keep'],
        ],
      ],
      [
        '1.5',
        [
          [5, 20, 12, 'keep'],
          [10, 40, 42, 'replace'],
        ],
      ],
      [
        '2',
        [
          [5, 20, 16, 'keep'],
          [10, 40, 56, 'replace'],
        ],
      ],
      [
        '2.5',
        [
          [5, 20, 20, 'tie'],
          [10, 40, 70, 'replace'],
        ],
      ],
      [
        '3',
        [
          [5, 20, 24, 'replace'],
          [10, 40, 84, 'replace'],
        ],
      ],
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
      ['migrationTicks', 5, '2', 'replace', '3', 'keep'],
      ['migrationTicks', 10, '4', 'replace', '5', 'tie'],
      ['migrationTicks', 10, '5', 'tie', '6', 'keep'],
      ['modernMultiplier', 10, '1', 'keep', '1.5', 'replace'],
      ['modernMultiplier', 5, '2', 'keep', '2.5', 'tie'],
      ['modernMultiplier', 5, '2.5', 'tie', '3', 'replace'],
    ]);
    expect(data.reversals.some((item) => item.axis === 'dualBurden')).toBe(false);
  });

  it('基準行は初回の残す・置換と一致し、動かした規則は一つである', () => {
    const data = compareLegacyFactorReversals();
    const first = compareLegacyStrategies(comparison.seed);
    for (const point of [
      data.sweeps.migrationTicks.find((item) => item.parameter === '3'),
      data.sweeps.dualBurden.find((item) => item.parameter === '2'),
      data.sweeps.modernMultiplier.find((item) => item.parameter === '2'),
    ]) {
      if (!point) throw new Error('baseline');
      expect(changedKeys(point.rules)).toEqual([]);
      for (const horizon of point.horizons) {
        const ship = first.find(
          (row) => row.horizon === horizon.horizon && row.strategy === 'ship',
        );
        const replaced = first.find(
          (row) => row.horizon === horizon.horizon && row.strategy === 'replace',
        );
        if (!ship || !replaced) throw new Error('first');
        expect(horizon.keep.inputs).toEqual(ship.inputs);
        expect(horizon.keep.result).toEqual(ship.result);
        expect(horizon.replace.inputs).toEqual(replaced.inputs);
        expect(horizon.replace.result).toEqual(replaced.result);
        expect(first.some((row) => row.strategy === 'partial')).toBe(true);
      }
    }
    const only: Record<string, keyof LegacyRules> = {
      migrationTicks: 'migrationTicks',
      dualBurden: 'dualPerTick',
      modernMultiplier: 'modernMultiplier',
    };
    for (const [axis, key] of Object.entries(only)) {
      for (const item of data.sweeps[axis as keyof typeof data.sweeps])
        expect(changedKeys(item.rules).every((name) => name === key)).toBe(true);
    }
    for (const item of data.sweeps.dualBurden)
      expect(item.rules.dualPerTick).toBe(
        baselineLegacyRules.legacyPerTick - Number(item.parameter),
      );
    const unfinished = data.sweeps.migrationTicks.find((item) => item.parameter === '5');
    const short = unfinished?.horizons.find((item) => item.horizon === 5);
    expect(short?.replace.result).toMatchObject({
      mode: 'dual',
      doneTasks: 5,
      modernValue: 0,
      netValue: 0,
    });
    expect(short?.replace.inputs.some((input) => input.type === 'cutover')).toBe(false);
    const finished = data.sweeps.migrationTicks.find((item) => item.parameter === '6');
    const long = finished?.horizons.find((item) => item.horizon === 10);
    expect(long?.replace.inputs.filter((input) => input.type === 'ship')).toHaveLength(4);
    expect(long?.replace.result).toMatchObject({ mode: 'modern', doneTasks: 6, modernValue: 32 });
    const slow = data.sweeps.modernMultiplier.find((item) => item.parameter === '1');
    const fast = data.sweeps.modernMultiplier.find((item) => item.parameter === '3');
    expect(slow?.horizons[1]?.replace.inputs).toEqual(fast?.horizons[1]?.replace.inputs);
    expect(slow?.horizons[1]?.replace.result.modernValue).toBe(28);
    expect(fast?.horizons[1]?.replace.result.modernValue).toBe(84);
  });

  it('二重運用の出荷だけが負担で変わり、移行tickは0のまま', () => {
    for (const dualPerTick of [0, 2, 4]) {
      const rules = { ...baselineLegacyRules, dualPerTick };
      let state = apply(
        apply(create('RI-179', 5, rules), { type: 'start' }, rules),
        {
          type: 'migrate',
        },
        rules,
      );
      expect(state).toMatchObject({ tick: 1, dualValue: 0, legacyValue: 0, modernValue: 0 });
      state = apply(state, { type: 'ship' }, rules);
      expect(state.dualValue).toBe(dualPerTick);
      expect(state.legacyValue).toBe(0);
      expect(state.modernValue).toBe(0);
    }
  });

  it('要因比較の入力を再生すると差引が一致し、期末では同じ状態を返す', () => {
    const data = compareLegacyFactorReversals();
    for (const item of Object.values(data.sweeps).flat()) {
      expect(item.rules.legacyPerTick).toBe(4);
      for (const horizon of item.horizons) {
        for (const strategy of ['keep', 'replace'] as const) {
          const run = horizon[strategy];
          let state = create(data.conditions.seed, horizon.horizon, item.rules);
          const snapshot = structuredClone(state);
          expect(state.tasks).toHaveLength(item.rules.migrationTicks);
          const chosen = strategy === 'keep' ? 'ship' : 'replace';
          for (const input of run.inputs) {
            const previous = state;
            const before = structuredClone(state);
            expect(chooseLegacyAction(state, chosen)).toEqual(input);
            state = apply(state, input, item.rules);
            const restored = apply(JSON.parse(JSON.stringify(before)), input, item.rules);
            expect(previous).toEqual(before);
            expect(restored).toEqual(state);
            expect(state.legacyValue + state.dualValue + state.modernValue).toBe(
              summarizeLegacy(state).netValue,
            );
          }
          expect(snapshot.tick).toBe(0);
          expect(summarizeLegacy(state)).toEqual(run.result);
          expect(state.inputs).toEqual(run.inputs);
          expect(apply(state, { type: 'ship' }, item.rules)).toBe(state);
        }
      }
    }
  });
});

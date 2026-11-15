import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/minimum-release-comparison.json';
import factors from '../../docs/prototypes/minimum-release-factor-comparison.json';
import {
  baselineMinimumReleaseRules,
  chooseMinimumReleaseInput,
  compareMinimumReleaseFactorReversals,
  compareMinimumReleaseStrategies,
  createMinimumReleasePrototype,
  runMinimumReleaseStrategy,
  startMinimumRelease,
  summarizeMinimumRelease,
  tickMinimumReleasePrototype,
  type MinimumReleaseInput,
  type MinimumReleaseRules,
} from './minimumRelease';

function publishCore() {
  let state = createMinimumReleasePrototype('RI-158', 'roomy');
  for (let i = 0; i < 3; i++)
    state = tickMinimumReleasePrototype(state, { kind: 'work', id: 'core' });
  return state;
}
describe('RI-158 最低限使える版', () => {
  it('必須公開前の追加着手と先送りを拒否する', () => {
    const state = createMinimumReleasePrototype(1, 'tight');
    expect(tickMinimumReleasePrototype(state, { kind: 'work', id: 'extra' })).toBe(state);
    expect(tickMinimumReleasePrototype(state, { kind: 'defer' })).toBe(state);
  });
  it('必須だけで出荷し、先送り後も巻き戻さず約束と代償を残す', () => {
    const core = publishCore();
    expect(summarizeMinimumRelease(core).edition).toBe('minimum');
    const deferred = tickMinimumReleasePrototype(core, { kind: 'defer' });
    expect(deferred.released).toEqual([{ part: 'core', tick: 3, value: 6 }]);
    expect(deferred.trust).toBe(4);
    expect(summarizeMinimumRelease(deferred).promise).toEqual({
      part: 'extra',
      deferred: true,
      workLeft: 4,
      additionalValue: 10,
    });
    expect(tickMinimumReleasePrototype(deferred, { kind: 'work', id: 'extra' })).toBe(deferred);
    expect(tickMinimumReleasePrototype(deferred, { kind: 'defer' })).toBe(deferred);
    expect(core.extraDeferred).toBe(false);
    expect(core.trust).toBe(5);
  });
  it('完全版の出荷で必須の価値を重複加算しない', () => {
    let state = publishCore();
    for (let i = 0; i < 4; i++)
      state = tickMinimumReleasePrototype(state, { kind: 'work', id: 'extra' });
    expect(summarizeMinimumRelease(state)).toMatchObject({
      edition: 'full',
      value: 16,
      promise: null,
    });
    expect(state.released).toHaveLength(2);
    expect(tickMinimumReleasePrototype(state, { kind: 'work', id: 'extra' })).toBe(state);
    expect(tickMinimumReleasePrototype(state, { kind: 'defer' })).toBe(state);
  });
  it('逼迫では最低限版、余裕があれば完全版の価値が高くなる', () => {
    expect(compareMinimumReleaseStrategies(comparison.seed)).toEqual(comparison.results);
    const [tightFull, tightMinimum, roomyFull, roomyMinimum] = comparison.results;
    expect(tightMinimum.value).toBeGreaterThan(tightFull.value);
    expect(roomyFull.value).toBeGreaterThan(roomyMinimum.value);
    expect(tightMinimum.trust).toBeLessThan(tightFull.trust);
  });
  it('入力再生と先送り後の保存再開が一致し、期間終了後は変化しない', () => {
    const initial = createMinimumReleasePrototype('RI-158', 'roomy');
    const snapshot = structuredClone(initial);
    const inputs: MinimumReleaseInput[] = [
      ...Array.from({ length: 3 }, () => ({ kind: 'work' as const, id: 'core' })),
      { kind: 'defer' },
      { kind: 'work', id: 'urgent' },
      { kind: 'work', id: 'urgent' },
    ];
    const apply = (
      state: ReturnType<typeof createMinimumReleasePrototype>,
      input: MinimumReleaseInput,
    ) => tickMinimumReleasePrototype(state, input);
    const live = inputs.reduce(apply, initial);
    const partial = inputs.slice(0, 4).reduce(apply, initial);
    const restored = inputs.slice(4).reduce(apply, JSON.parse(JSON.stringify(partial)));
    expect(restored).toEqual(live);
    expect(initial).toEqual(snapshot);
    const ended = { ...live, board: { ...live.board, tick: live.board.horizon } };
    expect(tickMinimumReleasePrototype(ended, { kind: 'wait' })).toBe(ended);
    expect(tickMinimumReleasePrototype(initial, { kind: 'work', id: 'unknown' })).toBe(initial);
  });
});

function changedKeys(rules: MinimumReleaseRules): (keyof MinimumReleaseRules)[] {
  return (Object.keys(baselineMinimumReleaseRules) as (keyof MinimumReleaseRules)[]).filter(
    (key) => rules[key] !== baselineMinimumReleaseRules[key],
  );
}

describe('RI-158 要因の反転', () => {
  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareMinimumReleaseFactorReversals();
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 'RI-158',
      horizons: { tight: 5, roomy: 8 },
      slots: 1,
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    });
    const nets = (axis: keyof typeof data.sweeps) =>
      data.sweeps[axis].map((item) => [
        item.parameter,
        item.pressures.map((pressure) => [
          pressure.pressure,
          pressure.full.net,
          pressure.minimum.net,
          pressure.preference,
        ]),
      ]);
    expect(nets('additionalValue')).toEqual([
      [
        '0',
        [
          ['tight', 6, 13, 'minimum'],
          ['roomy', 6, 13, 'minimum'],
        ],
      ],
      [
        '4',
        [
          ['tight', 6, 13, 'minimum'],
          ['roomy', 10, 13, 'minimum'],
        ],
      ],
      [
        '6',
        [
          ['tight', 6, 13, 'minimum'],
          ['roomy', 12, 13, 'minimum'],
        ],
      ],
      [
        '7',
        [
          ['tight', 6, 13, 'minimum'],
          ['roomy', 13, 13, 'tie'],
        ],
      ],
      [
        '8',
        [
          ['tight', 6, 13, 'minimum'],
          ['roomy', 14, 13, 'full'],
        ],
      ],
      [
        '10',
        [
          ['tight', 6, 13, 'minimum'],
          ['roomy', 16, 13, 'full'],
        ],
      ],
      [
        '14',
        [
          ['tight', 6, 13, 'minimum'],
          ['roomy', 20, 13, 'full'],
        ],
      ],
    ]);
    expect(nets('trustLoss')).toEqual([
      [
        '0',
        [
          ['tight', 6, 14, 'minimum'],
          ['roomy', 16, 14, 'full'],
        ],
      ],
      [
        '1',
        [
          ['tight', 6, 13, 'minimum'],
          ['roomy', 16, 13, 'full'],
        ],
      ],
      [
        '4',
        [
          ['tight', 6, 10, 'minimum'],
          ['roomy', 16, 10, 'full'],
        ],
      ],
      [
        '7',
        [
          ['tight', 6, 7, 'minimum'],
          ['roomy', 16, 7, 'full'],
        ],
      ],
      [
        '8',
        [
          ['tight', 6, 6, 'tie'],
          ['roomy', 16, 6, 'full'],
        ],
      ],
      [
        '9',
        [
          ['tight', 6, 5, 'full'],
          ['roomy', 16, 5, 'full'],
        ],
      ],
    ]);
    expect(nets('urgentDeadline')).toEqual([
      [
        '3',
        [
          ['tight', 6, 5, 'full'],
          ['roomy', 16, 5, 'full'],
        ],
      ],
      [
        '4',
        [
          ['tight', 6, 5, 'full'],
          ['roomy', 16, 5, 'full'],
        ],
      ],
      [
        '5',
        [
          ['tight', 6, 13, 'minimum'],
          ['roomy', 16, 13, 'full'],
        ],
      ],
      [
        '8',
        [
          ['tight', 6, 13, 'minimum'],
          ['roomy', 16, 13, 'full'],
        ],
      ],
      [
        'none',
        [
          ['tight', 6, 13, 'minimum'],
          ['roomy', 16, 13, 'full'],
        ],
      ],
    ]);
    expect(nets('promiseTicks')).toEqual([
      [
        '0',
        [
          ['tight', 6, 13, 'minimum'],
          ['roomy', 16, 13, 'full'],
        ],
      ],
      [
        '1',
        [
          ['tight', 6, 13, 'minimum'],
          ['roomy', 24, 13, 'full'],
        ],
      ],
      [
        '2',
        [
          ['tight', 16, 13, 'full'],
          ['roomy', 24, 13, 'full'],
        ],
      ],
      [
        '3',
        [
          ['tight', 16, 13, 'full'],
          ['roomy', 24, 13, 'full'],
        ],
      ],
      [
        '4',
        [
          ['tight', 24, 23, 'full'],
          ['roomy', 24, 23, 'full'],
        ],
      ],
    ]);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.pressure,
        item.before.parameter,
        item.before.preference,
        item.after.parameter,
        item.after.preference,
      ]),
    ).toEqual([
      ['additionalValue', 'roomy', '6', 'minimum', '7', 'tie'],
      ['additionalValue', 'roomy', '7', 'tie', '8', 'full'],
      ['trustLoss', 'tight', '7', 'minimum', '8', 'tie'],
      ['trustLoss', 'tight', '8', 'tie', '9', 'full'],
      ['urgentDeadline', 'tight', '4', 'full', '5', 'minimum'],
      ['promiseTicks', 'tight', '1', 'minimum', '2', 'full'],
    ]);
  });

  it('基準行は初回の入力・公開価値・信頼と一致し、動かした規則は一つである', () => {
    const data = compareMinimumReleaseFactorReversals();
    const first = compareMinimumReleaseStrategies(comparison.seed);
    for (const point of [
      data.sweeps.additionalValue.find((item) => item.parameter === '10'),
      data.sweeps.trustLoss.find((item) => item.parameter === '1'),
      data.sweeps.urgentDeadline.find((item) => item.parameter === 'none'),
      data.sweeps.promiseTicks.find((item) => item.parameter === '0'),
    ]) {
      if (!point) throw new Error('baseline');
      expect(changedKeys(point.rules)).toEqual([]);
      for (const pressure of point.pressures) {
        for (const strategy of ['full', 'minimum'] as const) {
          const prior = first.find(
            (row) => row.pressure === pressure.pressure && row.strategy === strategy,
          );
          if (!prior) throw new Error('first');
          const run = pressure[strategy];
          expect(run.inputs).toEqual(prior.inputs);
          expect(run.decisions).toEqual(prior.decisions);
          expect(run.summary).toEqual({
            tick: prior.tick,
            edition: prior.edition,
            value: prior.value,
            released: prior.released,
            trust: prior.trust,
            promise: prior.promise,
            workSpent: prior.workSpent,
          });
          expect(run.net).toBe(prior.value - (5 - prior.trust));
        }
      }
    }
    const only: Record<string, keyof MinimumReleaseRules> = {
      additionalValue: 'additionalValue',
      trustLoss: 'trustLoss',
      urgentDeadline: 'urgentDeadline',
      promiseTicks: 'promiseTicks',
    };
    for (const [axis, key] of Object.entries(only)) {
      for (const item of data.sweeps[axis as keyof typeof data.sweeps])
        expect(changedKeys(item.rules).every((name) => name === key)).toBe(true);
    }
    for (const axis of ['additionalValue', 'trustLoss', 'urgentDeadline'] as const) {
      const inputs = data.sweeps[axis].map((item) =>
        item.pressures.map((pressure) => [pressure.full.inputs, pressure.minimum.inputs]),
      );
      expect(new Set(inputs.map((item) => JSON.stringify(item))).size).toBe(1);
    }
  });

  it('期限を過ぎた別仕事は公開せず、次期では先送りした追加だけを消化する', () => {
    const late = runMinimumReleaseStrategy('RI-158', 'tight', 'minimum', {
      ...baselineMinimumReleaseRules,
      urgentDeadline: 4,
    });
    expect(late.summary.released).toEqual([{ part: 'core', tick: 3, value: 6 }]);
    expect(late.summary.value).toBe(6);
    expect(late.trustLost).toBe(1);
    expect(late.inputs).toEqual(
      compareMinimumReleaseStrategies('RI-158').find(
        (row) => row.pressure === 'tight' && row.strategy === 'minimum',
      )!.inputs,
    );
    const digested = runMinimumReleaseStrategy('RI-158', 'tight', 'minimum', {
      ...baselineMinimumReleaseRules,
      promiseTicks: 4,
    });
    expect(digested.summary).toMatchObject({
      edition: 'full',
      value: 24,
      trust: 4,
      promise: null,
    });
    expect(digested.inputs.filter((input) => input.kind === 'defer')).toHaveLength(1);
    expect(
      digested.inputs.filter((input) => input.kind === 'work' && input.id === 'extra'),
    ).toHaveLength(4);
    const rules = { ...baselineMinimumReleaseRules, promiseTicks: 2 };
    let state = startMinimumRelease('RI-158', 'tight', rules);
    for (const id of ['core', 'core', 'core'] as const)
      state = tickMinimumReleasePrototype(state, { kind: 'work', id }, rules);
    state = tickMinimumReleasePrototype(state, { kind: 'defer' }, rules);
    expect(state.board.tick).toBe(3);
    expect(tickMinimumReleasePrototype(state, { kind: 'work', id: 'extra' }, rules)).toBe(state);
    state = tickMinimumReleasePrototype(state, { kind: 'work', id: 'urgent' }, rules);
    state = tickMinimumReleasePrototype(state, { kind: 'work', id: 'urgent' }, rules);
    expect(state.board.tick).toBe(5);
    const worked = tickMinimumReleasePrototype(state, { kind: 'work', id: 'extra' }, rules);
    expect(worked.board.tasks.find((task) => task.id === 'extra')!.codingLeft).toBe(3);
    expect(worked.trust).toBe(4);
    expect(worked.extraDeferred).toBe(true);
    expect(tickMinimumReleasePrototype(worked, { kind: 'defer' }, rules)).toBe(worked);
  });

  it('要因比較の入力を再生すると差引が一致し、期末では同じ状態を返す', () => {
    const data = compareMinimumReleaseFactorReversals();
    for (const item of Object.values(data.sweeps).flat()) {
      for (const pressure of item.pressures) {
        const started = startMinimumRelease(data.conditions.seed, pressure.pressure, item.rules);
        expect(started.board.slots).toBe(1);
        expect(started.board.horizon).toBe(
          (pressure.pressure === 'tight' ? 5 : 8) + item.rules.promiseTicks,
        );
        expect(started.board.tasks.map((task) => [task.id, task.codingLeft, task.value])).toEqual([
          ['core', 3, 6],
          ['extra', 4, item.rules.additionalValue],
          ['urgent', 2, 8],
        ]);
        for (const strategy of ['full', 'minimum'] as const) {
          const run = pressure[strategy];
          let state = started;
          const snapshot = structuredClone(started);
          for (const input of run.inputs) {
            const previous = state;
            const before = structuredClone(state);
            expect(chooseMinimumReleaseInput(state, strategy, item.rules)).toEqual(input);
            state = tickMinimumReleasePrototype(state, input, item.rules);
            const restored = tickMinimumReleasePrototype(
              JSON.parse(JSON.stringify(before)),
              input,
              item.rules,
            );
            expect(previous).toEqual(before);
            expect(restored).toEqual(state);
          }
          expect(snapshot).toEqual(started);
          expect(summarizeMinimumRelease(state)).toEqual(run.summary);
          expect(state.decisions).toEqual(run.decisions);
          expect(run.net).toBe(run.summary.value - run.trustLost);
          expect(run.trustLost).toBe(5 - run.summary.trust);
          expect(tickMinimumReleasePrototype(state, { kind: 'wait' }, item.rules)).toBe(state);
        }
      }
    }
  });
});

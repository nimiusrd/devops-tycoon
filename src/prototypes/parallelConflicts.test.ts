import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/parallel-conflicts-comparison.json';
import factors from '../../docs/prototypes/parallel-conflicts-factor-comparison.json';
import {
  baselineParallelFactorRules,
  compareParallelFactorReversals,
  compareParallelStrategies,
  createParallelPrototype,
  tickParallelPrototype,
} from './parallelConflicts';

describe('RI-157 並列実装の競合', () => {
  it('同領域の同時Codingだけに一度統合工数を追加する', () => {
    const initial = createParallelPrototype('RI-157');
    const first = tickParallelPrototype(initial, ['a', 'b']);
    expect(first.conflicts).toEqual([{ pair: ['a', 'b'], owner: 'b', tick: 1, effort: 2 }]);
    expect(first.tasks[1].integrationLeft).toBe(2);
    expect(tickParallelPrototype(first, ['a', 'b']).conflicts).toHaveLength(1);
    expect(tickParallelPrototype(initial, ['a', 'c']).conflicts).toEqual([]);
    expect(tickParallelPrototype(initial, ['a']).conflicts).toEqual([]);
    expect(tickParallelPrototype(initial, ['b', 'a']).tasks).toEqual(first.tasks);
  });
  it('統合完了まで出荷せず、Codingと統合を同tickに二重進行しない', () => {
    let state = createParallelPrototype(1);
    for (let i = 0; i < 3; i++) state = tickParallelPrototype(state, ['a', 'b']);
    expect(state.tasks[0].completedTick).toBe(3);
    expect(state.tasks[1].codingLeft).toBe(0);
    expect(state.tasks[1].integrationLeft).toBe(2);
    expect(state.tasks[1].completedTick).toBeNull();
    state = tickParallelPrototype(state, ['b', 'c']);
    expect(state.conflicts).toHaveLength(1);
    state = tickParallelPrototype(state, ['b']);
    expect(state.tasks[1].completedTick).toBe(5);
    expect(tickParallelPrototype(state, ['b'])).toBe(state);
  });
  it('不正入力・枠超過・重複入力・終了後を無消費で拒否する', () => {
    const state = createParallelPrototype(1);
    for (const ids of [['unknown'], ['a', 'a'], ['a', 'b', 'c']])
      expect(tickParallelPrototype(state, ids)).toBe(state);
    const ended = { ...state, tick: state.horizon };
    expect(tickParallelPrototype(ended, [])).toBe(ended);
  });
  it('保存再開・入力再生・元状態不変を検証する', () => {
    const initial = createParallelPrototype('RI-157');
    const snapshot = structuredClone(initial);
    const first = tickParallelPrototype(initial, ['a', 'b']);
    let live = first;
    let restored = JSON.parse(JSON.stringify(first));
    let replayed = initial;
    const inputs = [
      ['a', 'b'],
      ['a', 'b'],
      ['a', 'b'],
      ['b', 'c'],
      ['b', 'c'],
    ];
    for (const ids of inputs.slice(1)) {
      live = tickParallelPrototype(live, ids);
      restored = tickParallelPrototype(restored, ids);
    }
    for (const ids of inputs) replayed = tickParallelPrototype(replayed, ids);
    expect(restored).toEqual(live);
    expect(replayed).toEqual(live);
    expect(initial).toEqual(snapshot);
  });
  it('同条件比較と構成によって変わる並列化の価値を再現する', () => {
    expect(createParallelPrototype(comparison.seed)).toEqual(comparison.initial);
    expect(compareParallelStrategies(comparison.seed)).toEqual(comparison.results);
    const [serial, parallel, , mixedSerial, mixedSame, distributed] = comparison.results;
    expect(parallel.tick).toBeLessThan(serial.tick);
    expect(parallel.integrationEffort).toBeGreaterThan(serial.integrationEffort);
    expect(distributed.tick).toBeLessThan(mixedSame.tick);
    expect(distributed.tick).toBeLessThan(mixedSerial.tick);
    expect(distributed.integrationEffort).toBe(0);
  });
});

describe('RI-157 要因を一つずつ動かした比較', () => {
  const report = compareParallelFactorReversals(comparison.seed);
  type SweepName = keyof typeof report.sweeps;
  const baselineParameter: Record<SweepName, string> = {
    deadline: '12',
    integrationRate: '1',
    conflictEffort: '2',
    slots: '2',
  };
  function point(factor: SweepName, parameter: string) {
    const found = report.sweeps[factor].find((item) => item.parameter === parameter);
    if (!found) throw new Error(parameter);
    return found;
  }
  function first(composition: string, strategy: string) {
    const found = comparison.results.find(
      (item) => item.composition === composition && item.strategy === strategy,
    );
    if (!found) throw new Error(`${composition} ${strategy}`);
    return found;
  }
  function expectBaseline(
    run: {
      history: { ids: string[] }[];
      tick: number;
      shippedValue: number;
      workSpent: number;
      integrationEffort: number;
      completedAll: boolean;
    },
    composition: string,
    strategy: string,
  ) {
    const row = first(composition, strategy);
    expect(run.history.map((entry) => entry.ids)).toEqual(row.history.map((entry) => entry.ids));
    expect(run.tick).toBe(row.tick);
    expect(run).toMatchObject({
      shippedValue: row.value,
      workSpent: row.workSpent,
      integrationEffort: row.integrationEffort,
      completedAll: true,
    });
  }

  it('比較条件・入力列・優劣を再計算し、初回の基準行と一致する', () => {
    expect(report).toEqual(factors);
    expect(report.conditions.initial).toEqual(comparison.initial);
    expect(report.conditions).toMatchObject({
      seed: comparison.seed,
      fixedStrategies: true,
      humanPlaytest: false,
      oneFactorAtATime: true,
      repeatedFirstComparison: false,
      normalRun: false,
      personalAssignment: false,
      productionAdoption: false,
    });
    for (const factor of Object.keys(report.sweeps) as (keyof typeof report.sweeps)[]) {
      for (const item of report.sweeps[factor]) {
        expect(item.changed.length).toBeLessThanOrEqual(1);
        expect(item.changed[0] ?? factor).toBe(factor);
      }
      const baseline = point(factor, baselineParameter[factor]);
      expectBaseline(baseline.sameDomain.parallel, 'same-domain', 'same-first');
      expectBaseline(baseline.sameDomain.split, 'same-domain', 'serial');
      expectBaseline(baseline.mixed.parallel, 'mixed-domains', 'same-first');
      expectBaseline(baseline.mixed.split, 'mixed-domains', 'distribute');
    }
  });
  it('相手側へ反転するのは枠3の混合の完成tickだけで、工数の優劣は残る', () => {
    expect(report.reversals.filter((item) => item.kind === 'switch')).toEqual([
      {
        factor: 'slots',
        composition: 'mixed-domains',
        metric: 'completion',
        kind: 'switch',
        before: { parameter: '2', winner: 'split', parallel: 7, split: 6 },
        after: { parameter: '3', winner: 'parallel', parallel: 5, split: 6 },
      },
    ]);
    const slots3 = point('slots', '3');
    expect(slots3.mixed.outcome.work).toBe('split');
    expect(slots3.mixed.parallel.workSpent).toBe(12);
    expect(slots3.mixed.split.workSpent).toBe(10);
    expect(slots3.mixed.parallel.history[0]?.ids).toEqual(['a', 'b', 'c']);
    for (const entry of slots3.mixed.split.history)
      expect(entry.ids.filter((id) => id === 'a' || id === 'b')).toHaveLength(1);
    expect(point('slots', '4').mixed.parallel.history).toEqual(slots3.mixed.parallel.history);
    expect(point('slots', '4').mixed.split.history).toEqual(slots3.mixed.split.history);
    expect(
      report.reversals.filter(
        (item) => item.factor === 'slots' && item.composition === 'same-domain',
      ),
    ).toEqual([]);
  });
  it('競合工数3で同領域の完成は同点になり、熟練度では優劣が変わらない', () => {
    expect(report.reversals).toContainEqual({
      factor: 'conflictEffort',
      composition: 'same-domain',
      metric: 'completion',
      kind: 'vanish',
      before: { parameter: '2', winner: 'parallel', parallel: 5, split: 6 },
      after: { parameter: '3', winner: 'tie', parallel: 6, split: 6 },
    });
    expect(point('conflictEffort', '1').sameDomain.outcome.completion).toBe('parallel');
    expect(point('conflictEffort', '1').sameDomain.parallel.tick).toBe(4);
    expect(point('conflictEffort', '3').mixed.outcome.completion).toBe('split');
    expect(point('conflictEffort', '3').mixed.parallel.tick).toBe(7);
    expect(
      report.reversals.filter(
        (item) => item.factor === 'conflictEffort' && item.composition === 'mixed-domains',
      ),
    ).toEqual([]);
    expect(report.reversals.filter((item) => item.factor === 'integrationRate')).toEqual([]);
    expect(point('integrationRate', '2').sameDomain.parallel.history).toEqual(
      point('integrationRate', '3').sameDomain.parallel.history,
    );
    expect(point('integrationRate', '2').mixed.outcome.completion).toBe('split');
  });
  it('締切5の同領域だけが出荷価値で並列を上回り、混合の価値は並列が上回らない', () => {
    expect(
      report.sweeps.deadline
        .filter((item) => item.sameDomain.outcome.value === 'parallel')
        .map((item) => item.parameter),
    ).toEqual(['5']);
    expect(report.reversals).toContainEqual({
      factor: 'deadline',
      composition: 'same-domain',
      metric: 'value',
      kind: 'vanish',
      before: { parameter: '5', winner: 'parallel', parallel: 12, split: 6 },
      after: { parameter: '6', winner: 'tie', parallel: 12, split: 12 },
    });
    for (const item of report.sweeps.deadline)
      expect(item.mixed.outcome.value).not.toBe('parallel');
    expect(point('deadline', '5').mixed.parallel.shipped.map((item) => item.id)).toEqual([
      'a',
      'b',
    ]);
    expect(point('deadline', '5').mixed.split.shipped.map((item) => item.id)).toEqual(['a', 'c']);
  });
  it('規則を省いた進行は競合工数2・進捗1と一致し、Coding中は熟練度でも統合を進めない', () => {
    const initial = createParallelPrototype('RI-157');
    let plain = initial;
    let ruled = initial;
    for (const ids of [['a', 'b'], ['a', 'b'], ['b']]) {
      plain = tickParallelPrototype(plain, ids);
      ruled = tickParallelPrototype(ruled, ids, baselineParallelFactorRules);
    }
    expect(ruled).toEqual(plain);
    expect(plain.conflicts[0]).toMatchObject({ effort: 2, owner: 'b' });
    expect(tickParallelPrototype(initial, ['a', 'b', 'c'], baselineParallelFactorRules)).toBe(
      initial,
    );
    const rules = { conflictEffort: 2, integrationRate: 3 };
    let skilled = initial;
    for (let i = 0; i < 3; i++) skilled = tickParallelPrototype(skilled, ['a', 'b'], rules);
    expect(skilled.tasks.find((task) => task.id === 'b')).toMatchObject({
      codingLeft: 0,
      integrationLeft: 2,
      completedTick: null,
    });
    skilled = tickParallelPrototype(skilled, ['b'], rules);
    expect(skilled.tasks.find((task) => task.id === 'b')?.completedTick).toBe(4);
  });
  it('要因の途中状態をversion 1のまま再開し、同じ規則で入力を再生する', () => {
    const rules = { conflictEffort: 3, integrationRate: 1 };
    const inputs = point('conflictEffort', '3').sameDomain.parallel.history.map(
      (entry) => entry.ids,
    );
    let live = createParallelPrototype('RI-157');
    live = { ...live, tasks: live.tasks.slice(0, 2) };
    for (const ids of inputs.slice(0, 3)) live = tickParallelPrototype(live, ids, rules);
    const snapshot = structuredClone(live);
    let restored = JSON.parse(JSON.stringify(live)) as typeof live;
    expect(restored.version).toBe(1);
    for (const ids of inputs.slice(3)) {
      live = tickParallelPrototype(live, ids, rules);
      restored = tickParallelPrototype(restored, ids, rules);
    }
    expect(restored).toEqual(live);
    expect(live.tasks.find((task) => task.id === 'b')?.completedTick).toBe(6);
    expect(snapshot.tick).toBe(3);
    let slots = createParallelPrototype('RI-157');
    slots = { ...slots, slots: 3 };
    for (const entry of point('slots', '3').mixed.parallel.history)
      slots = tickParallelPrototype(slots, entry.ids, baselineParallelFactorRules);
    expect(slots.tick).toBe(5);
    expect(slots.conflicts).toEqual(point('slots', '3').mixed.parallel.conflicts);
  });
});

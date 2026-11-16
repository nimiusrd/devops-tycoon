import { describe, expect, it } from 'vitest';
import {
  applyModelInput as apply,
  baselineModelRules,
  canAffordModel,
  chooseModelAction,
  compareModelFactorReversals,
  compareModelStrategies,
  createModelBoard,
  createModelPrototype as create,
  summarizeModel,
  viewModel,
  type ModelRules,
  type ModelScenario,
} from './modelAssignment';
import comparison from '../../docs/prototypes/model-assignment-comparison.json';
import factors from '../../docs/prototypes/model-assignment-factor-comparison.json';

describe('RI-189 モデルの使い分け', () => {
  it('割当は対象仕事の速度・利用費・欠陥へ一貫して反映され、次の仕事には移る', () => {
    const board = createModelBoard('RI-189', 12, 8, ['simple', 'complex']);
    const assigned = apply(board, { type: 'assign', model: 'fast' });
    expect(assigned.pendingModel).toBe('fast');
    expect(assigned.spent).toBe(0);
    expect(apply(assigned, { type: 'assign', model: 'fast' })).toBe(assigned);
    const started = apply(assigned, { type: 'tick' });
    expect(started.jobs[0]).toMatchObject({ model: 'fast', progress: 3 });
    expect(started.spent).toBe(1);
    const switched = apply(started, { type: 'assign', model: 'precise' });
    expect(switched.jobs[0].model).toBe('fast');
    expect(switched.pendingModel).toBe('precise');
    const finishedSimple = apply(switched, { type: 'tick' });
    expect(finishedSimple.jobs[0]).toMatchObject({ shipped: 10, defect: false, model: 'fast' });
    let complex = apply(finishedSimple, { type: 'tick' });
    complex = apply(complex, { type: 'tick' });
    complex = apply(complex, { type: 'tick' });
    expect(complex.jobs[1]).toMatchObject({ model: 'precise', shipped: 18, defect: false });
    expect(complex.resolutions[complex.resolutions.length - 1]).toBe('t5:c2:precise+2,ship:18');
    expect(complex.spent).toBe(2 + 6);
  });

  it('未指定は無償の人間作業、予算不足の高精度は拒否し、途中枯渇は速度だけ戻す', () => {
    const initial = create('RI-189', 'broke');
    const unspecified = apply(initial, { type: 'tick' });
    expect(unspecified.jobs[0]).toMatchObject({ model: 'none', progress: 1 });
    expect(unspecified.spent).toBe(0);
    expect(unspecified.resolutions[0]).toBe('t1:c1:default-none+1');
    expect(apply(initial, { type: 'assign', model: 'precise' })).toBe(initial);
    expect(canAffordModel(initial, 'precise')).toBe(false);
    const fast = apply(apply(initial, { type: 'assign', model: 'fast' }), { type: 'tick' });
    expect(fast).toMatchObject({ spent: 1, pendingModel: 'fast' });
    const fallback = apply(fast, { type: 'tick' });
    expect(fallback.jobs[0]).toMatchObject({ model: 'fast', progress: 4 });
    expect(fallback.spent).toBe(1);
    expect(fallback.resolutions[fallback.resolutions.length - 1]).toBe('t2:c1:budget:fallback+1');
    const explicit = apply(apply(create('RI-189', 'volume'), { type: 'assign', model: 'none' }), {
      type: 'tick',
    });
    expect(explicit.resolutions[0]).toBe('t1:s1:none+1');
    expect(explicit.spent).toBe(0);
  });

  it('次の仕事を買えない保留モデルは外し、未払いのレビュー負荷を付けない', () => {
    let matched = createModelBoard('RI-189', 6, 9, ['complex', 'simple']);
    let guard = 0;
    while (matched.tick < matched.horizon) {
      if (++guard > 20) throw new Error('match');
      const action = chooseModelAction(matched, 'match');
      const next = apply(matched, action);
      expect(next).not.toBe(matched);
      matched = next;
    }
    expect(matched.jobs[0]).toMatchObject({ model: 'precise', shipped: 18, defect: false });
    expect(matched.jobs[1]).toMatchObject({ model: 'none', shipped: 10, defect: false });
    expect(matched.reviewLoad).toBe(0);
    expect(matched.spent).toBe(6);
    expect(matched.inputs).toContainEqual({ type: 'assign', model: 'none' });
    let direct = createModelBoard('RI-189', 6, 4, ['complex', 'simple']);
    direct = apply(direct, { type: 'assign', model: 'precise' });
    direct = apply(apply(apply(direct, { type: 'tick' }), { type: 'tick' }), { type: 'tick' });
    expect(direct.jobs[0].shipped).toBe(18);
    const cleared = apply(direct, { type: 'tick' });
    expect(cleared.pendingModel).toBeNull();
    expect(cleared.jobs[1]).toMatchObject({ model: 'none', progress: 1 });
    expect(cleared.reviewLoad).toBe(0);
    expect(cleared.resolutions[cleared.resolutions.length - 1]).toBe('t4:s2:budget:clear+1');
    let switched = createModelBoard('RI-189', 3, 8, ['simple', 'complex']);
    guard = 0;
    while (switched.tick < switched.horizon) {
      if (++guard > 20) throw new Error('switch');
      const action = chooseModelAction(switched, 'match');
      const next = apply(switched, action);
      expect(next).not.toBe(switched);
      switched = next;
    }
    expect(switched.jobs[0]).toMatchObject({ model: 'fast', shipped: 10, defect: false });
    expect(switched.jobs[1]).toMatchObject({ model: 'none', shipped: 18, defect: false });
    expect(switched.spent).toBe(2);
    expect(switched.inputs).toContainEqual({ type: 'assign', model: 'none' });
  });

  it('閲覧と不正な割当は発火せず、着手済みのモデルは巻き戻さない', () => {
    const initial = create('RI-189', 'hard');
    const before = structuredClone(initial);
    for (let count = 0; count < 30; count += 1) viewModel(initial);
    expect(initial).toEqual(before);
    expect(viewModel(initial).models.fast).toMatchObject({ speed: 3, cost: 1, complexPenalty: 12 });
    expect(apply(initial, { type: 'assign', model: 'gpt-x' })).toBe(initial);
    expect(apply(initial, { type: 'assign', model: '' })).toBe(initial);
    const ended = { ...initial, tick: initial.horizon };
    expect(apply(ended, { type: 'tick' })).toBe(ended);
    expect(apply(ended, { type: 'assign', model: 'fast' })).toBe(ended);
    const started = apply(apply(initial, { type: 'assign', model: 'fast' }), { type: 'tick' });
    const kept = apply(started, { type: 'assign', model: 'none' });
    expect(kept.jobs[0].model).toBe('fast');
    expect(apply(kept, { type: 'tick' }).jobs[0].model).toBe('fast');
  });

  it('量産は高速、難件は高精度、混合は使い分けが有利で、予算1では高精度を選べない', () => {
    const rows = compareModelStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const net = (scenario: string, strategy: string) =>
      rows.find((row) => row.scenario === scenario && row.strategy === strategy)!.result.netValue;
    expect([net('volume', 'fast'), net('volume', 'none'), net('volume', 'precise')]).toEqual([
      32, 10, 6,
    ]);
    expect([net('hard', 'precise'), net('hard', 'none'), net('hard', 'fast')]).toEqual([
      20, 18, 12,
    ]);
    expect([
      net('mixed', 'match'),
      net('mixed', 'fast'),
      net('mixed', 'precise'),
      net('mixed', 'none'),
    ]).toEqual([28, 20, 15, 10]);
    expect([net('broke', 'none'), net('broke', 'precise'), net('broke', 'fast')]).toEqual([
      18, 18, 5,
    ]);
    const hardFast = rows.find((row) => row.scenario === 'hard' && row.strategy === 'fast')!;
    expect(hardFast.result.defects).toEqual(['c1', 'c2', 'c3']);
    expect(hardFast.result.shippedJobs.every((job) => job.shipped === 6)).toBe(true);
    const volumePrecise = rows.find(
      (row) => row.scenario === 'volume' && row.strategy === 'precise',
    )!;
    expect(volumePrecise.result.reviewLoad).toBe(6);
    const brokePrecise = rows.find(
      (row) => row.scenario === 'broke' && row.strategy === 'precise',
    )!;
    expect(brokePrecise.inputs.some((input) => input.type === 'assign')).toBe(false);
    expect(brokePrecise.result.spent).toBe(0);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、出荷合計と予算が崩れない', () => {
    for (const row of compareModelStrategies(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
        expect(chooseModelAction(previous, row.strategy)).toEqual(input);
        expect(live.spent).toBeLessThanOrEqual(live.budget);
        expect(live.jobs.reduce((sum, job) => sum + (job.shipped ?? 0), 0)).toBe(live.shippedValue);
      }
      expect(summarizeModel(live)).toEqual(row.result);
      const again = row.inputs.reduce((state, input) => apply(state, input), row.initial);
      expect(again).toEqual(live);
    }
  });
});

function changedKeys(rules: ModelRules): (keyof ModelRules)[] {
  return (Object.keys(baselineModelRules) as (keyof ModelRules)[]).filter(
    (key) => rules[key] !== baselineModelRules[key],
  );
}

function nets(axis: keyof ReturnType<typeof compareModelFactorReversals>['sweeps']) {
  const data = compareModelFactorReversals();
  return data.sweeps[axis].map((item) => [
    item.parameter,
    item.scenarios.map((scenario) => [
      scenario.scenario,
      scenario.fast.result.netValue,
      scenario.precise.result.netValue,
      scenario.preference,
    ]),
  ]);
}

describe('RI-189 要因の反転', () => {
  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareModelFactorReversals();
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 'RI-189',
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    });
    expect(nets('preciseCost')).toEqual([
      [
        '0',
        [
          ['volume', 32, 14, 'fast'],
          ['hard', 12, 36, 'precise'],
          ['mixed', 20, 25, 'precise'],
          ['broke', 5, 25, 'precise'],
        ],
      ],
      [
        '1',
        [
          ['volume', 32, 6, 'fast'],
          ['hard', 12, 28, 'precise'],
          ['mixed', 20, 17, 'fast'],
          ['broke', 5, 17, 'precise'],
        ],
      ],
      [
        '2',
        [
          ['volume', 32, 6, 'fast'],
          ['hard', 12, 20, 'precise'],
          ['mixed', 20, 15, 'fast'],
          ['broke', 5, 18, 'precise'],
        ],
      ],
      [
        '3',
        [
          ['volume', 32, 1, 'fast'],
          ['hard', 12, 21, 'precise'],
          ['mixed', 20, -2, 'fast'],
          ['broke', 5, 18, 'precise'],
        ],
      ],
      [
        '4',
        [
          ['volume', 32, -1, 'fast'],
          ['hard', 12, 20, 'precise'],
          ['mixed', 20, -1, 'fast'],
          ['broke', 5, 18, 'precise'],
        ],
      ],
      [
        '5',
        [
          ['volume', 32, 2, 'fast'],
          ['hard', 12, 3, 'fast'],
          ['mixed', 20, -3, 'fast'],
          ['broke', 5, 18, 'precise'],
        ],
      ],
      [
        '6',
        [
          ['volume', 32, 1, 'fast'],
          ['hard', 12, 6, 'fast'],
          ['mixed', 20, 1, 'fast'],
          ['broke', 5, 18, 'precise'],
        ],
      ],
    ]);
    expect(nets('defectPenalty')).toEqual([
      [
        '0',
        [
          ['volume', 32, 6, 'fast'],
          ['hard', 48, 20, 'fast'],
          ['mixed', 32, 15, 'fast'],
          ['broke', 17, 18, 'precise'],
        ],
      ],
      [
        '6',
        [
          ['volume', 32, 6, 'fast'],
          ['hard', 30, 20, 'fast'],
          ['mixed', 26, 15, 'fast'],
          ['broke', 11, 18, 'precise'],
        ],
      ],
      [
        '9',
        [
          ['volume', 32, 6, 'fast'],
          ['hard', 21, 20, 'fast'],
          ['mixed', 23, 15, 'fast'],
          ['broke', 8, 18, 'precise'],
        ],
      ],
      [
        '10',
        [
          ['volume', 32, 6, 'fast'],
          ['hard', 18, 20, 'precise'],
          ['mixed', 22, 15, 'fast'],
          ['broke', 7, 18, 'precise'],
        ],
      ],
      [
        '12',
        [
          ['volume', 32, 6, 'fast'],
          ['hard', 12, 20, 'precise'],
          ['mixed', 20, 15, 'fast'],
          ['broke', 5, 18, 'precise'],
        ],
      ],
      [
        '16',
        [
          ['volume', 32, 6, 'fast'],
          ['hard', 0, 20, 'precise'],
          ['mixed', 16, 15, 'fast'],
          ['broke', 1, 18, 'precise'],
        ],
      ],
      [
        '17',
        [
          ['volume', 32, 6, 'fast'],
          ['hard', -3, 20, 'precise'],
          ['mixed', 15, 15, 'tie'],
          ['broke', 0, 18, 'precise'],
        ],
      ],
      [
        '18',
        [
          ['volume', 32, 6, 'fast'],
          ['hard', -6, 20, 'precise'],
          ['mixed', 14, 15, 'precise'],
          ['broke', -1, 18, 'precise'],
        ],
      ],
    ]);
    expect(nets('simpleReview')).toEqual([
      [
        '0',
        [
          ['volume', 32, 12, 'fast'],
          ['hard', 12, 20, 'precise'],
          ['mixed', 20, 18, 'fast'],
          ['broke', 5, 18, 'precise'],
        ],
      ],
      [
        '1',
        [
          ['volume', 32, 10, 'fast'],
          ['hard', 12, 20, 'precise'],
          ['mixed', 20, 17, 'fast'],
          ['broke', 5, 18, 'precise'],
        ],
      ],
      [
        '2',
        [
          ['volume', 32, 8, 'fast'],
          ['hard', 12, 20, 'precise'],
          ['mixed', 20, 16, 'fast'],
          ['broke', 5, 18, 'precise'],
        ],
      ],
      [
        '3',
        [
          ['volume', 32, 6, 'fast'],
          ['hard', 12, 20, 'precise'],
          ['mixed', 20, 15, 'fast'],
          ['broke', 5, 18, 'precise'],
        ],
      ],
      [
        '6',
        [
          ['volume', 32, 0, 'fast'],
          ['hard', 12, 20, 'precise'],
          ['mixed', 20, 12, 'fast'],
          ['broke', 5, 18, 'precise'],
        ],
      ],
    ]);
    expect(nets('budgetRecovery')).toEqual([
      [
        '0',
        [
          ['volume', 32, 6, 'fast'],
          ['hard', 12, 20, 'precise'],
          ['mixed', 20, 15, 'fast'],
          ['broke', 5, 18, 'precise'],
        ],
      ],
      [
        '1',
        [
          ['volume', 32, -2, 'fast'],
          ['hard', 12, 20, 'precise'],
          ['mixed', 20, 9, 'fast'],
          ['broke', 12, 14, 'precise'],
        ],
      ],
      [
        '2',
        [
          ['volume', 32, -2, 'fast'],
          ['hard', 12, 20, 'precise'],
          ['mixed', 20, 9, 'fast'],
          ['broke', 12, 14, 'precise'],
        ],
      ],
      [
        '4',
        [
          ['volume', 32, -2, 'fast'],
          ['hard', 12, 20, 'precise'],
          ['mixed', 20, 9, 'fast'],
          ['broke', 12, 14, 'precise'],
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
      ['preciseCost', 'mixed', '0', 'precise', '1', 'fast'],
      ['preciseCost', 'hard', '4', 'precise', '5', 'fast'],
      ['defectPenalty', 'hard', '9', 'fast', '10', 'precise'],
      ['defectPenalty', 'mixed', '16', 'fast', '17', 'tie'],
      ['defectPenalty', 'mixed', '17', 'tie', '18', 'precise'],
    ]);
    expect(data.reversals.some((item) => item.axis === 'simpleReview')).toBe(false);
    expect(data.reversals.some((item) => item.axis === 'budgetRecovery')).toBe(false);
  });

  it('基準行は初回の安いモデル・高いモデルと一致し、動かした規則は一つである', () => {
    const data = compareModelFactorReversals();
    const first = compareModelStrategies(comparison.seed);
    const baselines = [
      data.sweeps.preciseCost.find((item) => item.parameter === '2'),
      data.sweeps.defectPenalty.find((item) => item.parameter === '12'),
      data.sweeps.simpleReview.find((item) => item.parameter === '3'),
      data.sweeps.budgetRecovery.find((item) => item.parameter === '0'),
    ];
    for (const point of baselines) {
      if (!point) throw new Error('baseline');
      expect(changedKeys(point.rules)).toEqual([]);
      for (const scenario of point.scenarios) {
        for (const strategy of ['fast', 'precise'] as const) {
          const original = first.find(
            (row) => row.scenario === scenario.scenario && row.strategy === strategy,
          );
          if (!original) throw new Error('first');
          expect(scenario[strategy].inputs).toEqual(original.inputs);
          expect(scenario[strategy].result).toEqual(original.result);
        }
      }
    }
    const only: Record<string, keyof ModelRules> = {
      preciseCost: 'preciseCost',
      defectPenalty: 'defectPenalty',
      simpleReview: 'simpleReview',
      budgetRecovery: 'budgetRecovery',
    };
    for (const [axis, key] of Object.entries(only)) {
      for (const item of data.sweeps[axis as keyof typeof data.sweeps]) {
        expect(changedKeys(item.rules).every((name) => name === key)).toBe(true);
        expect(item.rules.fastCost).toBe(1);
      }
    }
    const free = data.sweeps.preciseCost.find((item) => item.parameter === '0');
    const costly = data.sweeps.preciseCost.find((item) => item.parameter === '5');
    expect(free?.scenarios.find((item) => item.scenario === 'mixed')?.precise.result.netValue).toBe(
      25,
    );
    const hardCostly = costly?.scenarios.find((item) => item.scenario === 'hard')?.precise.result;
    expect(hardCostly?.shippedJobs).toHaveLength(1);
    expect(hardCostly?.netValue).toBe(3);
    const mild = data.sweeps.defectPenalty.find((item) => item.parameter === '0');
    expect(mild?.scenarios.find((item) => item.scenario === 'hard')?.fast.result.defects).toEqual(
      [],
    );
    const heavy = data.sweeps.simpleReview.find((item) => item.parameter === '0');
    expect(
      heavy?.scenarios.find((item) => item.scenario === 'volume')?.precise.result.reviewLoad,
    ).toBe(0);
  });

  it('回復は予算上限だけを足し、予算1の高いモデルは最初の仕事を人間のままにする', () => {
    const rules = { ...baselineModelRules, budgetRecovery: 1 };
    const opened = apply(
      create('RI-189', 'broke'),
      chooseModelAction(create('RI-189', 'broke'), 'precise', rules),
      rules,
    );
    expect(opened.budget).toBe(2);
    expect(opened.spent).toBe(0);
    expect(opened.resolutions[0]).toBe('t1:c1:default-none+1');
    const plain = apply(create('RI-189', 'broke'), { type: 'tick' });
    expect(plain.budget).toBe(1);
    expect(plain.resolutions[0]).toBe(opened.resolutions[0]);
    const recovered = compareModelFactorReversals().sweeps.budgetRecovery.find(
      (item) => item.parameter === '1',
    );
    const broke = recovered?.scenarios.find((item) => item.scenario === 'broke');
    expect(broke?.fast.result.shippedJobs.map((job) => job.id)).toEqual(['c1', 's2']);
    expect(broke?.fast.result.spent).toBe(4);
    expect(broke?.precise.result.shippedJobs).toEqual([
      { id: 'c1', model: 'none', shipped: 18, defect: false },
    ]);
    expect(broke?.precise.result.spent).toBe(4);
    expect(broke?.precise.result.reviewLoad).toBe(0);
  });

  it('要因比較の入力を再生すると差引が一致し、規則なしの再生は初回の規則になる', () => {
    const data = compareModelFactorReversals();
    for (const item of Object.values(data.sweeps).flat()) {
      for (const scenario of item.scenarios) {
        for (const strategy of ['fast', 'precise'] as const) {
          const run = scenario[strategy];
          let state = create(data.conditions.seed, scenario.scenario as ModelScenario);
          expect(state.budget).toBe(
            data.conditions.scenarios.find((row) => row.scenario === scenario.scenario)?.budget,
          );
          for (const input of run.inputs) {
            const previous = state;
            const before = structuredClone(state);
            expect(chooseModelAction(state, strategy, item.rules)).toEqual(input);
            state = apply(state, input, item.rules);
            const restored = apply(JSON.parse(JSON.stringify(before)), input, item.rules);
            expect(previous).toEqual(before);
            expect(restored).toEqual(state);
            expect(state.spent).toBeLessThanOrEqual(state.budget);
            expect(state.jobs.reduce((sum, job) => sum + (job.shipped ?? 0), 0)).toBe(
              state.shippedValue,
            );
          }
          expect(summarizeModel(state)).toEqual(run.result);
          expect(state.inputs).toEqual(run.inputs);
          expect(apply(state, { type: 'tick' }, item.rules)).toBe(state);
        }
      }
    }
    const started = apply(apply(create('RI-189', 'hard'), { type: 'assign', model: 'fast' }), {
      type: 'tick',
    });
    const replayed = apply(JSON.parse(JSON.stringify(started)), { type: 'tick' });
    expect(replayed.budget).toBe(16);
    expect(replayed.spent).toBe(2);
    expect(replayed).toEqual(apply(started, { type: 'tick' }, baselineModelRules));
  });
});

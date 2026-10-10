import { describe, expect, it } from 'vitest';
import {
  applyModelInput as apply,
  canAffordModel,
  chooseModelAction,
  compareModelStrategies,
  createModelBoard,
  createModelPrototype as create,
  summarizeModel,
  viewModel,
} from './modelAssignment';
import comparison from '../../docs/prototypes/model-assignment-comparison.json';

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

import { describe, expect, it } from 'vitest';
import {
  baselineCiRules,
  compareCiFactorReversals,
  compareCiStrategies,
  createCiFactorState,
  createCiPrototype,
  summarizeCi,
  tickCiPrototype,
  type CiRules,
} from './ciCapacity';
import comparison from '../../docs/prototypes/ci-capacity-comparison.json';
import factors from '../../docs/prototypes/ci-capacity-factor-comparison.json';
describe('RI-161 CI枠', () => {
  it('容量上限とFIFOを守り、失敗は1工数手戻り後に末尾へ再投入する', () => {
    let state = createCiPrototype(1, 'ci', 1);
    const snapshot = structuredClone(state);
    state = tickCiPrototype(state, 'all');
    expect(state.jobs.map((j) => j.stage)).toEqual(['ci', 'queue', 'queue']);
    state = tickCiPrototype(state, 'all');
    expect(state.jobs[0]).toMatchObject({ stage: 'done', completedTick: 2, attempts: 1 });
    state = tickCiPrototype(tickCiPrototype(state, 'all'), 'all');
    expect(state.jobs[1]).toMatchObject({ stage: 'rework', attempts: 1, completedTick: null });
    state = tickCiPrototype(state, 'all');
    expect(state.jobs[2].stage).toBe('ci');
    expect(state.jobs[1]).toMatchObject({ stage: 'queue', queuedOrder: 3 });
    expect(snapshot.tick).toBe(0);
    expect(snapshot.jobs.every((j) => j.stage === 'review')).toBe(true);
  });
  it('各tickの仕事を欠落・重複させず、CI処理中を枠以内に保つ', () => {
    for (const capacity of [1, 2] as const)
      for (const flow of ['all', 'paced'] as const) {
        let state = createCiPrototype(1, 'ci', capacity);
        while (state.tick < state.horizon) {
          state = tickCiPrototype(state, flow);
          expect(new Set(state.jobs.map((j) => j.id)).size).toBe(3);
          expect(state.jobs.filter((j) => j.stage === 'ci').length).toBeLessThanOrEqual(capacity);
          expect(
            state.jobs.filter((j) => j.stage === 'done').every((j) => j.completedTick !== null),
          ).toBe(true);
        }
        expect(tickCiPrototype(state, flow)).toBe(state);
      }
  });
  it('容量投資と流入抑制を比較し、レビューが詰まると投資が劣る', () => {
    expect(compareCiStrategies(comparison.seed)).toEqual(comparison.results);
    const [one, two, paced, reviewOne, reviewTwo] = comparison.results;
    expect(two.result.netValue).toBeGreaterThan(one.result.netValue);
    expect(reviewOne.result.netValue).toBeGreaterThan(reviewTwo.result.netValue);
    expect(paced.result.queueWait).toBeLessThan(one.result.queueWait);
    expect(paced.result.upstreamWait).toBeGreaterThan(0);
  });
  it('再実行中の保存再開・入力再生が一致し、資源不足では停止する', () => {
    for (const row of comparison.results) {
      let state = createCiPrototype(
        comparison.seed,
        row.bottleneck as 'ci' | 'review',
        row.capacity as 1 | 2,
      );
      let restored = structuredClone(state);
      for (const input of row.inputs) {
        state = tickCiPrototype(state, input as 'all' | 'paced');
        restored = tickCiPrototype(JSON.parse(JSON.stringify(restored)), input as 'all' | 'paced');
      }
      expect(restored).toEqual(state);
      expect(summarizeCi(state)).toEqual(row.result);
    }
    const exhausted = { ...createCiPrototype(1, 'ci', 2), budget: 1 };
    expect(tickCiPrototype(exhausted, 'all')).toBe(exhausted);
  });
});

const RULE_KEYS = [
  'values',
  'deadlines',
  'lateValue',
  'ciEffort',
  'failFirstIds',
  'capacityUnitCost',
  'reviewSlots',
  'reviewEffort',
  'reworkSlots',
] as const satisfies readonly (keyof CiRules)[];

function changedKeys(rules: CiRules): string[] {
  return RULE_KEYS.filter(
    (key) => JSON.stringify(rules[key]) !== JSON.stringify(baselineCiRules[key]),
  );
}

function rules(patch: Partial<CiRules>): CiRules {
  return {
    ...baselineCiRules,
    values: [...baselineCiRules.values],
    deadlines: [...baselineCiRules.deadlines],
    failFirstIds: [...baselineCiRules.failFirstIds],
    ...patch,
  };
}

describe('RI-161 要因の反転', () => {
  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareCiFactorReversals();
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 'RI-161',
      horizon: 6,
      budget: 20,
      jobs: ['a', 'b', 'c'],
      flow: 'all',
      lateValue: 0,
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
    });
    const nets = (axis: keyof typeof data.sweeps) =>
      data.sweeps[axis].map((item) => [
        item.parameter,
        item.runs.capacity1.result.netValue,
        item.runs.capacity2.result.netValue,
        item.preference,
      ]);
    expect(nets('jobValue')).toEqual([
      ['b=8', 10, 12, 'increase'],
      ['b=7', 10, 11, 'increase'],
      ['b=6', 10, 10, 'tie'],
      ['b=5', 10, 9, 'keep'],
    ]);
    expect(nets('deadline')).toEqual([
      ['6', 10, 12, 'increase'],
      ['5', 2, 12, 'increase'],
      ['4', 2, 12, 'increase'],
      ['3', 2, -4, 'keep'],
      ['2', 2, -4, 'keep'],
    ]);
    expect(nets('jobDeadline')).toEqual([
      ['6/6/6', 10, 12, 'increase'],
      ['6/4/6', 10, 12, 'increase'],
      ['6/3/6', 10, 4, 'keep'],
    ]);
    expect(nets('ciEffort')).toEqual([
      ['1', 18, 12, 'keep'],
      ['2', 10, 12, 'increase'],
      ['3', 2, 12, 'increase'],
      ['4', 2, -4, 'keep'],
    ]);
    expect(nets('failureCount')).toEqual([
      ['0', 18, 12, 'keep'],
      ['b', 10, 12, 'increase'],
      ['b+c', 2, 12, 'increase'],
      ['b+c+a', -6, 12, 'increase'],
    ]);
    expect(nets('capacityUnitCost')).toEqual([
      ['1', 10, 12, 'increase'],
      ['2', 4, 4, 'tie'],
      ['3', -2, -10, 'keep'],
    ]);
    expect(nets('reviewSlots')).toEqual([
      ['1', 10, 12, 'increase'],
      ['2', 10, 12, 'increase'],
    ]);
    expect(nets('reviewSlotsWithWork')).toEqual([
      ['1', 2, -4, 'keep'],
      ['2', 2, 4, 'increase'],
      ['3', 2, 12, 'increase'],
    ]);
    expect(nets('reworkSlots')).toEqual([
      ['0', 10, 4, 'keep'],
      ['1', 10, 12, 'increase'],
      ['2', 10, 12, 'increase'],
    ]);
    expect(data.controls.map((item) => [item.parameter, item.margin, item.preference])).toEqual([
      ['3/8/20', 2, 'increase'],
      ['6/6/5', 10, 'increase'],
    ]);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.before.parameter,
        item.before.preference,
        item.after.parameter,
        item.after.preference,
      ]),
    ).toEqual([
      ['jobValue', 'b=7', 'increase', 'b=6', 'tie'],
      ['jobValue', 'b=6', 'tie', 'b=5', 'keep'],
      ['deadline', '4', 'increase', '3', 'keep'],
      ['jobDeadline', '6/4/6', 'increase', '6/3/6', 'keep'],
      ['ciEffort', '1', 'keep', '2', 'increase'],
      ['ciEffort', '3', 'increase', '4', 'keep'],
      ['failureCount', '0', 'keep', 'b', 'increase'],
      ['capacityUnitCost', '1', 'increase', '2', 'tie'],
      ['capacityUnitCost', '2', 'tie', '3', 'keep'],
      ['reviewSlotsWithWork', '1', 'keep', '2', 'increase'],
      ['reworkSlots', '0', 'keep', '1', 'increase'],
    ]);
    expect(data.reversals.some((item) => item.axis === 'reviewSlots')).toBe(false);
  });

  it('基準行は初回のCI混雑とレビュー混雑のallに一致し、動かした規則は一つである', () => {
    const data = compareCiFactorReversals();
    const legacy = compareCiStrategies(comparison.seed);
    const ci = legacy.filter((row) => row.bottleneck === 'ci' && row.flow === 'all');
    const review = legacy.filter((row) => row.bottleneck === 'review' && row.flow === 'all');
    const baseline = data.sweeps.jobValue[0];
    if (!baseline || !ci[0] || !ci[1] || !review[0] || !review[1]) throw new Error('rows');
    expect(baseline.runs.capacity1.result).toEqual(ci[0].result);
    expect(baseline.runs.capacity2.result).toEqual(ci[1].result);
    expect(baseline.runs.capacity1.inputs).toEqual(ci[0].inputs);
    expect(baseline.runs.capacity2.inputs).toEqual(ci[1].inputs);
    const reviewEndpoint = data.sweeps.reviewSlotsWithWork[0];
    if (!reviewEndpoint) throw new Error('review');
    expect(reviewEndpoint.runs.capacity1.result).toEqual(review[0].result);
    expect(reviewEndpoint.runs.capacity2.result).toEqual(review[1].result);
    const only: Record<string, string> = {
      jobValue: 'values',
      deadline: 'deadlines',
      jobDeadline: 'deadlines',
      ciEffort: 'ciEffort',
      failureCount: 'failFirstIds',
      capacityUnitCost: 'capacityUnitCost',
      reviewSlots: 'reviewSlots',
      reworkSlots: 'reworkSlots',
    };
    for (const [axis, key] of Object.entries(only)) {
      const rows = data.sweeps[axis as keyof typeof data.sweeps];
      for (const item of rows)
        expect(changedKeys(item.rules).every((name) => name === key)).toBe(true);
    }
    for (const item of data.sweeps.reviewSlotsWithWork) {
      const changed = changedKeys(item.rules).filter((name) => name !== 'reviewEffort');
      expect(item.rules.reviewEffort).toBe(3);
      expect(changed).toEqual(item.parameter === '1' ? [] : ['reviewSlots']);
    }
    expect(changedKeys(data.controls[0]!.rules)).toEqual(['values']);
    expect(changedKeys(data.controls[1]!.rules)).toEqual(['deadlines']);
    const late = data.sweeps.deadline.find((item) => item.parameter === '3');
    expect(late?.runs.capacity2.finished).toEqual([
      { id: 'a', tick: 2 },
      { id: 'b', tick: 4 },
      { id: 'c', tick: 4 },
    ]);
    expect(late?.runs.capacity2.result).toMatchObject({
      done: ['a', 'b', 'c'],
      value: 8,
      netValue: -4,
    });
    expect(data.sweeps.ciEffort[0]?.runs.capacity1.finished).toEqual([
      { id: 'a', tick: 1 },
      { id: 'b', tick: 4 },
      { id: 'c', tick: 3 },
    ]);
    expect(data.sweeps.capacityUnitCost[1]?.runs.capacity2.inputs).toHaveLength(5);
    expect(data.sweeps.capacityUnitCost[2]?.runs.capacity2.inputs).toHaveLength(3);
    expect(data.sweeps.capacityUnitCost[2]?.runs.capacity1.inputs).toHaveLength(6);
    expect(createCiPrototype(comparison.seed, 'ci', 1).rules).toBeUndefined();
    expect(
      createCiPrototype(comparison.seed, 'ci', 1).jobs.every((job) => job.deadline === undefined),
    ).toBe(true);
  });

  it('要因比較の入力を再生すると差引が一致し、予算不足と期末では同じ状態を返す', () => {
    const data = compareCiFactorReversals();
    const points = [...Object.values(data.sweeps).flat(), ...data.controls];
    for (const item of points) {
      for (const capacity of [1, 2] as const) {
        const run = capacity === 1 ? item.runs.capacity1 : item.runs.capacity2;
        let state = createCiFactorState(data.conditions.seed, capacity, item.rules);
        const snapshot = structuredClone(state);
        expect(state).toMatchObject({ horizon: 6, budget: 20 });
        expect(state.jobs.map((job) => job.id)).toEqual(['a', 'b', 'c']);
        expect(run.inputs.every((input) => input === 'all')).toBe(true);
        for (const input of run.inputs) {
          const previous = state;
          const before = structuredClone(state);
          state = tickCiPrototype(state, input);
          const restored = tickCiPrototype(JSON.parse(JSON.stringify(before)), input);
          expect(previous).toEqual(before);
          expect(restored).toEqual(state);
        }
        expect(snapshot.tick).toBe(0);
        expect(summarizeCi(state)).toEqual(run.result);
        expect(state.inputs).toEqual(run.inputs);
        expect(tickCiPrototype(state, 'all')).toBe(state);
      }
    }
    const dry = createCiFactorState('RI-161', 2, rules({ capacityUnitCost: 11 }));
    expect(tickCiPrototype(dry, 'all')).toBe(dry);
  });

  it('修正待ちが2件の入力では担当1が先の1件だけを戻す', () => {
    const state = createCiFactorState('RI-161', 1, rules({ reworkSlots: 1 }));
    const [first, second, third] = state.jobs;
    if (!first || !second || !third) throw new Error('jobs');
    first.stage = 'rework';
    second.stage = 'rework';
    third.reviewLeft = 0;
    expect(tickCiPrototype(state, 'all').jobs.map((job) => job.stage)).toEqual([
      'ci',
      'rework',
      'queue',
    ]);
    const wider = createCiFactorState('RI-161', 1, rules({ reworkSlots: 2 }));
    const [lead, nextJob, last] = wider.jobs;
    if (!lead || !nextJob || !last) throw new Error('jobs');
    lead.stage = 'rework';
    nextJob.stage = 'rework';
    last.reviewLeft = 0;
    expect(tickCiPrototype(wider, 'all').jobs.map((job) => job.stage)).toEqual([
      'ci',
      'queue',
      'queue',
    ]);
    expect(baselineCiRules.reworkSlots).toBe(1);
  });
});

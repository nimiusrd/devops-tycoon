import { describe, expect, it } from 'vitest';
import {
  applyHoldInput as apply,
  baselineHoldRules,
  createHoldPrototype as create,
  compareHoldFactorReversals,
  compareHoldStrategies,
  summarizeHold,
} from './reviewHold';
import comparison from '../../docs/prototypes/review-hold-comparison.json';
import factors from '../../docs/prototypes/review-hold-factor-comparison.json';

describe('RI-173 危険PRの保留', () => {
  it('保留中は自動レビューと先頭即処理から除外し、Doneに数えない', () => {
    const held = apply(create('RI-173'), { type: 'hold', id: 'hard' });
    const ticked = apply(held, { type: 'tick' });
    expect(ticked.jobs[0]).toEqual(held.jobs[0]);
    expect(ticked.jobs[1].stage).toBe('done');
    const rushed = apply(held, { type: 'rush' });
    expect(rushed.jobs[0]).toEqual(held.jobs[0]);
    expect(summarizeHold(rushed)).toMatchObject({
      doneCount: 2,
      heldCount: 1,
      unfinishedValue: 16,
      value: 8,
    });
    expect(apply(rushed, { type: 'rush' })).toBe(rushed);
  });
  it('途中進捗・価値・IDと着手時品質を保留/復帰で保持する', () => {
    const started = apply(create('RI-173'), { type: 'tick' });
    const job = started.jobs[0];
    expect(job).toMatchObject({ reviewLeft: 1, qualityCost: 12 });
    let state = apply(started, { type: 'hold', id: 'hard' });
    for (let i = 0; i < 2; i++) state = apply(state, { type: 'tick' });
    state = apply(state, { type: 'resume', id: 'hard' });
    expect(state.jobs[0]).toEqual(job);
    state = apply(state, { type: 'tick' });
    expect(state.jobs[0]).toMatchObject({
      id: 'hard',
      value: 16,
      reviewLeft: 0,
      stage: 'done',
      qualityCost: 12,
    });
    expect(new Set(state.jobs.map((j) => j.id)).size).toBe(3);
    expect(state.jobs.reduce((sum, j) => sum + j.value, 0)).toBe(24);
  });
  it('上限1・重複・未知ID・Done・資源不足・期末を無消費で拒否する', () => {
    const initial = create('RI-173');
    const held = apply(initial, { type: 'hold', id: 'hard' });
    expect(apply(held, { type: 'hold', id: 'easy-a' })).toBe(held);
    expect(apply(held, { type: 'hold', id: 'hard' })).toBe(held);
    expect(apply(initial, { type: 'resume', id: 'hard' })).toBe(initial);
    expect(apply(initial, { type: 'hold', id: 'unknown' })).toBe(initial);
    const done = apply(initial, { type: 'rush' });
    expect(apply(done, { type: 'hold', id: 'hard' })).toBe(done);
    const poor = { ...held, focus: 0 };
    expect(apply(poor, { type: 'resume', id: 'hard' })).toBe(poor);
    expect(apply(poor, { type: 'rush' })).toBe(poor);
    const ended = { ...held, tick: held.horizon };
    expect(apply(ended, { type: 'resume', id: 'hard' })).toBe(ended);
    expect(apply(ended, { type: 'tick' })).toBe(ended);
    expect(summarizeHold(ended)).toMatchObject({ doneCount: 0, heldCount: 1, unfinishedValue: 24 });
  });
  it('回復時は保留が有力だが、短い期限と回復なしでは順序維持が有利', () => {
    const rows = compareHoldStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    expect(rows.slice(0, 4).map((r) => r.result.netValue)).toEqual([8, 18, 7, 5]);
    expect(rows.slice(4, 8).map((r) => r.result.netValue)).toEqual([8, 4, 7, 5]);
    expect(rows.slice(8).map((r) => r.result.netValue)).toEqual([8, 6, 7, 5]);
    expect(rows[1].result.jobs[0].completedTick).toBe(4);
    expect(rows[5].result.value).toBe(10);
  });
  it('毎入力JSON保存再開と再生が一致し、元状態を変えない', () => {
    for (const row of compareHoldStrategies(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeHold(live)).toEqual(row.result);
    }
  });
  it('容量・末尾・担当・着手後の中断は規則として効き、未着手の保留は中断費用を払わない', () => {
    const capacity = create('RI-173', 6, 1, { ...baselineHoldRules, holdCapacity: 2 });
    const two = apply(apply(capacity, { type: 'hold', id: 'hard' }), {
      type: 'hold',
      id: 'easy-a',
    });
    expect(two.jobs.filter((job) => job.stage === 'held').map((job) => job.id)).toEqual([
      'hard',
      'easy-a',
    ]);
    expect(summarizeHold(two)).toMatchObject({
      heldCount: 2,
      doneCount: 0,
      value: 0,
      unfinishedValue: 24,
    });
    const origin = apply(
      apply(create('RI-173', 6, 1, baselineHoldRules), { type: 'hold', id: 'hard' }),
      { type: 'resume', id: 'hard' },
    );
    expect(apply(origin, { type: 'tick' }).jobs[0]).toMatchObject({ id: 'hard', reviewLeft: 1 });
    const tail = apply(
      apply(create('RI-173', 6, 1, { ...baselineHoldRules, returnPosition: 'tail' }), {
        type: 'hold',
        id: 'hard',
      }),
      { type: 'resume', id: 'hard' },
    );
    expect(tail.jobs.map((job) => job.id)).toEqual(['easy-a', 'easy-b', 'hard']);
    expect(apply(tail, { type: 'tick' }).jobs[0]).toMatchObject({ id: 'easy-a', stage: 'done' });
    const parallel = apply(create('RI-173', 6, 1, { ...baselineHoldRules, assignees: 2 }), {
      type: 'tick',
    });
    expect(parallel.jobs.map((job) => job.stage)).toEqual(['review', 'done', 'review']);
    const costly = create('RI-173', 6, 1, { ...baselineHoldRules, interruptCost: 1 });
    expect(apply(costly, { type: 'hold', id: 'hard' }).focusSpent).toBe(1);
    const interrupted = apply(apply(costly, { type: 'tick' }), { type: 'hold', id: 'hard' });
    expect(interrupted.focusSpent).toBe(2);
    expect(interrupted.jobs[0]).toMatchObject({
      stage: 'held',
      reviewLeft: 1,
      qualityCost: 12,
      value: 16,
    });
  });
  it('同じ盤面で要因を一つずつ動かしても保留とFIFOの優劣は反転しない', () => {
    const rows = compareHoldFactorReversals(factors.seed);
    expect(rows).toEqual(factors.results);
    const legacy = compareHoldStrategies(factors.seed).find(
      (row) => row.deadline === 6 && row.recovery === 1 && row.strategy === 'hold-recover',
    )!;
    const baseline = rows.find(
      (row) => row.factor === 'baseline' && row.strategy === 'hold-recover',
    )!;
    expect(baseline.inputs).toEqual(legacy.inputs);
    expect(baseline.result).toEqual(legacy.result);
    const reversed = [...new Set(rows.map((row) => row.factor))].filter((factor) => {
      const fifo = rows.find((row) => row.factor === factor && row.strategy === 'fifo')!;
      const hold = rows.find((row) => row.factor === factor && row.strategy === 'hold-recover')!;
      return fifo.result.netValue > hold.result.netValue;
    });
    expect(reversed).toEqual([]);
    expect(rows.map((row) => [row.factor, row.strategy, row.result.netValue])).toEqual([
      ['baseline', 'fifo', 8],
      ['baseline', 'hold-recover', 18],
      ['holdCapacity', 'fifo', 8],
      ['holdCapacity', 'hold-recover', 18],
      ['returnPosition', 'fifo', 8],
      ['returnPosition', 'hold-recover', 18],
      ['assignees', 'fifo', 8],
      ['assignees', 'hold-recover', 18],
      ['interruptCost', 'fifo', 8],
      ['interruptCost', 'hold-recover', 18],
    ]);
    const tail = rows.find(
      (row) => row.factor === 'returnPosition' && row.strategy === 'hold-recover',
    )!;
    expect(tail.result.jobs.map((job) => job.id)).toEqual(['easy-a', 'easy-b', 'hard']);
    for (const row of rows) {
      expect(row.initial).toMatchObject({ horizon: 6, recoveryPerTick: 1, version: 1 });
      expect(row.initial.jobs.map((job) => [job.id, job.value, job.reviewLeft])).toEqual([
        ['hard', 16, 2],
        ['easy-a', 4, 1],
        ['easy-b', 4, 1],
      ]);
      expect(row.initial.jobs[0].deadline).toBe(6);
      expect(row.result.heldCount).toBe(0);
      expect(row.result.unfinishedValue).toBe(0);
    }
  });
  it('要因比較も毎入力JSON保存再開と再生が一致し、期末で止まる', () => {
    for (const row of compareHoldFactorReversals(factors.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(live.tick).toBe(live.horizon);
      expect(summarizeHold(live)).toEqual(row.result);
    }
  });
});

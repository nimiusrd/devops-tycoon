import { describe, expect, it } from 'vitest';
import {
  applyHoldInput as apply,
  createHoldPrototype as create,
  compareHoldStrategies,
  summarizeHold,
} from './reviewHold';
import comparison from '../../docs/prototypes/review-hold-comparison.json';

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
});

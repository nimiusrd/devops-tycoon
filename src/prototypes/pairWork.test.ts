import { describe, expect, it } from 'vitest';
import {
  applyPairInput as apply,
  choosePairAction,
  comparePairStrategies,
  createPairPrototype as create,
  summarizePair,
} from './pairWork';
import comparison from '../../docs/prototypes/pair-work-comparison.json';

describe('RI-178 ペア作業', () => {
  it('ペアは2枠で進捗1だけ進み、空きが足りないと2件処理と両立しない', () => {
    const paired = apply(create('RI-178', 'routine'), { type: 'pair', id: 'r1' });
    expect(paired).toMatchObject({ freeSlots: 0 });
    expect(paired.jobs[0]).toMatchObject({ slots: 2, acquired: 2, released: 0, stage: 'active' });
    const worked = apply(paired, { type: 'tick' });
    expect(worked.jobs[0]).toMatchObject({ progress: 1, slots: 2 });
    expect(apply(paired, { type: 'solo', id: 'r2' })).toBe(paired);
    expect(apply(paired, { type: 'pair', id: 'r2' })).toBe(paired);
    const one = apply(create('RI-178', 'routine'), { type: 'solo', id: 'r1' });
    expect(apply(one, { type: 'pair', id: 'r2' })).toBe(one);
    const two = apply(one, { type: 'solo', id: 'r2' });
    expect(two.freeSlots).toBe(0);
    expect(apply(two, { type: 'solo', id: 'r3' })).toBe(two);
  });
  it('完了・中断・手戻りで確保した枠を一度だけ解放する', () => {
    let paired = apply(create('RI-178', 'complex'), { type: 'pair', id: 'c1' });
    paired = apply(apply(paired, { type: 'tick' }), { type: 'tick' });
    expect(paired.jobs[0]).toMatchObject({
      stage: 'done',
      progress: 2,
      acquired: 2,
      released: 2,
      slots: 0,
      reworkSpent: 0,
    });
    expect(paired.freeSlots).toBe(2);
    let stopped = apply(create('RI-178', 'complex'), { type: 'pair', id: 'c1' });
    stopped = apply(stopped, { type: 'tick' });
    stopped = apply(stopped, { type: 'interrupt', id: 'c1' });
    expect(stopped.jobs[0]).toMatchObject({
      stage: 'backlog',
      progress: 1,
      acquired: 2,
      released: 2,
      slots: 0,
    });
    expect(apply(stopped, { type: 'interrupt', id: 'c1' })).toBe(stopped);
    let solo = apply(create('RI-178', 'complex'), { type: 'solo', id: 'c1' });
    solo = apply(apply(solo, { type: 'tick' }), { type: 'tick' });
    expect(solo.jobs[0]).toMatchObject({
      stage: 'rework',
      acquired: 1,
      released: 0,
      reworkLeft: 2,
    });
    solo = apply(solo, { type: 'tick' });
    expect(solo.jobs[0].acquired).toBe(1);
    solo = apply(solo, { type: 'tick' });
    expect(solo.jobs[0]).toMatchObject({
      stage: 'done',
      acquired: 1,
      released: 1,
      reworkSpent: 2,
      slots: 0,
    });
    expect(solo.freeSlots).toBe(2);
  });
  it('未知ID・完了済み・手戻り以外の中断・期末は無消費で拒否する', () => {
    const initial = create('RI-178', 'routine');
    expect(apply(initial, { type: 'solo', id: 'missing' })).toBe(initial);
    expect(apply(initial, { type: 'interrupt', id: 'r1' })).toBe(initial);
    const done = apply(apply(apply(initial, { type: 'pair', id: 'r1' }), { type: 'tick' }), {
      type: 'tick',
    });
    expect(apply(done, { type: 'pair', id: 'r1' })).toBe(done);
    expect(apply(done, { type: 'solo', id: 'r1' })).toBe(done);
    const ended = { ...initial, tick: initial.horizon };
    expect(apply(ended, { type: 'tick' })).toBe(ended);
    expect(apply(ended, { type: 'pair', id: 'r1' })).toBe(ended);
  });
  it('複雑仕事はペア、定型仕事は単独の方が完成価値が高い', () => {
    const rows = comparePairStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const net = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.netValue;
    expect([net('complex', 'solo'), net('complex', 'pair')]).toEqual([28, 42]);
    expect([net('routine', 'solo'), net('routine', 'pair')]).toEqual([48, 24]);
    const complexPair = rows.find((row) => row.board === 'complex' && row.strategy === 'pair')!;
    const routinePair = rows.find((row) => row.board === 'routine' && row.strategy === 'pair')!;
    expect(complexPair.result).toMatchObject({
      doneCount: 3,
      reworkSpent: 0,
      acquired: 6,
      released: 6,
    });
    expect(routinePair.result).toMatchObject({ doneCount: 3, unfinishedValue: 24 });
    expect(
      rows.find((row) => row.board === 'complex' && row.strategy === 'solo')!.result.reworkSpent,
    ).toBe(4);
  });
  it('全入力の再生と毎入力JSON保存再開が一致し、枠の合計が容量と一致する', () => {
    for (const row of comparePairStrategies(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
        expect(choosePairAction(previous, row.strategy)).toEqual(input);
        expect(live.freeSlots + live.jobs.reduce((sum, job) => sum + job.slots, 0)).toBe(
          live.slotCapacity,
        );
      }
      expect(summarizePair(live)).toEqual(row.result);
    }
  });
});

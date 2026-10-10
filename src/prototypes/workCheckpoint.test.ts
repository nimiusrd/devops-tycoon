import { describe, expect, it } from 'vitest';
import {
  applyCheckpointInput as apply,
  chooseCheckpointAction,
  compareCheckpointStrategies,
  createCheckpointPrototype as create,
  summarizeCheckpoint,
} from './workCheckpoint';
import comparison from '../../docs/prototypes/work-checkpoint-comparison.json';

describe('RI-175 作業チェックポイント', () => {
  it('保存した進捗は再開で残り、intake再初期化では0に戻る', () => {
    const saved = apply(create('RI-175', 4), { type: 'checkpoint' });
    expect(saved.jobs[0]).toMatchObject({ id: 'feature', progress: 4, stage: 'saved' });
    const resumed = apply(saved, { type: 'resume' });
    expect(resumed.jobs[0]).toMatchObject({ progress: 4, stage: 'coding' });
    expect(resumed.tick).toBe(saved.tick + 1);
    const restarted = apply(saved, { type: 'restart', id: 'feature' });
    expect(restarted.jobs[0]).toMatchObject({ progress: 0, stage: 'coding' });
    expect(apply(saved, { type: 'start', id: 'feature' })).toBe(saved);
  });
  it('保存と再開を繰り返しても進捗は増えず、枠解放と集中力だけが変わる', () => {
    let state = create('RI-175', 4);
    for (let i = 0; i < 2; i++) {
      state = apply(state, { type: 'checkpoint' });
      expect(summarizeCheckpoint(state).slotFree).toBe(true);
      expect(state.jobs[0].progress).toBe(4);
      state = apply(state, { type: 'resume' });
      expect(state.jobs[0]).toMatchObject({ progress: 4, stage: 'coding' });
    }
    expect(state).toMatchObject({ tick: 4, focus: 0, focusSpent: 4 });
    expect(apply(state, { type: 'checkpoint' })).toBe(state);
    const opened = apply(create('RI-175', 4), { type: 'checkpoint' });
    const urgent = apply(opened, { type: 'start', id: 'urgent' });
    expect(urgent.tick).toBe(opened.tick);
    expect(urgent.jobs[1]).toMatchObject({ stage: 'coding', progress: 0 });
    expect(urgent.jobs[0]).toEqual(opened.jobs[0]);
  });
  it('進捗0・枠競合・未知ID・資源不足・期末は無消費で拒否する', () => {
    const initial = create('RI-175', 4);
    const empty = create('RI-175', 0);
    expect(apply(empty, { type: 'checkpoint' })).toBe(empty);
    expect(apply(empty, { type: 'reset' })).toBe(empty);
    const poor = { ...initial, focus: 0 };
    expect(apply(poor, { type: 'checkpoint' })).toBe(poor);
    const saved = apply(initial, { type: 'checkpoint' });
    const broke = { ...saved, focus: 0 };
    expect(apply(broke, { type: 'resume' })).toBe(broke);
    expect(apply(initial, { type: 'resume' })).toBe(initial);
    expect(apply(initial, { type: 'start', id: 'urgent' })).toBe(initial);
    expect(apply(initial, { type: 'start', id: 'missing' })).toBe(initial);
    expect(apply(initial, { type: 'restart', id: 'feature' })).toBe(initial);
    expect(apply(saved, { type: 'work' })).toBe(saved);
    expect(apply(saved, { type: 'restart', id: 'urgent' })).toBe(saved);
    const ended = { ...saved, tick: saved.horizon };
    for (const input of [
      { type: 'work' },
      { type: 'checkpoint' },
      { type: 'resume' },
      { type: 'reset' },
      { type: 'wait' },
      { type: 'start', id: 'urgent' },
    ] as const)
      expect(apply(ended, input)).toBe(ended);
  });
  it('完了間近は保存再開、初期段階は継続が有利で、再初期化は保存進捗を完成に使えない', () => {
    const rows = compareCheckpointStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const net = (progress: number, strategy: string) =>
      rows.find((row) => row.progress === progress && row.strategy === strategy)!.result.netValue;
    expect([net(4, 'continue'), net(4, 'checkpoint'), net(4, 'reset'), net(4, 'restart')]).toEqual([
      16, 34, 14, 13,
    ]);
    expect([net(1, 'continue'), net(1, 'checkpoint'), net(1, 'reset'), net(1, 'restart')]).toEqual([
      16, 12, 14, 13,
    ]);
    const near = rows.find((row) => row.progress === 4 && row.strategy === 'checkpoint')!;
    const early = rows.find((row) => row.progress === 1 && row.strategy === 'checkpoint')!;
    expect(near.result).toMatchObject({
      urgentCompletedTick: 3,
      featureStage: 'done',
      focusSpent: 2,
    });
    expect(early.result).toMatchObject({
      featureProgress: 5,
      featureStage: 'coding',
      unfinishedValue: 22,
    });
    expect(
      near.inputs.filter((input) => input.type === 'checkpoint' || input.type === 'resume'),
    ).toHaveLength(2);
  });
  it('期限後の完成は遅い価値になり、毎入力の保存再開と再生が一致する', () => {
    const rushed = create('RI-175', 5);
    rushed.jobs[0].deadline = 0;
    const done = apply(rushed, { type: 'work' });
    expect(done.jobs[0]).toMatchObject({ stage: 'done', completedTick: 1, progress: 6 });
    expect(summarizeCheckpoint(done)).toMatchObject({ value: 4, penalty: 0 });
    for (const row of compareCheckpointStrategies(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
        expect(chooseCheckpointAction(previous, row.strategy)).toEqual(input);
      }
      expect(summarizeCheckpoint(live)).toEqual(row.result);
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  applyCheckpointInput as apply,
  baselineCheckpointRules,
  chooseCheckpointAction,
  compareCheckpointFactorReversals,
  compareCheckpointStrategies,
  createCheckpointPrototype as create,
  summarizeCheckpoint,
  type CheckpointRules,
} from './workCheckpoint';
import comparison from '../../docs/prototypes/work-checkpoint-comparison.json';
import factors from '../../docs/prototypes/work-checkpoint-factor-comparison.json';

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

function changedKeys(rules: CheckpointRules): (keyof CheckpointRules)[] {
  return (Object.keys(baselineCheckpointRules) as (keyof CheckpointRules)[]).filter(
    (key) => rules[key] !== baselineCheckpointRules[key],
  );
}

describe('RI-175 要因を一つずつ動かした比較', () => {
  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareCheckpointFactorReversals();
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 'RI-175',
      progresses: [4, 1],
      horizon: 8,
      focus: 4,
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    });
    const nets = (axis: keyof typeof data.sweeps) =>
      data.sweeps[axis].map((item) => [
        item.parameter,
        item.boards.map((board) => [
          board.progress,
          board.runs.map((run) => run.result.netValue),
          board.preference,
        ]),
      ]);
    expect(nets('saveCapacity')).toEqual([
      [
        '0',
        [
          [4, [16, 12, 14], 'continue'],
          [1, [16, 12, 14], 'continue'],
        ],
      ],
      [
        '1',
        [
          [4, [16, 12, 14], 'continue'],
          [1, [16, 12, 14], 'continue'],
        ],
      ],
      [
        '2',
        [
          [4, [16, 16, 14], 'tie:continue,checkpoint'],
          [1, [16, 12, 14], 'continue'],
        ],
      ],
      [
        '3',
        [
          [4, [16, 34, 14], 'checkpoint'],
          [1, [16, 12, 14], 'continue'],
        ],
      ],
      [
        '4',
        [
          [4, [16, 34, 14], 'checkpoint'],
          [1, [16, 12, 14], 'continue'],
        ],
      ],
      [
        '5',
        [
          [4, [16, 34, 14], 'checkpoint'],
          [1, [16, 12, 14], 'continue'],
        ],
      ],
      [
        '6',
        [
          [4, [16, 34, 14], 'checkpoint'],
          [1, [16, 12, 14], 'continue'],
        ],
      ],
    ]);
    expect(nets('resumeTicks')).toEqual([
      [
        '0',
        [
          [4, [16, 34, 14], 'checkpoint'],
          [1, [16, 16, 14], 'tie:continue,checkpoint'],
        ],
      ],
      [
        '1',
        [
          [4, [16, 34, 14], 'checkpoint'],
          [1, [16, 12, 14], 'continue'],
        ],
      ],
      [
        '2',
        [
          [4, [16, 34, 14], 'checkpoint'],
          [1, [16, 12, 14], 'continue'],
        ],
      ],
      [
        '3',
        [
          [4, [16, 16, 14], 'tie:continue,checkpoint'],
          [1, [16, 12, 14], 'continue'],
        ],
      ],
      [
        '4',
        [
          [4, [16, 12, 14], 'continue'],
          [1, [16, 12, 14], 'continue'],
        ],
      ],
      [
        '5',
        [
          [4, [16, 12, 14], 'continue'],
          [1, [16, 12, 14], 'continue'],
        ],
      ],
    ]);
    expect(nets('urgentAppears')).toEqual([
      [
        '0',
        [
          [4, [16, 34, 14], 'checkpoint'],
          [1, [16, 12, 14], 'continue'],
        ],
      ],
      [
        '1',
        [
          [4, [16, 14, -6], 'continue'],
          [1, [16, -8, -6], 'continue'],
        ],
      ],
      [
        '2',
        [
          [4, [16, 16, 16], 'tie:continue,checkpoint,reset'],
          [1, [16, -8, -6], 'continue'],
        ],
      ],
      [
        '3',
        [
          [4, [16, 16, 16], 'tie:continue,checkpoint,reset'],
          [1, [16, -8, -6], 'continue'],
        ],
      ],
      [
        '4',
        [
          [4, [16, 16, 16], 'tie:continue,checkpoint,reset'],
          [1, [16, -8, -6], 'continue'],
        ],
      ],
      [
        '5',
        [
          [4, [16, 16, 16], 'tie:continue,checkpoint,reset'],
          [1, [16, 16, 16], 'tie:continue,checkpoint,reset'],
        ],
      ],
      [
        '6',
        [
          [4, [16, 16, 16], 'tie:continue,checkpoint,reset'],
          [1, [16, 16, 16], 'tie:continue,checkpoint,reset'],
        ],
      ],
    ]);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.progress,
        item.before.parameter,
        item.before.preference,
        item.after.parameter,
        item.after.preference,
      ]),
    ).toEqual([
      ['saveCapacity', 4, '1', 'continue', '2', 'tie:continue,checkpoint'],
      ['saveCapacity', 4, '2', 'tie:continue,checkpoint', '3', 'checkpoint'],
      ['resumeTicks', 1, '0', 'tie:continue,checkpoint', '1', 'continue'],
      ['resumeTicks', 4, '2', 'checkpoint', '3', 'tie:continue,checkpoint'],
      ['resumeTicks', 4, '3', 'tie:continue,checkpoint', '4', 'continue'],
      ['urgentAppears', 4, '0', 'checkpoint', '1', 'continue'],
      ['urgentAppears', 4, '1', 'continue', '2', 'tie:continue,checkpoint,reset'],
      ['urgentAppears', 1, '4', 'continue', '5', 'tie:continue,checkpoint,reset'],
    ]);
    expect(data.reversals.some((item) => item.axis === 'saveCapacity' && item.progress === 1)).toBe(
      false,
    );
    for (const board of Object.values(data.sweeps).flatMap((rows) =>
      rows.flatMap((item) => item.boards),
    )) {
      expect(board.preference).not.toBe('reset');
      expect(board.runs.find((run) => run.strategy === 'continue')?.result.netValue).toBe(16);
    }
  });

  it('基準行は初回の三手と一致し、動かした規則は一つである', () => {
    const data = compareCheckpointFactorReversals();
    const first = compareCheckpointStrategies(comparison.seed);
    for (const point of [
      data.sweeps.saveCapacity.find((item) => item.parameter === '6'),
      data.sweeps.resumeTicks.find((item) => item.parameter === '1'),
      data.sweeps.urgentAppears.find((item) => item.parameter === '0'),
    ]) {
      if (!point) throw new Error('baseline');
      expect(changedKeys(point.rules)).toEqual([]);
      for (const board of point.boards) {
        for (const run of board.runs) {
          const row = first.find(
            (item) => item.progress === board.progress && item.strategy === run.strategy,
          );
          if (!row) throw new Error('first');
          expect(run.inputs).toEqual(row.inputs);
          expect(run.result).toEqual(row.result);
        }
        expect(first.some((item) => item.strategy === 'restart')).toBe(true);
      }
    }
    const only: Record<string, keyof CheckpointRules> = {
      saveCapacity: 'saveCapacity',
      resumeTicks: 'resumeTicks',
      urgentAppears: 'urgentAppears',
    };
    for (const [axis, key] of Object.entries(only)) {
      for (const item of data.sweeps[axis as keyof typeof data.sweeps])
        expect(changedKeys(item.rules).every((name) => name === key)).toBe(true);
    }
    const lateSave = data.sweeps.saveCapacity.find((item) => item.parameter === '2');
    const onTimeSave = data.sweeps.saveCapacity.find((item) => item.parameter === '3');
    expect(
      lateSave?.boards
        .find((board) => board.progress === 4)
        ?.runs.find((run) => run.strategy === 'checkpoint')?.result,
    ).toMatchObject({ value: 18, urgentCompletedTick: 3, focusSpent: 2, netValue: 16 });
    expect(
      onTimeSave?.boards
        .find((board) => board.progress === 4)
        ?.runs.find((run) => run.strategy === 'checkpoint')?.result,
    ).toMatchObject({ value: 36, urgentCompletedTick: 3, focusSpent: 2, netValue: 34 });
    const empty = data.sweeps.saveCapacity.find((item) => item.parameter === '0');
    const kept = data.sweeps.saveCapacity.find((item) => item.parameter === '1');
    expect(
      empty?.boards
        .find((board) => board.progress === 1)
        ?.runs.find((run) => run.strategy === 'checkpoint')?.result.featureProgress,
    ).toBe(4);
    expect(
      kept?.boards
        .find((board) => board.progress === 1)
        ?.runs.find((run) => run.strategy === 'checkpoint')?.result.featureProgress,
    ).toBe(5);
    const freeResume = data.sweeps.resumeTicks.find((item) => item.parameter === '0');
    const slowResume = data.sweeps.resumeTicks.find((item) => item.parameter === '3');
    expect(
      freeResume?.boards
        .find((board) => board.progress === 1)
        ?.runs.find((run) => run.strategy === 'checkpoint')?.result,
    ).toMatchObject({ value: 18, featureStage: 'done', focusSpent: 2, netValue: 16 });
    expect(
      slowResume?.boards
        .find((board) => board.progress === 4)
        ?.runs.find((run) => run.strategy === 'checkpoint')
        ?.inputs.filter((input) => input.type === 'resume'),
    ).toHaveLength(3);
    expect(
      slowResume?.boards
        .find((board) => board.progress === 4)
        ?.runs.find((run) => run.strategy === 'checkpoint')?.result.focusSpent,
    ).toBe(2);
    const seenLate = data.sweeps.urgentAppears.find((item) => item.parameter === '1');
    const nearLate = seenLate?.boards.find((board) => board.progress === 4);
    expect(nearLate?.runs.find((run) => run.strategy === 'checkpoint')?.result).toMatchObject({
      urgentCompletedTick: 4,
      penalty: 6,
      focusSpent: 2,
      netValue: 14,
    });
    expect(nearLate?.runs.find((run) => run.strategy === 'reset')?.result).toMatchObject({
      featureProgress: 4,
      penalty: 6,
      netValue: -6,
    });
    const converged = data.sweeps.urgentAppears.find((item) => item.parameter === '5');
    const early = converged?.boards.find((board) => board.progress === 1);
    expect(early?.runs[0]?.inputs).toEqual(early?.runs[1]?.inputs);
    expect(early?.runs[1]?.inputs).toEqual(early?.runs[2]?.inputs);
  });

  it('容量は超えた進捗だけを捨て、長い再開は集中力を重ねず、緊急は出現tickまで出ない', () => {
    const cappedRules = { ...baselineCheckpointRules, saveCapacity: 2 };
    const capped = apply(create('RI-175', 4, cappedRules), { type: 'checkpoint' }, cappedRules);
    expect(capped.jobs[0]).toMatchObject({ progress: 2, stage: 'saved' });
    const resumed = apply(capped, { type: 'resume' }, cappedRules);
    const again = apply(resumed, { type: 'checkpoint' }, cappedRules);
    expect(again.jobs[0]).toMatchObject({ progress: 2, stage: 'saved' });
    expect(again.focusSpent).toBe(3);

    const slowRules = { ...baselineCheckpointRules, resumeTicks: 3 };
    let slow = apply(create('RI-175', 4, slowRules), { type: 'checkpoint' }, slowRules);
    for (let count = 0; count < 2; count += 1) {
      slow = apply(slow, { type: 'resume' }, slowRules);
      expect(slow.jobs[0]).toMatchObject({ progress: 4, stage: 'saved' });
    }
    slow = apply(slow, { type: 'resume' }, slowRules);
    expect(slow).toMatchObject({ tick: 4, focus: 2, focusSpent: 2 });
    expect(slow.jobs[0]).toMatchObject({ progress: 4, stage: 'coding' });
    expect('resumeLeft' in slow).toBe(false);

    const freeRules = { ...baselineCheckpointRules, resumeTicks: 0 };
    const opened = apply(create('RI-175', 4, freeRules), { type: 'checkpoint' }, freeRules);
    const instant = apply(opened, { type: 'resume' }, freeRules);
    expect(instant.tick).toBe(opened.tick);
    expect(instant.jobs[0]).toMatchObject({ progress: 4, stage: 'coding' });
    expect(instant.focusSpent).toBe(2);

    const lateRules = { ...baselineCheckpointRules, urgentAppears: 2 };
    const hidden = create('RI-175', 4, lateRules);
    expect(hidden.jobs[1]).toMatchObject({ stage: 'upcoming', deadline: 3 });
    const once = apply(hidden, { type: 'work' }, lateRules);
    expect(once).toMatchObject({ tick: 1 });
    expect(once.jobs[1]?.stage).toBe('upcoming');
    const twice = apply(once, { type: 'work' }, lateRules);
    expect(twice.tick).toBe(2);
    expect(twice.jobs[1]?.stage).toBe('backlog');
    expect(twice.jobs[1]?.deadline).toBe(3);
  });

  it('要因比較の入力を再生すると差引が一致し、期末では同じ状態を返す', () => {
    const data = compareCheckpointFactorReversals();
    for (const item of Object.values(data.sweeps).flat()) {
      for (const board of item.boards) {
        for (const run of board.runs) {
          let state = create(data.conditions.seed, board.progress, item.rules);
          const snapshot = structuredClone(state);
          for (const input of run.inputs) {
            const previous = state;
            const before = structuredClone(state);
            expect(chooseCheckpointAction(state, run.strategy)).toEqual(input);
            state = apply(state, input, item.rules);
            const restored = apply(JSON.parse(JSON.stringify(before)), input, item.rules);
            expect(previous).toEqual(before);
            expect(restored).toEqual(state);
          }
          expect(snapshot.tick).toBe(0);
          expect(summarizeCheckpoint(state)).toEqual(run.result);
          expect(state.inputs).toEqual(run.inputs);
          expect(state.tick).toBe(state.horizon);
          expect(apply(state, { type: 'wait' }, item.rules)).toBe(state);
        }
      }
    }
  });
});

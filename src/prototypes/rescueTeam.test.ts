import { describe, expect, it } from 'vitest';
import {
  applyRescueTeam as apply,
  availableCapacity,
  baselineRescueRules,
  chooseRescueAction,
  compareRescueFactorReversals,
  compareRescueTeams,
  createRescueTeam as create,
  summarizeRescueTeam,
  viewRescueTeam,
  type RescueFactorRules,
} from './rescueTeam';
import comparison from '../../docs/prototypes/rescue-team-comparison.json';
import factors from '../../docs/prototypes/rescue-team-factor-comparison.json';

describe('RI-224 期間限定の救援チーム', () => {
  it('派遣元、派遣量、救援期間、元チームの余力を操作前に示す', () => {
    const first = create('RI-224', 'deadline');
    expect(create('RI-224', 'deadline')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewRescueTeam(first);
    for (let i = 0; i < 8; i++) expect(viewRescueTeam(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toMatchObject({ phase: 'plan', duration: 1, incidentLeft: 4 });
    expect(blank.teams).toEqual([
      { id: 'alpha', capacity: 4, output: 6, loaned: 0, available: 4 },
      { id: 'bravo', capacity: 4, output: 2, loaned: 0, available: 4 },
      { id: 'spare', capacity: 4, output: 2, loaned: 0, available: 4 },
    ]);
    expect(blank.plans.find((plan) => plan.strategy === 'focus')).toMatchObject({
      loans: { alpha: 0, bravo: 0, spare: 4 },
      recovery: 4,
      duration: 1,
    });
  });

  it('貸し出した余力を元チームで使わず、終了と中断は一度だけ返す', () => {
    const fresh = create('RI-224', 'local');
    expect(apply(fresh, { type: 'dispatch', loans: { alpha: 0, bravo: 0, spare: 5 } })).toBe(fresh);
    expect(apply(fresh, { type: 'resolve' })).toBe(fresh);
    const sent = apply(fresh, { type: 'dispatch', loans: { alpha: 0, bravo: 0, spare: 4 } });
    const pool = sent.teams.reduce((sum, team) => sum + team.loaned, 0);
    const available = sent.teams.reduce((sum, team) => sum + availableCapacity(team), 0);
    expect(pool).toBe(4);
    expect(pool + available).toBe(12);
    const worked = apply(sent, { type: 'resolve' });
    expect(worked.shipped).toBe(16);
    expect(worked.recovered).toBe(4);
    const back = apply(worked, { type: 'return' });
    expect(back.teams.every((team) => team.loaned === 0)).toBe(true);
    expect(back.returned).toBe(true);
    expect(back.shipped).toBe(40);
    expect(apply(back, { type: 'return' })).toBe(back);
    expect(apply(back, { type: 'resolve' })).toBe(back);

    const cancelled = apply(sent, { type: 'return' });
    expect(cancelled).toMatchObject({ recovered: 0, returned: true, penalty: 20, shipped: 24 });
    expect(cancelled.teams.every((team) => team.loaned === 0)).toBe(true);
    expect(apply(cancelled, { type: 'return' })).toBe(cancelled);
    expect(apply(sent, { type: 'view' })).toBe(sent);
  });

  it('収まる障害は集中、足りない障害は分散、納期チームを削る均等派遣は見送りが上回る', () => {
    const rows = compareRescueTeams(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([score('local', 'focus'), score('local', 'spread'), score('local', 'none')]).toEqual([
      40, 36, 28,
    ]);
    expect([score('wide', 'spread'), score('wide', 'focus'), score('wide', 'none')]).toEqual([
      36, 28, 12,
    ]);
    expect([
      score('deadline', 'focus'),
      score('deadline', 'none'),
      score('deadline', 'spread'),
    ]).toEqual([72, 68, 60]);
    for (const row of rows) {
      expect(row.result.returned).toBe(true);
      expect(row.result.loaned).toEqual([
        { id: 'alpha', loaned: 0 },
        { id: 'bravo', loaned: 0 },
        { id: 'spare', loaned: 0 },
      ]);
      expect(row.result.lost).toBe(false);
    }
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareRescueTeams(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseRescueAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeRescueTeam(live)).toEqual(row.result);
    }
  });
});

function changedKeys(rules: RescueFactorRules): (keyof RescueFactorRules)[] {
  return (Object.keys(baselineRescueRules) as (keyof RescueFactorRules)[]).filter(
    (key) => rules[key] !== baselineRescueRules[key],
  );
}

describe('RI-224 要因の反転', () => {
  it('感度の初期状態は基準の盤面を書き換えない', () => {
    const rules = { ...baselineRescueRules, duration: 4, capacity: 8, penaltyEach: 0 };
    const shifted = create('RI-224', 'wide', rules);
    expect(shifted).toMatchObject({ duration: 4, horizon: 6, penaltyEach: 0, incident: 6 });
    expect(shifted.teams.every((team) => team.capacity === 8)).toBe(true);
    expect(create('RI-224', 'wide')).toMatchObject({ duration: 1, horizon: 3, penaltyEach: 6 });
    expect(create('RI-224', 'local').teams[0]?.capacity).toBe(4);
    const before = structuredClone(create('RI-224', 'deadline'));
    for (let i = 0; i < 4; i++) expect(viewRescueTeam(before).duration).toBe(1);
    expect(create('RI-224', 'deadline')).toEqual(before);
    const sent = apply(create('RI-224', 'local'), {
      type: 'dispatch',
      loans: { alpha: 0, bravo: 0, spare: 4 },
    });
    const worked = apply(sent, { type: 'resolve' });
    expect(apply(worked, { type: 'continue' })).toBe(worked);
    const room = create('RI-224', 'wide', { ...baselineRescueRules, capacity: 6 });
    expect(apply(room, { type: 'dispatch', loans: { alpha: 0, bravo: 0, spare: 7 } })).toBe(room);
    const accepted = apply(room, {
      type: 'dispatch',
      loans: { alpha: 0, bravo: 0, spare: 6 },
    });
    expect(accepted.teams.find((team) => team.id === 'spare')?.loaned).toBe(6);
  });

  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareRescueFactorReversals();
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 'RI-224',
      teams: ['alpha', 'bravo', 'spare'],
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    });
    const scores = (axis: keyof typeof data.sweeps) =>
      data.sweeps[axis].map((item) => [
        item.parameter,
        item.boards.map((board) => [
          board.board,
          board.focus.result.score,
          board.spread.result.score,
          board.preference,
        ]),
      ]);
    expect(scores('duration')).toEqual([
      [
        '1',
        [
          ['local', 40, 36, 'focus'],
          ['wide', 28, 36, 'spread'],
          ['deadline', 72, 60, 'focus'],
        ],
      ],
      [
        '2',
        [
          ['local', 56, 48, 'focus'],
          ['wide', 44, 48, 'spread'],
          ['deadline', 104, 80, 'focus'],
        ],
      ],
      [
        '3',
        [
          ['local', 72, 60, 'focus'],
          ['wide', 60, 60, 'tie'],
          ['deadline', 136, 100, 'focus'],
        ],
      ],
      [
        '4',
        [
          ['local', 88, 72, 'focus'],
          ['wide', 76, 72, 'focus'],
          ['deadline', 168, 120, 'focus'],
        ],
      ],
      [
        '5',
        [
          ['local', 104, 84, 'focus'],
          ['wide', 92, 84, 'focus'],
          ['deadline', 200, 140, 'focus'],
        ],
      ],
    ]);
    expect(scores('capacity')).toEqual([
      [
        '1',
        [
          ['local', -5, 1, 'spread'],
          ['wide', -20, -12, 'spread'],
          ['deadline', 9, 7, 'focus'],
        ],
      ],
      [
        '2',
        [
          ['local', 10, 12, 'spread'],
          ['wide', -4, 12, 'spread'],
          ['deadline', 30, 20, 'focus'],
        ],
      ],
      [
        '3',
        [
          ['local', 25, 24, 'focus'],
          ['wide', 12, 24, 'spread'],
          ['deadline', 51, 40, 'focus'],
        ],
      ],
      [
        '4',
        [
          ['local', 40, 36, 'focus'],
          ['wide', 28, 36, 'spread'],
          ['deadline', 72, 60, 'focus'],
        ],
      ],
      [
        '5',
        [
          ['local', 52, 48, 'focus'],
          ['wide', 44, 48, 'spread'],
          ['deadline', 92, 80, 'focus'],
        ],
      ],
      [
        '6',
        [
          ['local', 64, 60, 'focus'],
          ['wide', 60, 60, 'tie'],
          ['deadline', 112, 100, 'focus'],
        ],
      ],
      [
        '7',
        [
          ['local', 76, 72, 'focus'],
          ['wide', 72, 72, 'tie'],
          ['deadline', 132, 120, 'focus'],
        ],
      ],
      [
        '8',
        [
          ['local', 88, 84, 'focus'],
          ['wide', 84, 84, 'tie'],
          ['deadline', 152, 140, 'focus'],
        ],
      ],
    ]);
    expect(scores('penaltyEach')).toEqual([
      [
        '0',
        [
          ['local', 40, 36, 'focus'],
          ['wide', 40, 36, 'focus'],
          ['deadline', 72, 60, 'focus'],
        ],
      ],
      [
        '1',
        [
          ['local', 40, 36, 'focus'],
          ['wide', 38, 36, 'focus'],
          ['deadline', 72, 60, 'focus'],
        ],
      ],
      [
        '2',
        [
          ['local', 40, 36, 'focus'],
          ['wide', 36, 36, 'tie'],
          ['deadline', 72, 60, 'focus'],
        ],
      ],
      [
        '3',
        [
          ['local', 40, 36, 'focus'],
          ['wide', 34, 36, 'spread'],
          ['deadline', 72, 60, 'focus'],
        ],
      ],
      [
        '4',
        [
          ['local', 40, 36, 'focus'],
          ['wide', 32, 36, 'spread'],
          ['deadline', 72, 60, 'focus'],
        ],
      ],
      [
        '5',
        [
          ['local', 40, 36, 'focus'],
          ['wide', 30, 36, 'spread'],
          ['deadline', 72, 60, 'focus'],
        ],
      ],
      [
        '6',
        [
          ['local', 40, 36, 'focus'],
          ['wide', 28, 36, 'spread'],
          ['deadline', 72, 60, 'focus'],
        ],
      ],
      [
        '7',
        [
          ['local', 40, 36, 'focus'],
          ['wide', 26, 36, 'spread'],
          ['deadline', 72, 60, 'focus'],
        ],
      ],
      [
        '8',
        [
          ['local', 40, 36, 'focus'],
          ['wide', 24, 36, 'spread'],
          ['deadline', 72, 60, 'focus'],
        ],
      ],
    ]);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.board,
        item.before.parameter,
        item.before.preference,
        item.after.parameter,
        item.after.preference,
      ]),
    ).toEqual([
      ['duration', 'wide', '2', 'spread', '3', 'tie'],
      ['duration', 'wide', '3', 'tie', '4', 'focus'],
      ['capacity', 'local', '2', 'spread', '3', 'focus'],
      ['capacity', 'wide', '5', 'spread', '6', 'tie'],
      ['penaltyEach', 'wide', '1', 'focus', '2', 'tie'],
      ['penaltyEach', 'wide', '2', 'tie', '3', 'spread'],
    ]);
  });

  it('基準行は初回の集中と分散に一致し、動かした規則は一つである', () => {
    const data = compareRescueFactorReversals();
    const first = compareRescueTeams(comparison.seed);
    const matchBoard = (
      point: (typeof data.sweeps.duration)[number] | undefined,
      board: 'local' | 'wide' | 'deadline',
    ) => {
      if (!point) throw new Error('baseline');
      const row = point.boards.find((item) => item.board === board);
      if (!row) throw new Error(board);
      for (const strategy of ['focus', 'spread'] as const) {
        const expected = first.find((item) => item.board === board && item.strategy === strategy);
        if (!expected) throw new Error(strategy);
        expect(row[strategy].initial).toEqual(expected.initial);
        expect(row[strategy].inputs).toEqual(expected.inputs);
        expect(row[strategy].result).toEqual(expected.result);
      }
    };
    for (const point of [
      data.sweeps.duration.find((item) => item.parameter === '1'),
      data.sweeps.capacity.find((item) => item.parameter === '4'),
    ]) {
      if (!point) throw new Error('baseline');
      expect(changedKeys(point.rules)).toEqual([]);
      matchBoard(point, 'local');
      matchBoard(point, 'wide');
      matchBoard(point, 'deadline');
    }
    const penalties = data.sweeps.penaltyEach;
    expect(
      changedKeys(penalties.find((item) => item.parameter === '5')?.rules ?? baselineRescueRules),
    ).toEqual(['penaltyEach']);
    matchBoard(
      penalties.find((item) => item.parameter === '5'),
      'local',
    );
    matchBoard(
      penalties.find((item) => item.parameter === '6'),
      'wide',
    );
    matchBoard(
      penalties.find((item) => item.parameter === '3'),
      'deadline',
    );
    const only: Record<string, keyof RescueFactorRules> = {
      duration: 'duration',
      capacity: 'capacity',
      penaltyEach: 'penaltyEach',
    };
    for (const [axis, key] of Object.entries(only)) {
      for (const item of data.sweeps[axis as keyof typeof data.sweeps])
        expect(changedKeys(item.rules).every((name) => name === key)).toBe(true);
    }
    const wideHold = data.sweeps.duration
      .find((item) => item.parameter === '3')
      ?.boards.find((board) => board.board === 'wide');
    expect(wideHold?.focus.inputs.map((input) => input.type)).toEqual([
      'dispatch',
      'resolve',
      'continue',
      'continue',
      'return',
    ]);
    expect(wideHold?.focus.result).toMatchObject({
      recovered: 4,
      incidentLeft: 2,
      penalty: 12,
      shipped: 72,
      score: 60,
      returned: true,
    });
    expect(wideHold?.spread.result).toMatchObject({
      recovered: 6,
      incidentLeft: 0,
      penalty: 0,
      shipped: 60,
      score: 60,
    });
    const wideRoom = data.sweeps.capacity
      .find((item) => item.parameter === '6')
      ?.boards.find((board) => board.board === 'wide');
    expect(wideRoom?.focus.inputs[0]).toEqual({
      type: 'dispatch',
      loans: { alpha: 0, bravo: 0, spare: 6 },
    });
    expect(wideRoom?.spread.inputs[0]).toEqual({
      type: 'dispatch',
      loans: { alpha: 2, bravo: 2, spare: 2 },
    });
    expect(wideRoom?.preference).toBe('tie');
    for (const point of data.sweeps.penaltyEach) {
      expect(point.boards.map((board) => board.focus.result.recovered)).toEqual([4, 4, 4]);
      expect(point.boards.map((board) => board.spread.result.recovered)).toEqual([4, 6, 4]);
    }
  });

  it('要因比較の入力を再生すると差引が一致し、期末では同じ状態を返す', () => {
    const data = compareRescueFactorReversals();
    for (const item of Object.values(data.sweeps).flat()) {
      for (const board of item.boards) {
        for (const strategy of ['focus', 'spread'] as const) {
          const run = board[strategy];
          let state = run.initial;
          for (const input of run.inputs) {
            const previous = state;
            const before = structuredClone(state);
            expect(chooseRescueAction(state, strategy)).toEqual(input);
            state = apply(state, input);
            const restored = apply(JSON.parse(JSON.stringify(before)), input);
            expect(previous).toEqual(before);
            expect(restored).toEqual(state);
            expect(state.shipped - state.penalty).toBe(summarizeRescueTeam(state).score);
          }
          expect(summarizeRescueTeam(state)).toEqual(run.result);
          expect(state.inputs).toEqual(run.inputs);
          expect(apply(state, { type: 'continue' })).toBe(state);
          expect(apply(state, { type: 'resolve' })).toBe(state);
          expect(apply(state, { type: 'return' })).toBe(state);
          expect(state.seed).toBe('RI-224');
        }
      }
    }
  });
});

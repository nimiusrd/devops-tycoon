import { describe, expect, it } from 'vitest';
import {
  applyRoleChallengeInput as apply,
  baselineChallengeFactorRules,
  chooseRoleChallengeAction,
  compareRoleChallengeFactorReversals,
  compareRoleChallenges,
  createRoleChallengePrototype as create,
  summarizeRoleChallenge,
  viewRoleChallenge,
  type ChallengeBoard,
  type ChallengeFactorRules,
  type ChallengeStrategy,
} from './roleChallenge';
import comparison from '../../docs/prototypes/role-challenge-comparison.json';
import factors from '../../docs/prototypes/role-challenge-factor-comparison.json';

describe('RI-202 本人が望む挑戦', () => {
  it('誰がどの担当を望み、現在値と次期の見通しを配置前に示す', () => {
    const first = create('RI-202', 'pressed');
    expect(create('RI-202', 'pressed')).toEqual(first);
    expect(create('other', 'slack').board).toBe('slack');
    const before = structuredClone(first);
    const blank = viewRoleChallenge(first);
    for (let i = 0; i < 10; i++) expect(viewRoleChallenge(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toMatchObject({
      seats: 1,
      targets: [8, 4],
      wish: { id: 'mei', role: 'review', review: 2, outlook: 5, assignment: null },
      senior: { id: 'sato', review: 8, assignment: 'review' },
    });
  });

  it('レビューへ置いた期だけ成長し、コーディング配置のままでは増えない', () => {
    let accepted = apply(create('RI-202', 'slack'), { type: 'place', assignment: 'review' });
    expect(accepted.members.find((item) => item.id === 'sato')?.assignment).toBe('review');
    accepted = apply(accepted, { type: 'period' });
    expect(summarizeRoleChallenge(accepted)).toMatchObject({
      assignment: 'review',
      meiReview: 5,
      growth: 3,
      growthEvents: 1,
      reviewValue: 10,
    });
    accepted = apply(accepted, { type: 'period' });
    expect(accepted.growthEvents).toBe(1);
    expect(accepted.members.find((item) => item.id === 'mei')?.review).toBe(5);

    const declined = apply(
      apply(create('RI-202', 'slack'), { type: 'place', assignment: 'coding' }),
      { type: 'period' },
    );
    expect(summarizeRoleChallenge(declined)).toMatchObject({
      assignment: 'coding',
      meiReview: 2,
      growth: 0,
      growthEvents: 0,
      reviewValue: 8,
    });
  });

  it('未配置の進行、担当外の値、二度目の配置、期末は無消費で拒否する', () => {
    const initial = create('RI-202', 'pressed');
    expect(apply(initial, { type: 'period' })).toBe(initial);
    expect(apply(initial, { type: 'place', assignment: 'lead' })).toBe(initial);
    const placed = apply(initial, { type: 'place', assignment: 'review' });
    expect(memberAssignment(placed, 'sato')).toBe('coding');
    expect(apply(placed, { type: 'place', assignment: 'coding' })).toBe(placed);
    let ended = placed;
    while (ended.period < ended.horizon) ended = apply(ended, { type: 'period' });
    expect(apply(ended, { type: 'period' })).toBe(ended);
    expect(apply(ended, { type: 'place', assignment: 'coding' })).toBe(ended);
  });

  it('主力不足では見送り、余力があるときは受諾の差引が上回る', () => {
    const rows = compareRoleChallenges(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([score('pressed', 'accept'), score('pressed', 'decline')]).toEqual([1, 16]);
    expect([score('slack', 'accept'), score('slack', 'decline')]).toEqual([23, 10]);
    const declined = rows.find((row) => row.board === 'pressed' && row.strategy === 'decline')!;
    expect(declined.result.reviewValue).toBeGreaterThan(0);
    expect(declined.result.growth).toBe(0);
    const accepted = rows.find((row) => row.board === 'slack' && row.strategy === 'accept')!.result;
    expect(accepted.history.map((item) => item.met)).toEqual([true, true]);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareRoleChallenges(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseRoleChallengeAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeRoleChallenge(live)).toEqual(row.result);
    }
  });
});

function memberAssignment(
  state: ReturnType<typeof create>,
  id: string,
): 'review' | 'coding' | null | undefined {
  return state.members.find((item) => item.id === id)?.assignment;
}

function changedKeys(rules: ChallengeFactorRules): (keyof ChallengeFactorRules)[] {
  return (Object.keys(baselineChallengeFactorRules) as (keyof ChallengeFactorRules)[]).filter(
    (key) => rules[key] !== baselineChallengeFactorRules[key],
  );
}

function preferenceOf(accept: number, decline: number): 'accept' | 'decline' | 'tie' {
  if (accept > decline) return 'accept';
  if (decline > accept) return 'decline';
  return 'tie';
}

function scoreOf(
  board: ChallengeBoard,
  strategy: ChallengeStrategy,
  patch: { outlook?: number; seats?: number; penalty?: number },
) {
  let state = create('RI-202', board);
  if (patch.seats !== undefined) state = { ...state, seats: patch.seats };
  if (patch.penalty !== undefined) state = { ...state, penalty: patch.penalty };
  const outlook = patch.outlook ?? 5;
  let guard = 0;
  while (state.period < state.horizon) {
    if (++guard > 10) throw new Error(`${board}:${strategy}`);
    const next = apply(state, chooseRoleChallengeAction(state, strategy), { outlook });
    if (next === state) throw new Error(`${board}:${strategy}@${state.period}`);
    state = next;
  }
  return summarizeRoleChallenge(state).score;
}

describe('RI-202 要因の反転', () => {
  it('閲覧へ渡した見通しは状態を変えず、省略時は5のまま', () => {
    const first = create('RI-202', 'pressed');
    const before = structuredClone(first);
    expect(viewRoleChallenge(first).wish.outlook).toBe(5);
    expect(viewRoleChallenge(first, { outlook: 21 }).wish.outlook).toBe(21);
    expect(first).toEqual(before);
    expect(Object.keys(first)).not.toContain('outlook');
  });

  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareRoleChallengeFactorReversals();
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 'RI-202',
      horizon: 2,
      satoReview: 8,
      meiReview: 2,
      targets: { pressed: [8, 4], slack: [6, 12] },
      baselineSeats: { pressed: 1, slack: 2 },
      baselinePenalty: { pressed: 6, slack: 6 },
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
          board.accept.result.score,
          board.decline.result.score,
          board.preference,
        ]),
      ]);
    expect(scores('outlook')).toEqual([
      [
        '2',
        [
          ['pressed', -8, 16, 'decline'],
          ['slack', 14, 10, 'accept'],
        ],
      ],
      [
        '4',
        [
          ['pressed', 0, 16, 'decline'],
          ['slack', 22, 10, 'accept'],
        ],
      ],
      [
        '5',
        [
          ['pressed', 1, 16, 'decline'],
          ['slack', 23, 10, 'accept'],
        ],
      ],
      [
        '19',
        [
          ['pressed', 15, 16, 'decline'],
          ['slack', 37, 10, 'accept'],
        ],
      ],
      [
        '20',
        [
          ['pressed', 16, 16, 'tie'],
          ['slack', 38, 10, 'accept'],
        ],
      ],
      [
        '21',
        [
          ['pressed', 17, 16, 'accept'],
          ['slack', 39, 10, 'accept'],
        ],
      ],
    ]);
    expect(scores('seats')).toEqual([
      [
        '1',
        [
          ['pressed', 1, 16, 'decline'],
          ['slack', -5, 10, 'decline'],
        ],
      ],
      [
        '2',
        [
          ['pressed', 23, 16, 'accept'],
          ['slack', 23, 10, 'accept'],
        ],
      ],
      [
        '3',
        [
          ['pressed', 23, 16, 'accept'],
          ['slack', 23, 10, 'accept'],
        ],
      ],
      [
        '4',
        [
          ['pressed', 23, 16, 'accept'],
          ['slack', 23, 10, 'accept'],
        ],
      ],
    ]);
    expect(scores('penalty')).toEqual([
      [
        '0',
        [
          ['pressed', 7, 16, 'decline'],
          ['slack', 23, 16, 'accept'],
        ],
      ],
      [
        '6',
        [
          ['pressed', 1, 16, 'decline'],
          ['slack', 23, 10, 'accept'],
        ],
      ],
      [
        '12',
        [
          ['pressed', -5, 16, 'decline'],
          ['slack', 23, 4, 'accept'],
        ],
      ],
    ]);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.board,
        item.before.parameter,
        item.before.preference,
        item.before.accept,
        item.before.decline,
        item.after.parameter,
        item.after.preference,
        item.after.accept,
        item.after.decline,
      ]),
    ).toEqual([
      ['outlook', 'pressed', '19', 'decline', 15, 16, '20', 'tie', 16, 16],
      ['outlook', 'pressed', '20', 'tie', 16, 16, '21', 'accept', 17, 16],
      ['seats', 'pressed', '1', 'decline', 1, 16, '2', 'accept', 23, 16],
      ['seats', 'slack', '1', 'decline', -5, 10, '2', 'accept', 23, 10],
    ]);
    expect(data.reversals.some((item) => item.axis === 'penalty')).toBe(false);
    expect(data.reversals.some((item) => item.axis === 'outlook' && item.board === 'slack')).toBe(
      false,
    );
  });

  it('基準行は初回の入力と差引に一致し、動かした規則は一つである', () => {
    const data = compareRoleChallengeFactorReversals();
    const first = compareRoleChallenges(comparison.seed);
    const same = (
      board: ChallengeBoard,
      strategy: ChallengeStrategy,
      run: { inputs: (typeof first)[number]['inputs']; result: (typeof first)[number]['result'] },
    ) => {
      const row = first.find((item) => item.board === board && item.strategy === strategy);
      if (!row) throw new Error(`${board}:${strategy}`);
      expect(run.inputs).toEqual(row.inputs);
      expect(run.result).toEqual(row.result);
    };
    for (const point of [
      data.sweeps.outlook.find((item) => item.parameter === '5'),
      data.sweeps.penalty.find((item) => item.parameter === '6'),
    ]) {
      if (!point) throw new Error('baseline');
      for (const board of point.boards) {
        same(board.board, 'accept', board.accept);
        same(board.board, 'decline', board.decline);
        const row = first.find((item) => item.board === board.board && item.strategy === 'accept');
        expect(board.initial).toEqual(row?.initial);
      }
    }
    const pressedSeat = data.sweeps.seats.find((item) => item.parameter === '1');
    const slackSeat = data.sweeps.seats.find((item) => item.parameter === '2');
    const pressed = pressedSeat?.boards.find((item) => item.board === 'pressed');
    const slack = slackSeat?.boards.find((item) => item.board === 'slack');
    if (!pressed || !slack) throw new Error('seats');
    same('pressed', 'accept', pressed.accept);
    same('pressed', 'decline', pressed.decline);
    same('slack', 'accept', slack.accept);
    same('slack', 'decline', slack.decline);
    for (const item of data.sweeps.outlook)
      expect(changedKeys(item.rules)).toEqual(item.parameter === '5' ? [] : ['outlook']);
    for (const item of data.sweeps.seats) expect(changedKeys(item.rules)).toEqual(['seats']);
    for (const item of data.sweeps.penalty) expect(changedKeys(item.rules)).toEqual(['penalty']);
    for (const item of data.sweeps.outlook) {
      for (const board of item.boards) {
        expect(board.seats).toBe(board.board === 'pressed' ? 1 : 2);
        expect(board.penalty).toBe(6);
        expect(board.targets).toEqual(board.board === 'pressed' ? [8, 4] : [6, 12]);
        expect(board.initial).toEqual(create('RI-202', board.board));
      }
    }
    for (const item of data.sweeps.seats) {
      for (const board of item.boards) {
        expect(board.outlook).toBe(5);
        expect(board.penalty).toBe(6);
        expect(board.seats).toBe(Number(item.parameter));
        expect(board.targets).toEqual(board.board === 'pressed' ? [8, 4] : [6, 12]);
        expect(board.decline.result.score).toBe(board.board === 'pressed' ? 16 : 10);
      }
    }
    for (const item of data.sweeps.penalty) {
      for (const board of item.boards) {
        expect(board.outlook).toBe(5);
        expect(board.seats).toBe(board.board === 'pressed' ? 1 : 2);
        expect(board.penalty).toBe(Number(item.parameter));
      }
    }
    const noGrowth = data.sweeps.outlook.find((item) => item.parameter === '2');
    const wide = data.sweeps.outlook.find((item) => item.parameter === '21');
    expect(noGrowth?.boards[0]?.accept.result).toMatchObject({
      growthEvents: 0,
      meiReview: 2,
      growth: 0,
    });
    expect(wide?.boards[0]?.accept.result).toMatchObject({
      growthEvents: 1,
      meiReview: 21,
      growth: 19,
      seniorAssignment: 'coding',
    });
    expect(data.sweeps.seats[1]?.boards[0]?.accept.result.seniorAssignment).toBe('review');
    for (const point of Object.values(data.sweeps).flat()) {
      for (const board of point.boards) {
        expect(board.accept.result.assignment).toBe('review');
        expect(board.decline.result).toMatchObject({
          assignment: 'coding',
          growthEvents: 0,
          meiReview: 2,
          seniorAssignment: 'review',
        });
        expect(board.margin).toBe(board.accept.result.score - board.decline.result.score);
      }
    }
  });

  it('見通し2から21と罰0から12の整数でも、標本のあいだに別の反転はない', () => {
    const data = compareRoleChallengeFactorReversals();
    for (let outlook = 2; outlook <= 21; outlook += 1) {
      const pressedAccept = scoreOf('pressed', 'accept', { outlook });
      const pressedDecline = scoreOf('pressed', 'decline', { outlook });
      expect(pressedDecline).toBe(16);
      if (outlook <= 2) expect(pressedAccept).toBe(-8);
      else if (outlook < 4) expect(pressedAccept).toBe(outlook - 10);
      else expect(pressedAccept).toBe(outlook - 4);
      let pressedPreference: 'accept' | 'decline' | 'tie' = 'accept';
      if (outlook < 20) pressedPreference = 'decline';
      else if (outlook === 20) pressedPreference = 'tie';
      expect(preferenceOf(pressedAccept, pressedDecline)).toBe(pressedPreference);
      const slackAccept = scoreOf('slack', 'accept', { outlook });
      const slackDecline = scoreOf('slack', 'decline', { outlook });
      expect(slackDecline).toBe(10);
      if (outlook <= 2) expect(slackAccept).toBe(14);
      else if (outlook < 4) expect(slackAccept).toBe(15);
      else expect(slackAccept).toBe(18 + outlook);
      expect(preferenceOf(slackAccept, slackDecline)).toBe('accept');
      const published = data.sweeps.outlook.find((item) => item.parameter === String(outlook));
      if (!published) continue;
      expect(published.boards.map((board) => board.accept.result.score)).toEqual([
        pressedAccept,
        slackAccept,
      ]);
      expect(published.boards.map((board) => board.decline.result.score)).toEqual([
        pressedDecline,
        slackDecline,
      ]);
    }
    for (let penalty = 0; penalty <= 12; penalty += 1) {
      expect(scoreOf('pressed', 'accept', { penalty })).toBe(7 - penalty);
      expect(scoreOf('pressed', 'decline', { penalty })).toBe(16);
      expect(scoreOf('slack', 'accept', { penalty })).toBe(23);
      expect(scoreOf('slack', 'decline', { penalty })).toBe(16 - penalty);
      expect(scoreOf('pressed', 'accept', { penalty })).toBeLessThan(16);
      expect(scoreOf('slack', 'accept', { penalty })).toBeGreaterThan(16 - penalty);
    }
    for (const board of ['pressed', 'slack'] as const) {
      expect(scoreOf(board, 'accept', { seats: 3 })).toBe(scoreOf(board, 'accept', { seats: 2 }));
      expect(scoreOf(board, 'accept', { seats: 4 })).toBe(scoreOf(board, 'accept', { seats: 2 }));
      expect(scoreOf(board, 'decline', { seats: 4 })).toBe(scoreOf(board, 'decline', { seats: 1 }));
    }
  });

  it('要因比較の入力を再生すると差引が一致し、期末では同じ状態を返す', () => {
    const data = compareRoleChallengeFactorReversals();
    for (const item of Object.values(data.sweeps).flat()) {
      for (const board of item.boards) {
        for (const strategy of ['accept', 'decline'] as const) {
          const run = board[strategy];
          let state = structuredClone(board.initial);
          for (const input of run.inputs) {
            const previous = state;
            const before = structuredClone(state);
            expect(chooseRoleChallengeAction(previous, strategy)).toEqual(input);
            state = apply(state, input, { outlook: board.outlook });
            const restored = apply(JSON.parse(JSON.stringify(before)), input, {
              outlook: board.outlook,
            });
            expect(previous).toEqual(before);
            expect(restored).toEqual(state);
            expect(state.reviewValue - state.penalties).toBe(summarizeRoleChallenge(state).score);
          }
          expect(summarizeRoleChallenge(state)).toEqual(run.result);
          expect(state.inputs).toEqual(run.inputs);
          expect(apply(state, { type: 'period' }, { outlook: board.outlook })).toBe(state);
        }
      }
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  allocateConsult,
  applyFocusConsult as apply,
  chooseFocusAction,
  compareFocusConsults,
  compareFocusFactorReversals,
  createFocusConsult as create,
  summarizeFocusConsult,
  viewFocusConsult,
} from './focusConsult';
import comparison from '../../docs/prototypes/focus-consult-comparison.json';
import factors from '../../docs/prototypes/focus-consult-factor-comparison.json';

describe('RI-222 集中時間と相談時間', () => {
  it('期間、到着、相談枠の出荷と無駄を操作前に示す', () => {
    const first = create('RI-222', 'quiet');
    expect(create('RI-222', 'quiet')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewFocusConsult(first);
    for (let i = 0; i < 8; i++) expect(viewFocusConsult(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toMatchObject({ tick: 0, horizon: 4, slack: 0, arrivals: 0, queue: 0 });
    expect(blank.options).toEqual([
      { reserve: 0, ship: 6, missed: 0, wasted: 0 },
      { reserve: 2, ship: 4, missed: 0, wasted: 2 },
      { reserve: 6, ship: 0, missed: 0, wasted: 6 },
    ]);
  });

  it('相談が来なくても相談枠は出荷へ戻らず、不正な枠は無視する', () => {
    const fresh = create('RI-222', 'quiet');
    expect(allocateConsult(fresh, 1)).toBe(fresh);
    expect(allocateConsult(fresh, 4)).toBe(fresh);
    const reserved = apply(fresh, { type: 'allocate', reserve: 2 });
    expect(summarizeFocusConsult(reserved)).toMatchObject({
      shipped: 4,
      wastedReserve: 2,
      missed: 0,
      score: 4,
    });
    expect(apply(reserved, { type: 'view' })).toBe(reserved);
  });

  it('期限を超えた相談だけを一度引き、待ちは実時間を増やさない', () => {
    let state = create('RI-222', 'steady');
    state = apply(state, { type: 'allocate', reserve: 0 });
    expect(state.tick).toBe(1);
    expect(summarizeFocusConsult(state)).toMatchObject({
      shipped: 6,
      missed: 2,
      penalty: 14,
      waitPeriods: 2,
    });
    const burst = create('RI-222', 'burst');
    const held = apply(burst, { type: 'allocate', reserve: 0 });
    expect(held.tick).toBe(1);
    expect(held.queue).toEqual([]);
    const queued = apply(held, { type: 'allocate', reserve: 0 });
    expect(queued.queue).toHaveLength(4);
    expect(queued.missed).toBe(0);
    expect(queued.waitPeriods).toBe(4);
  });

  it('静穏は長い集中、集中割り込みは短い集中、毎期到着は常時相談が上回る', () => {
    const rows = compareFocusConsults(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([score('quiet', 'long'), score('quiet', 'always'), score('quiet', 'short')]).toEqual([
      18, 16, 12,
    ]);
    expect([score('burst', 'short'), score('burst', 'always'), score('burst', 'long')]).toEqual([
      7, 6, -2,
    ]);
    expect([score('steady', 'always'), score('steady', 'short'), score('steady', 'long')]).toEqual([
      -12, -16, -24,
    ]);
    expect(
      rows.find((row) => row.board === 'burst' && row.strategy === 'long')!.result.waitPeriods,
    ).toBe(8);
    for (const row of rows) expect(row.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareFocusConsults(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseFocusAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeFocusConsult(live)).toEqual(row.result);
    }
  });
});

describe('RI-222 要因の反転', () => {
  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareFocusFactorReversals();
    expect(data).toEqual(factors);
    const cells = (axis: keyof typeof data.sweeps) =>
      data.sweeps[axis].map((point) => [
        point.parameter,
        ...point.boards.flatMap((board) => [
          board.focus.result.score,
          board.focus.result.missed,
          board.consult.result.score,
          board.consult.result.missed,
          board.preference,
        ]),
      ]);
    expect(data.conditions).toMatchObject({
      seed: 'RI-222',
      capacity: 6,
      horizon: 4,
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    });
    expect(data.conditions.plans).toEqual({ focus: [0, 0, 0, 6], consult: [0, 6, 0, 6] });
    expect(data.conditions.boards.burst).toMatchObject({
      arrivals: [0, 4, 0, 0],
      resolveCost: 2,
      slack: 1,
      penaltyEach: 5,
    });
    expect(data.conditions.boards.steady).toMatchObject({
      arrivals: [2, 2, 2, 2],
      slack: 0,
      penaltyEach: 7,
    });
    expect(cells('arrivalTick')).toEqual([
      ['0', -2, 4, 7, 1, 'consult'],
      ['1', -2, 4, 7, 1, 'consult'],
      ['2', 13, 1, 7, 1, 'focus'],
      ['3', 18, 0, 12, 0, 'focus'],
    ]);
    expect(cells('resolveCost')).toEqual([
      ['1', 18, 0, 12, 0, 'focus', -2, 4, 12, 0, 'consult', -24, 6, -16, 4, 'consult'],
      ['2', 18, 0, 12, 0, 'focus', -2, 4, 7, 1, 'consult', -24, 6, -16, 4, 'consult'],
      ['3', 18, 0, 12, 0, 'focus', -2, 4, 2, 2, 'consult', -24, 6, -16, 4, 'consult'],
      ['4', 18, 0, 12, 0, 'focus', -2, 4, -3, 3, 'focus', -31, 7, -30, 6, 'consult'],
      ['5', 18, 0, 12, 0, 'focus', -2, 4, -3, 3, 'focus', -31, 7, -30, 6, 'consult'],
      ['6', 18, 0, 12, 0, 'focus', -2, 4, -3, 3, 'focus', -31, 7, -30, 6, 'consult'],
      ['7', 18, 0, 12, 0, 'focus', -2, 4, -8, 4, 'focus', -38, 8, -44, 8, 'focus'],
    ]);
    expect(cells('slack')).toEqual([
      ['0', 18, 0, 12, 0, 'focus', -2, 4, 7, 1, 'consult', -24, 6, -16, 4, 'consult'],
      ['1', 18, 0, 12, 0, 'focus', -2, 4, 7, 1, 'consult', -10, 4, 5, 1, 'consult'],
      ['2', 18, 0, 12, 0, 'focus', 13, 1, 12, 0, 'focus', 4, 2, 12, 0, 'consult'],
      ['3', 18, 0, 12, 0, 'focus', 18, 0, 12, 0, 'focus', 18, 0, 12, 0, 'focus'],
      ['4', 18, 0, 12, 0, 'focus', 18, 0, 12, 0, 'focus', 18, 0, 12, 0, 'focus'],
    ]);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.board,
        item.before.parameter,
        item.before.preference,
        item.before.focus,
        item.before.consult,
        item.after.parameter,
        item.after.preference,
        item.after.focus,
        item.after.consult,
      ]),
    ).toEqual([
      ['arrivalTick', 'burst', '1', 'consult', -2, 7, '2', 'focus', 13, 7],
      ['resolveCost', 'burst', '3', 'consult', -2, 2, '4', 'focus', -2, -3],
      ['resolveCost', 'steady', '6', 'consult', -31, -30, '7', 'focus', -38, -44],
      ['slack', 'burst', '1', 'consult', -2, 7, '2', 'focus', 13, 12],
      ['slack', 'steady', '2', 'consult', 4, 12, '3', 'focus', 18, 12],
    ]);
    const late = data.sweeps.arrivalTick.find((point) => point.parameter === '3');
    expect(late?.boards[0]?.focus.result.queue).toBe(1);
    expect(late?.boards[0]?.consult.result.queue).toBe(1);
    const early = data.sweeps.arrivalTick.find((point) => point.parameter === '0');
    const baselineArrival = data.sweeps.arrivalTick.find((point) => point.parameter === '1');
    expect(early?.boards[0]?.consult.result.waitPeriods).toBe(5);
    expect(baselineArrival?.boards[0]?.consult.result.waitPeriods).toBe(2);
  });

  it('基準行は初回の長い集中と短い集中に一致し、動かした規則は一つである', () => {
    const data = compareFocusFactorReversals();
    const first = compareFocusConsults(comparison.seed);
    const penaltyEach = { quiet: 0, burst: 5, steady: 7 } as const;
    for (const point of Object.values(data.sweeps).flat()) {
      for (const board of point.boards) {
        expect(board.focus.result.shipped).toBe(18);
        expect(board.consult.result.shipped).toBe(12);
        expect(board.focus.result.penalty).toBe(
          board.focus.result.missed * penaltyEach[board.board],
        );
        expect(board.consult.result.penalty).toBe(
          board.consult.result.missed * penaltyEach[board.board],
        );
        expect(board.margin).toBe(board.focus.result.score - board.consult.result.score);
        expect(board.preference).not.toBe('tie');
        expect(board.focus.strategy).toBe('long');
        expect(board.consult.strategy).toBe('short');
        expect(
          board.focus.inputs.map((input) => input.type === 'allocate' && input.reserve),
        ).toEqual(data.conditions.plans.focus);
        expect(
          board.consult.inputs.map((input) => input.type === 'allocate' && input.reserve),
        ).toEqual(data.conditions.plans.consult);
        if (!board.sameAsFirstComparison) continue;
        const focus = first.find((row) => row.board === board.board && row.strategy === 'long');
        const consult = first.find((row) => row.board === board.board && row.strategy === 'short');
        expect(board.focus.inputs).toEqual(focus?.inputs);
        expect(board.focus.result).toEqual(focus?.result);
        expect(board.consult.inputs).toEqual(consult?.inputs);
        expect(board.consult.result).toEqual(consult?.result);
      }
    }
    expect(first.some((row) => row.strategy === 'always')).toBe(true);
    expect(data.sweeps.arrivalTick.every((point) => point.boards.length === 1)).toBe(true);
    expect(data.sweeps.arrivalTick.every((point) => point.boards[0]?.board === 'burst')).toBe(true);
    for (const point of data.sweeps.arrivalTick) {
      const board = point.boards[0];
      if (!board) throw new Error(point.parameter);
      expect(board.rules.resolveCost).toBe(2);
      expect(board.rules.slack).toBe(1);
      expect(board.rules.arrivals.reduce((sum, count) => sum + count, 0)).toBe(4);
      expect(board.rules.arrivals.filter((count) => count === 4)).toHaveLength(1);
      expect(board.sameAsFirstComparison).toBe(point.parameter === '1');
    }
    for (const point of data.sweeps.resolveCost) {
      expect(point.boards.map((board) => board.board)).toEqual(['quiet', 'burst', 'steady']);
      for (const board of point.boards) {
        const baseline = data.conditions.boards[board.board];
        expect(board.rules.resolveCost).toBe(Number(point.parameter));
        expect(board.rules.slack).toBe(baseline.slack);
        expect(board.rules.arrivals).toEqual(baseline.arrivals);
        expect(board.sameAsFirstComparison).toBe(point.parameter === '2');
      }
    }
    for (const point of data.sweeps.slack) {
      expect(point.boards.map((board) => board.board)).toEqual(['quiet', 'burst', 'steady']);
      for (const board of point.boards) {
        const baseline = data.conditions.boards[board.board];
        expect(board.rules.slack).toBe(Number(point.parameter));
        expect(board.rules.resolveCost).toBe(baseline.resolveCost);
        expect(board.rules.arrivals).toEqual(baseline.arrivals);
        expect(board.sameAsFirstComparison).toBe(Number(point.parameter) === baseline.slack);
      }
    }
    expect(data.reversals.some((item) => item.board === 'quiet')).toBe(false);
    for (const point of [...data.sweeps.resolveCost, ...data.sweeps.slack]) {
      expect(point.boards.find((board) => board.board === 'quiet')?.preference).toBe('focus');
    }
  });

  it('要因比較の入力を再生すると差引が一致し、閲覧の到着と期限は初回のまま', () => {
    const data = compareFocusFactorReversals();
    const burst = create(data.conditions.seed, 'burst');
    const before = viewFocusConsult(burst);
    const ruled = apply(
      burst,
      { type: 'allocate', reserve: 0 },
      {
        arrivals: [4, 0, 0, 0],
        resolveCost: 1,
        slack: 0,
      },
    );
    expect(viewFocusConsult(burst)).toEqual(before);
    expect(before).toMatchObject({ tick: 0, slack: 1, arrivals: 0 });
    expect(ruled.missed).toBe(4);
    expect(ruled.slack).toBe(1);
    expect(ruled.resolveCost).toBe(2);
    expect(viewFocusConsult(ruled)).toMatchObject({ tick: 1, slack: 1, arrivals: 4 });
    for (const point of Object.values(data.sweeps).flat()) {
      for (const board of point.boards) {
        for (const side of ['focus', 'consult'] as const) {
          const run = board[side];
          let state = create(data.conditions.seed, board.board);
          const snapshot = structuredClone(state);
          for (const input of run.inputs) {
            const previous = state;
            const saved = structuredClone(state);
            expect(chooseFocusAction(state, run.strategy)).toEqual(input);
            state = apply(state, input, board.rules);
            const restored = apply(JSON.parse(JSON.stringify(saved)), input, board.rules);
            expect(previous).toEqual(saved);
            expect(restored).toEqual(state);
          }
          expect(snapshot.tick).toBe(0);
          expect(summarizeFocusConsult(state)).toEqual(run.result);
          expect(state.inputs).toEqual(run.inputs);
          expect(state.slack).toBe(data.conditions.boards[board.board].slack);
          expect(state.resolveCost).toBe(2);
          expect(apply(state, { type: 'allocate', reserve: 0 }, board.rules)).toBe(state);
          expect(viewFocusConsult(state).slack).toBe(data.conditions.boards[board.board].slack);
        }
      }
    }
  });
});

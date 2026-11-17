import { describe, expect, it } from 'vitest';
import {
  applyBudgetDisbursement as apply,
  chooseFundingAction,
  compareBudgetDisbursements,
  compareBudgetDisbursementSensitivity,
  createBudgetDisbursement as create,
  summarizeBudgetDisbursement,
  viewBudgetDisbursement,
} from './budgetDisbursement';
import type { FundingBoard, FundingMethod, FundingParameters } from './budgetDisbursement';
import comparison from '../../docs/prototypes/budget-disbursement-comparison.json';
import sensitivity from '../../docs/prototypes/budget-disbursement-sensitivity.json';

function finish(
  board: FundingBoard,
  method: FundingMethod,
  parameters: Partial<FundingParameters>,
) {
  let state = apply(create('boundary', board, parameters), { type: 'choose', method });
  for (let tick = 0; tick < state.horizon; tick++) state = apply(state, { type: 'advance' });
  return state;
}

describe('RI-237 予算の支給方式', () => {
  it('総額と支給時点と条件と返済義務を一緒に示し、閲覧では資金が動かない', () => {
    const first = create('RI-237', 'early');
    expect(create('RI-237', 'early')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewBudgetDisbursement(first);
    for (let i = 0; i < 8; i++) expect(viewBudgetDisbursement(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(apply(first, { type: 'view' })).toBe(first);
    expect(blank.cash).toBe(3);
    expect(blank.repayment).toBe(0);
    expect(blank.offers).toEqual([
      { method: 'advance', total: 8, schedule: [8, 0, 0, 0], condition: 'none', repayment: 0 },
      {
        method: 'staged',
        total: 12,
        schedule: [3, 3, 3, 3],
        condition: 'previous-paid',
        repayment: 0,
      },
      {
        method: 'conditional',
        total: 16,
        schedule: [0, 0, 16, 0],
        condition: 'first-two-paid',
        repayment: 0,
      },
    ]);
    expect(blank.costs).toEqual([8, 1, 1, 1]);
    expect(viewBudgetDisbursement(create('RI-237', 'late')).costs).toEqual([1, 1, 1, 12]);
  });

  it('未達の残額は未支給のままで返済せず、同じ期間を二度支給しない', () => {
    const open = create('RI-237', 'early');
    expect(apply(open, { type: 'advance' })).toBe(open);
    expect(apply(open, { type: 'choose', method: 'advance' })).not.toBe(open);
    const chosen = apply(open, { type: 'choose', method: 'advance' });
    expect(chosen.cash).toBe(3);
    expect(chosen.received).toBe(0);
    expect(apply(chosen, { type: 'choose', method: 'conditional' })).toBe(chosen);
    const finished = ['advance', 'advance', 'advance', 'advance'].reduce(
      (state) => apply(state, { type: 'advance' }),
      chosen,
    );
    expect(finished.received).toBe(8);
    expect(finished.unpaid).toBe(0);
    expect(finished.repayment).toBe(0);
    expect(finished.complete).toBe(true);
    expect(apply(finished, { type: 'advance' })).toBe(finished);
    const staged = ['advance', 'advance', 'advance', 'advance'].reduce(
      (state) => apply(state, { type: 'advance' }),
      apply(open, { type: 'choose', method: 'staged' }),
    );
    expect(staged.complete).toBe(false);
    expect(staged.received).toBe(3);
    expect(staged.unpaid).toBe(9);
    expect(staged.repayment).toBe(0);
    const conditional = ['advance', 'advance', 'advance', 'advance'].reduce(
      (state) => apply(state, { type: 'advance' }),
      apply(open, { type: 'choose', method: 'conditional' }),
    );
    expect(conditional.received).toBe(0);
    expect(conditional.unpaid).toBe(16);
    expect(conditional.repayment).toBe(0);
    expect(conditional.complete).toBe(false);
  });

  it('初期投資では前払い、後半費用では条件付き大型予算が得点で上回る', () => {
    const rows = compareBudgetDisbursements(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const row = (board: string, method: string) =>
      rows.find((item) => item.board === board && item.method === method)!;
    expect(row('early', 'advance').result).toMatchObject({
      cash: 0,
      received: 8,
      unpaid: 0,
      repayment: 0,
      complete: true,
      path: [3, 2, 1, 0],
      score: 10,
    });
    expect(row('early', 'staged').result.score).toBe(3);
    expect(row('early', 'conditional').result.score).toBe(0);
    expect(row('late', 'conditional').result).toMatchObject({
      cash: 4,
      received: 16,
      unpaid: 0,
      complete: true,
      path: [2, 1, 16, 4],
      score: 14,
    });
    expect(row('late', 'staged').result).toMatchObject({ complete: true, score: 10, cash: 0 });
    expect(row('late', 'advance').result).toMatchObject({
      complete: false,
      cash: 8,
      score: 8,
      path: [10, 9, 8, 8],
    });
    expect(row('early', 'advance').result.score).toBeGreaterThan(
      row('early', 'staged').result.score,
    );
    expect(row('early', 'staged').result.score).toBeGreaterThan(
      row('early', 'conditional').result.score,
    );
    expect(row('late', 'conditional').result.score).toBeGreaterThan(
      row('late', 'staged').result.score,
    );
    expect(row('late', 'staged').result.score).toBeGreaterThan(row('late', 'advance').result.score);
    for (const item of rows) expect(item.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareBudgetDisbursements(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseFundingAction(previous, row.method)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeBudgetDisbursement(live)).toEqual(row.result);
    }
  });

  it.each([
    ['early', 'advance', 3],
    ['early', 'staged', 5],
    ['early', 'conditional', 9],
    ['late', 'advance', 7],
    ['late', 'staged', 3],
    ['late', 'conditional', 2],
  ] as const)(
    '%s の %s は手持ち %i から完成し、その直前は支払不能になる',
    (board, method, minimum) => {
      for (const startCash of [minimum - 1, minimum, minimum + 1]) {
        const state = finish(board, method, { startCash });
        expect(state.complete).toBe(startCash >= minimum);
        expect(state.shortfall > 0).toBe(startCash < minimum);
        expect(state.periods.some((period) => !period.paid)).toBe(startCash < minimum);
      }
    },
  );

  it('手持ちの境界で前払い・段階・条件付きの得点首位が切り替わる', () => {
    const rows = compareBudgetDisbursementSensitivity();
    const winner = (id: string) => rows.find((row) => row.id === id)!.ranking[0];
    expect(winner('early-cash-3')).toEqual(['advance']);
    expect(winner('early-cash-4')).toEqual(['advance']);
    expect(winner('early-cash-5')).toEqual(['staged']);
    expect(winner('early-cash-8')).toEqual(['staged']);
    expect(winner('early-cash-9')).toEqual(['conditional']);
    expect(winner('late-cash-1')).toEqual(['staged']);
    expect(winner('late-cash-2')).toEqual(['conditional']);
  });

  it('完成価値3と4で首位が同点・反転し、8で段階と前払いの順位が反転する', () => {
    const rows = compareBudgetDisbursementSensitivity();
    const rank = (id: string) => rows.find((row) => row.id === id)!.ranking;
    expect(rank('early-value-2')).toEqual([['staged'], ['advance'], ['conditional']]);
    expect(rank('early-value-3')).toEqual([['advance', 'staged'], ['conditional']]);
    expect(rank('early-value-4')).toEqual([['advance'], ['staged'], ['conditional']]);
    expect(rank('late-value-3')).toEqual([['advance'], ['conditional'], ['staged']]);
    expect(rank('late-value-4')).toEqual([['advance', 'conditional'], ['staged']]);
    expect(rank('late-value-5')).toEqual([['conditional'], ['advance'], ['staged']]);
    expect(rank('late-value-7')).toEqual([['conditional'], ['advance'], ['staged']]);
    expect(rank('late-value-8')).toEqual([['conditional'], ['advance', 'staged']]);
    expect(rank('late-value-9')).toEqual([['conditional'], ['staged'], ['advance']]);
  });

  it.each([
    ['early', 1, 8],
    ['early', 2, 9],
    ['early', 3, 10],
    ['late', 1, 1],
    ['late', 2, 2],
    ['late', 3, 3],
  ] as const)('%s の条件達成を最初の %i 期にすると最小手持ちは %i', (board, after, minimum) => {
    for (const startCash of [minimum - 1, minimum, minimum + 1]) {
      const initial = create('timing', board, { startCash, conditionalAfterPaidPeriods: after });
      const offer = viewBudgetDisbursement(initial).offers.find(
        (item) => item.method === 'conditional',
      )!;
      expect(offer.total).toBe(16);
      expect(offer.condition).toBe(['first-paid', 'first-two-paid', 'first-three-paid'][after - 1]);
      expect(offer.schedule).toEqual(
        Array.from({ length: 4 }, (_, tick) => (tick === after ? 16 : 0)),
      );
      const state = finish(board, 'conditional', { startCash, conditionalAfterPaidPeriods: after });
      expect(state.received).toBe(startCash >= minimum ? 16 : 0);
      expect(state.unpaid).toBe(startCash >= minimum ? 0 : 16);
      expect(state.complete).toBe(startCash >= minimum);
      expect(state.periods.map((period) => period.disbursed)).toEqual(
        offer.schedule.map((amount) => (startCash >= minimum ? amount : 0)),
      );
      expect(state.repayment).toBe(0);
      expect(apply(state, { type: 'advance' })).toBe(state);
    }
  });

  it('感度比較JSONの32条件・96戦略を再生成し、毎入力保存再開と再生と資金保存則が一致する', () => {
    const rows = compareBudgetDisbursementSensitivity(sensitivity.seed);
    expect(rows).toHaveLength(32);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    expect(rows).toEqual(sensitivity.results);
    for (const row of rows) {
      expect(row.initial).toEqual(create(sensitivity.seed, row.initial.board, row.parameters));
      for (const strategy of row.strategies) {
        let live = row.initial;
        let saved = structuredClone(live);
        for (const input of strategy.inputs) {
          const previous = live;
          const before = structuredClone(previous);
          expect(chooseFundingAction(previous, strategy.method)).toEqual(input);
          live = apply(live, input);
          saved = apply(JSON.parse(JSON.stringify(saved)), input);
          expect(saved).toEqual(live);
          expect(previous).toEqual(before);
          expect(live.cash).toBeGreaterThanOrEqual(0);
        }
        const { paidCost: recordedCost, firstUnpaidTick, ...summary } = strategy.result;
        expect(summarizeBudgetDisbursement(live)).toEqual(summary);
        const paidCost = live.periods.reduce(
          (sum, period) => sum + (period.paid ? period.cost : 0),
          0,
        );
        expect(recordedCost).toBe(paidCost);
        expect(firstUnpaidTick).toBe(
          live.paid.indexOf(false) === -1 ? null : live.paid.indexOf(false),
        );
        expect(live.cash + paidCost).toBe(live.startCash + live.received);
        expect(live.received + live.unpaid).toBe(
          live.offers.find((offer) => offer.method === strategy.method)!.total,
        );
        expect(live.tick).toBe(live.horizon);
        expect(live.complete).toBe(live.paid.every(Boolean));
        expect(apply(live, { type: 'advance' })).toBe(live);
      }
    }
  });

  it('感度係数は非負の安全な整数と1〜3期に限定する', () => {
    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => create('invalid', 'early', { startCash: value })).toThrow();
      expect(() => create('invalid', 'early', { completionValue: value })).toThrow();
    }
    const invalidTiming = JSON.parse('{"conditionalAfterPaidPeriods": 4}');
    expect(() => create('invalid', 'early', invalidTiming)).toThrow();
    expect(create('zero', 'early', { startCash: 0, completionValue: 0 }).cash).toBe(0);
  });
});

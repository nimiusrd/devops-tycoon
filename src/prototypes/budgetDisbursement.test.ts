import { describe, expect, it } from 'vitest';
import {
  applyBudgetDisbursement as apply,
  chooseFundingAction,
  compareBudgetDisbursements,
  createBudgetDisbursement as create,
  summarizeBudgetDisbursement,
  viewBudgetDisbursement,
} from './budgetDisbursement';
import comparison from '../../docs/prototypes/budget-disbursement-comparison.json';

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
});

import { describe, expect, it } from 'vitest';
import {
  applyCustomerInterrupt as apply,
  chooseInterruptAction,
  compareCustomerInterrupts,
  createCustomerInterrupt as create,
  summarizeCustomerInterrupt,
  viewCustomerInterrupt,
} from './customerInterrupt';
import comparison from '../../docs/prototypes/customer-interrupt-comparison.json';

describe('RI-246 重要顧客の割り込み', () => {
  it('受ける前に仕事量と譲る余力を示し、選択だけでは出荷しない', () => {
    const first = create('RI-246', 'slack');
    expect(create('RI-246', 'slack')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewCustomerInterrupt(first);
    for (let i = 0; i < 8; i++) expect(viewCustomerInterrupt(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(apply(first, { type: 'view' })).toBe(first);
    expect(apply(first, { type: 'work' })).toBe(first);
    expect(blank).toMatchObject({
      capacity: 4,
      workTicks: 3,
      reason: 'customer-interrupt',
      helpsWhen: 'three-work-ticks',
      hindersWhen: 'two-work-ticks',
      planned: { left: 6, total: 6, valuePer: 5 },
      interrupt: { left: 4, total: 4, valuePer: 3 },
      bonus: 14,
      trustCost: 6,
      choices: ['accept', 'decline'],
    });
    expect(blank.forecasts.map((item) => [item.strategy, item.score])).toEqual([
      ['accept', 56],
      ['decline', 38],
    ]);
    const accepted = apply(first, { type: 'accept' });
    expect(accepted.value).toBe(0);
    expect(accepted.interruptLeft).toBe(4);
    expect(accepted.plannedLeft).toBe(6);
    expect(accepted.periods[0]).toMatchObject({
      action: 'accept',
      interruptCleared: 0,
      plannedCleared: 0,
    });
    expect(apply(accepted, { type: 'accept' })).toBe(accepted);
    expect(apply(accepted, { type: 'decline' })).toBe(accepted);
    const worked = apply(accepted, { type: 'work' });
    expect(worked).toMatchObject({ value: 12, interruptDone: 4, plannedDone: 0 });
    const declined = apply(first, { type: 'decline' });
    expect(declined).toMatchObject({ value: 0, trust: 6, accepted: false, interruptLeft: 0 });
    expect(viewCustomerInterrupt(declined).interrupt).toMatchObject({ left: 0, total: 4 });
    expect(summarizeCustomerInterrupt(declined).lost).toBe(false);
    expect(
      viewCustomerInterrupt(create('RI-246', 'cramped')).forecasts.map((item) => item.score),
    ).toEqual([32, 38]);
  });

  it('期限に余裕があるときは受注、余力がないときは見送りが上回る', () => {
    const rows = compareCustomerInterrupts(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const row = (board: string, strategy: string) =>
      rows.find((item) => item.board === board && item.strategy === strategy)!;
    expect(row('slack', 'accept').result).toMatchObject({
      score: 56,
      value: 56,
      trust: 0,
      plannedDone: 6,
      interruptDone: 4,
      bonusPaid: true,
      path: [0, 12, 32, 56],
      cleared: [0, 4, 4, 2],
    });
    expect(row('slack', 'decline').result).toMatchObject({
      score: 38,
      value: 44,
      trust: 6,
      plannedDone: 6,
      interruptDone: 0,
      path: [-6, 14, 38, 38],
    });
    expect(row('cramped', 'accept').result).toMatchObject({
      score: 32,
      plannedDone: 4,
      plannedLeft: 2,
      interruptDone: 4,
      bonusPaid: false,
      path: [0, 12, 32],
    });
    expect(row('cramped', 'decline').result).toMatchObject({
      score: 38,
      plannedDone: 6,
      bonusPaid: true,
      trust: 6,
      path: [-6, 14, 38],
    });
    expect(row('slack', 'accept').result.score).toBeGreaterThan(
      row('slack', 'decline').result.score,
    );
    expect(row('cramped', 'decline').result.score).toBeGreaterThan(
      row('cramped', 'accept').result.score,
    );
    for (const item of rows) expect(item.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareCustomerInterrupts(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseInterruptAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeCustomerInterrupt(live)).toEqual(row.result);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { getCard } from '../data/cards';
import { playCost } from '../sim/cards';
import { discountedShopPrice } from '../sim/run/shopPrice';
import {
  advanceBudgetBoss,
  createBudgetBoss,
  previewBudgetBoss,
  viewBudgetBoss,
  type BudgetBossDecision,
  type BudgetBossState,
} from './budgetBoss';

describe('RI-262 予算制限ボス', () => {
  it('開始前に現在の予算、既存カードの費用、仕事と突破条件を取得できる', () => {
    const initial = createBudgetBoss('RI-262', 17);
    const preview = previewBudgetBoss(initial);
    expect(preview.startingBudget).toBe(17);
    expect(preview.goal).toEqual({ minDone: 23, minCriticalDone: 10 });
    expect(preview.batches.map(({ id, kind, highValue }) => [id, kind, highValue])).toEqual([
      ['routine-first', 'routine', false],
      ['critical', 'complex', true],
      ['routine-last', 'routine', false],
    ]);
    for (const { cardId, level, price, focusCost } of preview.cards) {
      const card = getCard(cardId)!;
      expect(price).toBe(discountedShopPrice(card.cost, preview.shopDiscount));
      expect(focusCost).toBe(playCost(card.focusCost, level));
    }
    expect(viewBudgetBoss(initial)).toMatchObject({ spent: 0, remainingBudget: 17, cleared: null });
  });

  it('順番外、二重入力、対象外のカード、残額超過を無消費で拒否する', () => {
    const initial = createBudgetBoss('RI-262');
    expect(advanceBudgetBoss(initial, { batchId: 'critical', cardId: 'auto-test' })).toBe(initial);
    const invalid = { batchId: 'routine-first', cardId: 'devin' } as unknown as BudgetBossDecision;
    expect(advanceBudgetBoss(initial, invalid)).toBe(initial);

    const first = advanceBudgetBoss(initial, { batchId: 'routine-first', cardId: 'copilot' });
    expect(first).not.toBe(initial);
    expect(advanceBudgetBoss(first, { batchId: 'routine-first', cardId: 'copilot' })).toBe(first);
    expect(advanceBudgetBoss(first, { batchId: 'critical', cardId: 'auto-test' })).toBe(first);
    expect(viewBudgetBoss(first)).toMatchObject({ spent: 1, remainingBudget: 17, cleared: null });

    const second = advanceBudgetBoss(first, { batchId: 'critical', cardId: null });
    expect(second.batches[1]).toMatchObject({ spent: 0, ticks: 27 });
    expect(viewBudgetBoss(initial)).toMatchObject({ spent: 0, remainingBudget: 18 });
  });

  it('費用ぴったりでも以後の仕事は続き、0予算からの無支出でも出荷できる', () => {
    const initial = createBudgetBoss('RI-262', 0);
    expect(advanceBudgetBoss(initial, { batchId: 'routine-first', cardId: 'copilot' })).toBe(
      initial,
    );
    const first = advanceBudgetBoss(initial, { batchId: 'routine-first', cardId: null });
    const critical = advanceBudgetBoss(first, { batchId: 'critical', cardId: null });
    const final = advanceBudgetBoss(critical, { batchId: 'routine-last', cardId: null });
    expect(viewBudgetBoss(final)).toMatchObject({
      spent: 0,
      remainingBudget: 0,
      nextBatch: null,
      cleared: true,
    });
    expect(viewBudgetBoss(final).delivered).toBeGreaterThan(0);
    expect(advanceBudgetBoss(final, { batchId: 'routine-last', cardId: null })).toBe(final);

    const exact = createBudgetBoss('RI-262', 18);
    const paid = advanceBudgetBoss(exact, { batchId: 'routine-first', cardId: 'auto-test' });
    expect(viewBudgetBoss(paid)).toMatchObject({
      spent: 18,
      remainingBudget: 0,
      nextBatch: 'critical',
      cleared: null,
    });
    expect(advanceBudgetBoss(paid, { batchId: 'critical', cardId: null }).batches).toHaveLength(2);
  });

  it('仕事群の境界で入力を再生し、JSONを経由して同じ結果と予算台帳を得る', () => {
    const inputs: BudgetBossDecision[] = [
      { batchId: 'routine-first', cardId: null },
      { batchId: 'critical', cardId: 'auto-test' },
      { batchId: 'routine-last', cardId: 'copilot' },
    ];
    const initial = createBudgetBoss('RI-262:1', 20);
    const expected = inputs.reduce(advanceBudgetBoss, initial);
    const checkpoint = advanceBudgetBoss(initial, inputs[0]);
    const restored = JSON.parse(JSON.stringify(checkpoint)) as BudgetBossState;
    expect(inputs.slice(1).reduce(advanceBudgetBoss, restored)).toEqual(expected);
    expect(viewBudgetBoss(expected)).toMatchObject({ spent: 19, remainingBudget: 1 });
    expect(expected.batches.map(({ spent }) => spent)).toEqual([0, 18, 1]);
  });

  it('施策の費用と効果は割り当てた仕事群にだけ適用する', () => {
    const initial = createBudgetBoss('RI-262:3');
    const first = advanceBudgetBoss(initial, { batchId: 'routine-first', cardId: null });
    const critical: BudgetBossDecision = { batchId: 'critical', cardId: null };
    const last: BudgetBossDecision = { batchId: 'routine-last', cardId: null };
    const unassisted = [critical, last].reduce(advanceBudgetBoss, first);
    const applied = [{ ...critical, cardId: 'auto-test' } as const, last].reduce(
      advanceBudgetBoss,
      first,
    );
    expect(applied.batches[0]).toEqual(unassisted.batches[0]);
    expect(applied.batches[1]).toMatchObject({ spent: 18, focusSpent: 3 });
    expect(applied.batches[2]).toEqual(unassisted.batches[2]);
  });
});

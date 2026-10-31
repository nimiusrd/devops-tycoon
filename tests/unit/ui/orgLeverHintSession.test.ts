import { beforeEach, describe, expect, it } from 'vitest';
import { MIN_ORG_LEVER_BUDGET } from '../../../src/render/orgLeverHintView';
import {
  dismissOrgLeverHint,
  noteOrgLeverBudgetDepleted,
  readOrgLeverHintSession,
  resetOrgLeverHintSession,
  resolveOrgLeverHint,
} from '../../../src/ui/orgLeverHintSession';

function visible(epoch: number, budget: number, readOnly = false) {
  return resolveOrgLeverHint({
    epoch,
    quarterNumber: 1,
    budget,
    readOnly,
  });
}

describe('組織レバー案内の消去', () => {
  beforeEach(() => {
    resetOrgLeverHintSession();
  });

  it('温存では残り、レバーを開くか予算0で消え、同じランでは戻さない', () => {
    expect(visible(1, MIN_ORG_LEVER_BUDGET).show).toBe(true);
    expect(readOrgLeverHintSession(1).dismissed).toBe(false);

    noteOrgLeverBudgetDepleted(1, MIN_ORG_LEVER_BUDGET, false);
    expect(visible(1, MIN_ORG_LEVER_BUDGET).show).toBe(true);
    expect(readOrgLeverHintSession(1).dismissed).toBe(false);

    expect(visible(1, 0).show).toBe(false);
    expect(visible(1, 0).dismissed).toBe(true);
    noteOrgLeverBudgetDepleted(1, 0, false);
    expect(readOrgLeverHintSession(1).dismissed).toBe(true);
    expect(visible(1, MIN_ORG_LEVER_BUDGET + 20).show).toBe(false);
    expect(visible(1, MIN_ORG_LEVER_BUDGET + 20).dismissed).toBe(true);

    expect(visible(2, MIN_ORG_LEVER_BUDGET).show).toBe(true);
    dismissOrgLeverHint(2);
    expect(visible(2, MIN_ORG_LEVER_BUDGET + 20).show).toBe(false);
    expect(visible(2, MIN_ORG_LEVER_BUDGET + 20).dismissed).toBe(true);
    expect(readOrgLeverHintSession(2).dismissed).toBe(true);
  });

  it('最安未満でも 0 より大きければ消したことにせず、回復すれば出す', () => {
    expect(visible(4, MIN_ORG_LEVER_BUDGET - 1).show).toBe(false);
    expect(readOrgLeverHintSession(4).dismissed).toBe(false);
    expect(visible(4, MIN_ORG_LEVER_BUDGET).show).toBe(true);
  });

  it('リプレイの予算 0 は覚えず、同じ世代の案内を残す', () => {
    expect(visible(3, MIN_ORG_LEVER_BUDGET).show).toBe(true);
    noteOrgLeverBudgetDepleted(3, 0, true);
    expect(visible(3, 0, true).show).toBe(false);
    expect(visible(3, 0, true).dismissed).toBe(false);
    expect(readOrgLeverHintSession(3).dismissed).toBe(false);
    expect(visible(3, MIN_ORG_LEVER_BUDGET).show).toBe(true);
  });
});

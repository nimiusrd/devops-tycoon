import { describe, expect, it } from 'vitest';
import { ACTION_BALANCE } from '../../../src/data/balance';
import { ORG_STAT_MAX, ORG_STAT_MIN, spendStat } from '../../../src/sim/orgStat';

describe('介入・差配の組織指標境界', () => {
  it('組織指標の境界aliasはアクションレジストリと一致する', () => {
    expect(ORG_STAT_MIN).toBe(ACTION_BALANCE.organizationStatMinimum.value);
    expect(ORG_STAT_MAX).toBe(ACTION_BALANCE.organizationStatMaximum.value);
  });

  it('spendStat は下限で止まり、実際に消費できた量を返す', () => {
    expect(spendStat(ORG_STAT_MIN, 5)).toEqual({ next: ORG_STAT_MIN, spent: 0 });
    expect(spendStat(3, 5)).toEqual({ next: 0, spent: 3 });
    expect(spendStat(ORG_STAT_MAX, 5)).toEqual({ next: ORG_STAT_MAX - 5, spent: 5 });
    expect(spendStat(ORG_STAT_MAX, ORG_STAT_MAX + 5)).toEqual({
      next: ORG_STAT_MIN,
      spent: ORG_STAT_MAX,
    });
  });
});

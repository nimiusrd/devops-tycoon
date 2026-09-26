import { describe, expect, it } from 'vitest';
import {
  SPEND_RUN_END_WARNING,
  spendRiskView,
  spendStatusText,
} from '../../../src/render/spendRiskView';

describe('spendRiskView', () => {
  it('残高が残る支払いと、0になる支払いと、不足を区別する', () => {
    const surplus = spendRiskView({ budget: 26, cost: 25 });
    expect(surplus).toMatchObject({
      balanceAfter: 1,
      blocked: null,
      endsRun: false,
      requiresConfirm: false,
      balanceLabel: '支払後の残高 💰1',
      warningLabel: null,
    });

    const exact = spendRiskView({ budget: 25, cost: 25 });
    expect(exact).toMatchObject({
      balanceAfter: 0,
      blocked: null,
      endsRun: true,
      requiresConfirm: true,
      warningLabel: SPEND_RUN_END_WARNING,
    });

    const short = spendRiskView({ budget: 24, cost: 25 });
    expect(short).toMatchObject({
      blocked: 'short',
      endsRun: false,
      requiresConfirm: false,
      balanceLabel: null,
      shortLabel: '予算が足りません（💰25 必要）',
    });
  });

  it('購入済みを満員や不足より優先し、満員を不足より優先する', () => {
    expect(spendRiskView({ budget: 0, cost: 25, bought: true, rosterFull: true }).blocked).toBe(
      'bought',
    );
    expect(spendRiskView({ budget: 10, cost: 25, rosterFull: true }).blocked).toBe('rosterFull');
    expect(
      spendStatusText(
        spendRiskView({ budget: 10, cost: 25, rosterFull: true }),
        '迎える',
        'ロスターが満員です',
      ),
    ).toBe('ロスターが満員です');
    expect(spendStatusText(spendRiskView({ budget: 40, cost: 15 }), '次のスプリントで使う')).toBe(
      '支払後の残高 💰25。次のスプリントで使う',
    );
  });
});

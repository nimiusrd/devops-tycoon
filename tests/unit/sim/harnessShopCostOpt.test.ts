import { describe, expect, it } from 'vitest';
import { RECRUIT_COST } from '../../../src/sim/member/roster';
import { RunEngine } from '../../../src/sim/run/engine';
import { buyShopItems, POLICY_DEFS } from '../../playtest/harness';

describe('harness buyCostOpt ショップ優先', () => {
  it('無関係レリックよりコスト最適化カードを先に買う', () => {
    const engine = new RunEngine({ seed: 'ri88-shop-costopt', difficulty: 'normal' });
    engine.startRun();
    const internals = engine as unknown as {
      phase: string;
      budget: number;
      deck: Array<{ defId: string; level: number }>;
      relics: string[];
      shop: {
        cards: Array<{ defId: string; cost: number; bought: boolean }>;
        relic: { id: string; cost: number; bought: boolean } | null;
        recruit: { cost: number; bought: boolean } | null;
      } | null;
    };
    internals.phase = 'shop';
    // 採用予約を残すと、30 の無関係レリックを先に買うと 12 の最適化カードが買えなくなる。
    internals.budget = RECRUIT_COST + 30 + 5;
    internals.deck = [];
    internals.relics = [];
    internals.shop = {
      cards: [{ defId: 'ai-guideline', cost: 12, bought: false }],
      relic: { id: 'postmortem', cost: 30, bought: false },
      recruit: { cost: RECRUIT_COST, bought: false },
    };

    buyShopItems(engine, POLICY_DEFS.harnessOptimized);

    const s = engine.snapshot();
    expect(s.deck.some((c) => c.defId === 'ai-guideline')).toBe(true);
    expect(s.relics).not.toContain('postmortem');
    expect(s.shop?.cards.find((c) => c.defId === 'ai-guideline')?.bought).toBe(true);
    expect(s.shop?.relic?.bought).toBe(false);
  });
});

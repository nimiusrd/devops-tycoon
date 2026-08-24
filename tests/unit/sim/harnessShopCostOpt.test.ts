import { describe, expect, it } from 'vitest';
import { RECRUIT_COST } from '../../../src/sim/member/roster';
import { RunEngine } from '../../../src/sim/run/engine';
import { buyShopItems, playHand, POLICY_DEFS } from '../../playtest/harness';

describe('harness RI-88 方針', () => {
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

  it('両ハーネスは frontier-dependency で継続課金し、肥大化はデリバリー、最適化はコスト最適化を優先する', () => {
    expect(POLICY_DEFS.harnessBloated.trials).toEqual(['frontier-dependency']);
    expect(POLICY_DEFS.harnessOptimized.trials).toEqual(['frontier-dependency']);
    expect(POLICY_DEFS.harnessOptimized.cards).toBe('preferCostOpt');
    expect(POLICY_DEFS.harnessBloated.cards).toBe('preferDelivery');
  });

  it('preferCostOpt は高コストカードより ai-guideline を先に発動する', () => {
    const engine = new RunEngine({ seed: 'ri88-hand-costopt', difficulty: 'normal' });
    engine.startRun();
    engine.beginSetupSprint();
    const internals = engine as unknown as {
      deck: Array<{ defId: string; level: number }>;
      sprint: {
        focus: number;
        cardPiles: { hand: number[]; played: number[]; discard: number[]; drawOrder: number[] };
      } | null;
    };
    // RI-78: 発動費はショップ価格から独立した focusCost（hire-senior=4、ai-guideline=3）。
    // focus=6 なら順不同で1枚しか切れないため、コスト最適化カードの優先順を検証できる。
    internals.deck = [
      { defId: 'hire-senior', level: 1 },
      { defId: 'ai-guideline', level: 1 },
    ];
    internals.sprint!.focus = 6;
    internals.sprint!.cardPiles = { hand: [0, 1], played: [], discard: [], drawOrder: [] };

    playHand(engine, 'preferCostOpt');
    expect(internals.sprint!.cardPiles.played).toContain(1);
    expect(internals.sprint!.cardPiles.played).not.toContain(0);
  });
});

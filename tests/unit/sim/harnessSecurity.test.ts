import { describe, expect, it } from 'vitest';
import { RECRUIT_COST } from '../../../src/sim/member/roster';
import { RunEngine } from '../../../src/sim/run/engine';
import { buyShopItems, playHand, POLICY_DEFS } from '../../playtest/harness';

describe('harness RI-87 方針', () => {
  it('無関係レリックよりセキュリティ投資カードを先に買う', () => {
    const engine = new RunEngine({ seed: 'ri87-shop-security', difficulty: 'normal' });
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
    internals.budget = RECRUIT_COST + 30 + 5;
    internals.deck = [];
    internals.relics = [];
    internals.shop = {
      cards: [{ defId: 'auto-test', cost: 18, bought: false }],
      relic: { id: 'psych-safety', cost: 30, bought: false },
      recruit: { cost: RECRUIT_COST, bought: false },
    };

    buyShopItems(engine, POLICY_DEFS.securityFocus);

    const s = engine.snapshot();
    expect(s.deck.some((c) => c.defId === 'auto-test')).toBe(true);
    expect(s.relics).not.toContain('psych-safety');
    expect(s.shop?.cards.find((c) => c.defId === 'auto-test')?.bought).toBe(true);
    expect(s.shop?.relic?.bought).toBe(false);
  });

  it('buyAvoidSecurity はセキュリティ投資カードを買わない', () => {
    const engine = new RunEngine({ seed: 'ri87-shop-avoid', difficulty: 'normal' });
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
    internals.budget = RECRUIT_COST + 40;
    internals.deck = [];
    internals.relics = [];
    internals.shop = {
      cards: [
        { defId: 'auto-test', cost: 18, bought: false },
        { defId: 'copilot', cost: 1, bought: false },
      ],
      relic: { id: 'postmortem', cost: 20, bought: false },
      recruit: { cost: RECRUIT_COST, bought: false },
    };

    buyShopItems(engine, POLICY_DEFS.securityNeglect);

    const s = engine.snapshot();
    expect(s.deck.some((c) => c.defId === 'auto-test')).toBe(false);
    expect(s.deck.some((c) => c.defId === 'copilot')).toBe(true);
    expect(s.relics).not.toContain('postmortem');
  });

  it('preferSecurity は docs も auto-test と同様に無関係カードより先に発動する', () => {
    const engine = new RunEngine({ seed: 'ri87-hand-docs', difficulty: 'normal' });
    engine.startRun();
    engine.beginSetupSprint();
    const internals = engine as unknown as {
      deck: Array<{ defId: string; level: number }>;
      sprint: {
        focus: number;
        cardPiles: { hand: number[]; played: number[]; discard: number[]; drawOrder: number[] };
      } | null;
    };
    internals.deck = [
      { defId: 'hire-senior', level: 1 },
      { defId: 'docs', level: 1 },
    ];
    internals.sprint!.focus = 4;
    internals.sprint!.cardPiles = { hand: [0, 1], played: [], discard: [], drawOrder: [] };

    playHand(engine, 'preferSecurity');
    expect(internals.sprint!.cardPiles.played).toContain(1);
    expect(internals.sprint!.cardPiles.played).not.toContain(0);
  });

  it('buyAvoidSecurity は no-friday-deploy も買わない', () => {
    const engine = new RunEngine({ seed: 'ri87-shop-avoid-friday', difficulty: 'normal' });
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
    internals.budget = RECRUIT_COST + 40;
    internals.deck = [];
    internals.relics = [];
    internals.shop = {
      cards: [{ defId: 'copilot', cost: 1, bought: false }],
      relic: { id: 'no-friday-deploy', cost: 20, bought: false },
      recruit: { cost: RECRUIT_COST, bought: false },
    };

    buyShopItems(engine, POLICY_DEFS.securityNeglect);

    const s = engine.snapshot();
    expect(s.relics).not.toContain('no-friday-deploy');
    expect(s.deck.some((c) => c.defId === 'copilot')).toBe(true);
  });
});

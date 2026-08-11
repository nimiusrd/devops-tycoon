/**
 * RunEngine の shop / rest / recruit（hire）まわりのミューテーション回帰テスト。
 * Stryker の Survived / NoCoverage mutation を exact 断言で潰す（旧 RI-72-D2 / RI-91-A4）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RECRUIT_SKIP_MORALE } from '../../../src/data/events';
import { RELIC_DEFS } from '../../../src/data/relics';
import type { CardInstance } from '../../../src/sim/cards';
import { RECRUIT_COST, ROSTER_CAP, type RosterState } from '../../../src/sim/member';
import {
  REST_HEAL,
  REST_REPAY,
  REST_REPAY_REWORK_RATE,
  REST_UPGRADE_FOCUS_MAX,
  RunEngine,
  SHOP_RELIC_COST,
} from '../../../src/sim/run/engine';
import type { BeatState, RunState, ShopOffer } from '../../../src/sim/run/types';
import type { OrgState } from '../../../src/sim/types';

const recruitMemberMock = vi.hoisted(() => ({
  returnSame: false,
}));

const upgradeCardAtMock = vi.hoisted(() => ({
  calls: 0,
}));

vi.mock('../../../src/sim/member', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/sim/member')>();
  return {
    ...actual,
    recruitMember: (
      roster: RosterState,
      arch: Parameters<typeof actual.recruitMember>[1],
      rng: Parameters<typeof actual.recruitMember>[2],
    ) => {
      if (recruitMemberMock.returnSame) return roster;
      return actual.recruitMember(roster, arch, rng);
    },
  };
});

vi.mock('../../../src/sim/cards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/sim/cards')>();
  return {
    ...actual,
    upgradeCardAt: (deck: CardInstance[], index: number) => {
      upgradeCardAtMock.calls += 1;
      return actual.upgradeCardAt(deck, index);
    },
  };
});

type ShopInternals = {
  beat: BeatState | null;
  budget: number;
  deck: CardInstance[];
  org: OrgState;
  pendingSprintModifiers: RunState['pendingSprintModifiers'];
  phase: RunState['phase'];
  relics: string[];
  roster: RosterState;
  shop: ShopOffer | null;
  sprintIndexInQuarter: number;
  status: RunState['status'];
};

const SHOP_CARDS = new Set(['auto-test', 'docs', 'pr-size-limit']);

const asInternals = (engine: RunEngine): ShopInternals => engine as unknown as ShopInternals;

function createEngine(
  seed = 'ri-91-a4',
  options: {
    allowedCards?: ReadonlySet<string>;
    allowedRelics?: ReadonlySet<string>;
  } = {},
): RunEngine {
  const engine = new RunEngine({
    seed,
    difficulty: 'normal',
    allowedCards: options.allowedCards ?? SHOP_CARDS,
    allowedRelics: options.allowedRelics ?? new Set(['postmortem']),
  });
  engine.startRun();
  return engine;
}

function enterDecisionBeat(engine: RunEngine, eventId: string): ShopInternals {
  const i = asInternals(engine);
  i.phase = 'beat';
  i.beat = { eventId, kind: 'decision' };
  i.sprintIndexInQuarter = 2;
  return i;
}

function fillRoster(roster: RosterState): RosterState {
  const members = [...roster.members];
  const template = members[0];
  for (let n = members.length; n < ROSTER_CAP; n += 1) {
    members.push({
      ...template,
      id: `filled-${n}`,
      name: `Filled ${n}`,
      assignment: 'bench',
      aiAssigned: false,
    });
  }
  return { members, nextId: ROSTER_CAP };
}

afterEach(() => {
  recruitMemberMock.returnSame = false;
  upgradeCardAtMock.calls = 0;
});

describe('RI-91-A4 RunEngine shop / rest / hire', () => {
  it('購入済みカード・レリック・採用は予算十分でも再購入しない', () => {
    const engine = createEngine('ri-91-a4-rebuy');
    const i = asInternals(engine);
    i.phase = 'shop';
    i.budget = 100;
    i.deck = [{ defId: 'docs', level: 1 }];
    i.relics = ['postmortem'];
    const rosterBefore = i.roster;
    i.shop = {
      cards: [{ defId: 'docs', cost: 12, bought: true }],
      relic: { id: 'postmortem', cost: 30, bought: true },
      recruit: { cost: RECRUIT_COST, bought: true },
    };

    engine.buyShopCard('docs');
    engine.buyShopRelic();
    engine.buyShopRecruit();

    const state = engine.snapshot();
    expect(state.budget).toBe(100);
    expect(state.deck).toEqual([{ defId: 'docs', level: 1 }]);
    expect(state.relics).toEqual(['postmortem']);
    expect(state.roster.members).toHaveLength(rosterBefore.members.length);
    expect(state.shop?.cards[0].bought).toBe(true);
    expect(state.shop?.relic?.bought).toBe(true);
    expect(state.shop?.recruit?.bought).toBe(true);
  });

  it('カード・レリック・採用の予算境界は cost-1 不変 / cost ちょうど成立', () => {
    const cardShort = createEngine('ri-91-a4-card-short');
    const cardShortI = asInternals(cardShort);
    cardShortI.phase = 'shop';
    cardShortI.budget = 11;
    cardShortI.deck = [];
    cardShortI.shop = { cards: [{ defId: 'docs', cost: 12, bought: false }] };
    cardShort.buyShopCard('docs');
    expect(cardShort.snapshot()).toMatchObject({
      budget: 11,
      deck: [],
      shop: { cards: [{ defId: 'docs', cost: 12, bought: false }] },
    });

    const cardExact = createEngine('ri-91-a4-card-exact');
    const cardExactI = asInternals(cardExact);
    cardExactI.phase = 'shop';
    cardExactI.budget = 12;
    cardExactI.deck = [];
    cardExactI.shop = { cards: [{ defId: 'docs', cost: 12, bought: false }] };
    cardExact.buyShopCard('docs');
    expect(cardExact.snapshot()).toMatchObject({
      budget: 0,
      deck: [{ defId: 'docs', level: 1 }],
      status: 'lost',
      loseReason: 'budgetExhausted',
    });

    const relicShort = createEngine('ri-91-a4-relic-short');
    const relicShortI = asInternals(relicShort);
    relicShortI.phase = 'shop';
    relicShortI.budget = 29;
    relicShortI.relics = [];
    relicShortI.shop = {
      cards: [],
      relic: { id: 'postmortem', cost: 30, bought: false },
    };
    relicShort.buyShopRelic();
    expect(relicShort.snapshot()).toMatchObject({
      budget: 29,
      relics: [],
      shop: { relic: { id: 'postmortem', cost: 30, bought: false } },
    });

    const relicExact = createEngine('ri-91-a4-relic-exact');
    const relicExactI = asInternals(relicExact);
    relicExactI.phase = 'shop';
    relicExactI.budget = 30;
    relicExactI.relics = [];
    relicExactI.shop = {
      cards: [],
      relic: { id: 'postmortem', cost: 30, bought: false },
    };
    relicExact.buyShopRelic();
    expect(relicExact.snapshot()).toMatchObject({
      budget: 0,
      relics: ['postmortem'],
      status: 'lost',
      loseReason: 'budgetExhausted',
    });

    const recruitShort = createEngine('ri-91-a4-recruit-short');
    const recruitShortI = asInternals(recruitShort);
    recruitShortI.phase = 'shop';
    recruitShortI.budget = RECRUIT_COST - 1;
    recruitShortI.shop = {
      cards: [],
      recruit: { cost: RECRUIT_COST, bought: false },
    };
    const shortSize = recruitShortI.roster.members.length;
    recruitShort.buyShopRecruit();
    expect(recruitShort.snapshot()).toMatchObject({
      budget: RECRUIT_COST - 1,
      shop: { recruit: { cost: RECRUIT_COST, bought: false } },
    });
    expect(recruitShort.snapshot().roster.members).toHaveLength(shortSize);

    const recruitExact = createEngine('ri-91-a4-recruit-exact');
    const recruitExactI = asInternals(recruitExact);
    recruitExactI.phase = 'shop';
    recruitExactI.budget = RECRUIT_COST;
    recruitExactI.shop = {
      cards: [],
      recruit: { cost: RECRUIT_COST, bought: false },
    };
    const exactSize = recruitExactI.roster.members.length;
    recruitExact.buyShopRecruit();
    expect(recruitExact.snapshot()).toMatchObject({
      budget: 0,
      status: 'lost',
      loseReason: 'budgetExhausted',
      shop: { recruit: { cost: RECRUIT_COST, bought: true } },
    });
    expect(recruitExact.snapshot().roster.members).toHaveLength(exactSize + 1);
  });

  it('ショップ採用失敗時は bought を立てず、満員でも課金しない', () => {
    const full = createEngine('ri-91-a4-recruit-full');
    const fullI = asInternals(full);
    fullI.phase = 'shop';
    fullI.budget = 100;
    fullI.roster = fillRoster(fullI.roster);
    fullI.shop = {
      cards: [],
      recruit: { cost: RECRUIT_COST, bought: false },
    };
    full.buyShopRecruit();
    expect(full.snapshot()).toMatchObject({
      budget: 100,
      shop: { recruit: { cost: RECRUIT_COST, bought: false } },
    });
    expect(full.snapshot().roster.members).toHaveLength(ROSTER_CAP);

    const broke = createEngine('ri-91-a4-recruit-broke');
    const brokeI = asInternals(broke);
    brokeI.phase = 'shop';
    brokeI.budget = RECRUIT_COST - 1;
    brokeI.shop = {
      cards: [],
      recruit: { cost: RECRUIT_COST, bought: false },
    };
    broke.buyShopRecruit();
    expect(broke.snapshot().shop?.recruit?.bought).toBe(false);
  });

  it('REST_* 効果量は clamp 外入力で exact（加減算の変異を否定）', () => {
    // 仕様値をリテラルで固定（実装定数の同時変更では通さない）。
    const restHeal = 40;
    const restMoraleHeal = 10;
    const restStaminaRecover = 45;
    const restRepay = 30;
    const flowFirstBonus = 10;

    const heal = createEngine('ri-91-a4-rest-heal');
    const healI = asInternals(heal);
    healI.phase = 'rest';
    healI.relics = ['flow-first'];
    healI.org.seniorHp = 20;
    healI.org.morale = 40;
    healI.roster = {
      ...healI.roster,
      members: healI.roster.members.map((m, index) => (index === 0 ? { ...m, stamina: 10 } : m)),
    };

    heal.restChoose('heal');

    const healed = heal.snapshot();
    // + → - だと 20-40-10 → clamp 0、morale 40-10=30、stamina 10-45。
    expect(healed.org.seniorHp).toBe(20 + restHeal + flowFirstBonus);
    expect(healed.org.seniorHp).not.toBe(20 - restHeal - flowFirstBonus);
    expect(healed.org.morale).toBe(40 + restMoraleHeal);
    expect(healed.org.morale).not.toBe(40 - restMoraleHeal);
    expect(healed.roster.members[0].stamina).toBe(10 + restStaminaRecover);
    expect(healed.roster.members[0].stamina).not.toBe(10 - restStaminaRecover);
    expect(healed.phase).toBe('setup');

    const repay = createEngine('ri-91-a4-rest-repay');
    const repayI = asInternals(repay);
    repayI.phase = 'rest';
    repayI.org.techDebt = 100;
    repay.restChoose('repay');
    expect(repay.snapshot().org.techDebt).toBe(100 - restRepay);
    expect(repay.snapshot().org.techDebt).not.toBe(100 + restRepay);

    const repayFloor = createEngine('ri-91-a4-rest-repay-floor');
    const repayFloorI = asInternals(repayFloor);
    repayFloorI.phase = 'rest';
    repayFloorI.org.techDebt = restRepay - 10;
    repayFloor.restChoose('repay');
    expect(repayFloor.snapshot().org.techDebt).toBe(0);
  });

  it('upgrade の deckIndex 省略は ?? 0 で先頭だけ強化する', () => {
    const engine = createEngine('ri-91-a4-upgrade-default');
    const i = asInternals(engine);
    i.phase = 'rest';
    i.deck = [
      { defId: 'docs', level: 1 },
      { defId: 'auto-test', level: 2 },
    ];
    engine.restChoose('upgrade');
    expect(engine.snapshot().deck).toEqual([
      { defId: 'docs', level: 2 },
      { defId: 'auto-test', level: 2 },
    ]);
  });

  it('budget-discipline 割引はカード・レリックに効き、採用枠は割引なし', () => {
    const engine = createEngine('ri-91-a4-discount');
    const i = enterDecisionBeat(engine, 'shop-offer');
    i.budget = 100;
    i.relics = ['budget-discipline'];

    engine.resolveBeat(0);

    const state = engine.snapshot();
    expect(state.phase).toBe('shop');
    // shop RNG キー空文字 / sprintIndex ±1 は並びが変わる。
    expect(state.shop!.cards.map((c) => c.defId)).toEqual(['auto-test', 'pr-size-limit', 'docs']);
    // auto-test 18*0.8=14.4→14 / docs 15*0.8=12 / pr-size-limit 8*0.8=6.4→6 / relic 18*0.8=14.4→14
    expect(Object.fromEntries(state.shop!.cards.map((c) => [c.defId, c.cost]))).toEqual({
      'auto-test': 14,
      docs: 12,
      'pr-size-limit': 6,
    });
    expect(state.shop?.relic).toEqual({
      id: 'postmortem',
      cost: Math.round(SHOP_RELIC_COST * 0.8),
      bought: false,
    });
    expect(state.shop?.recruit).toEqual({ cost: RECRUIT_COST, bought: false });
    // * → / だと定価/0.8 になり割引後と一致しない。
    expect(state.shop?.relic?.cost).not.toBe(Math.round(SHOP_RELIC_COST / 0.8));
  });

  it('offerRelic は枠満杯または解放プール空なら relic なし', () => {
    // 枠ちょうど満杯でも、未所持の解放レリックが残っていればスキップする（>= → > / if false を潰す）。
    const fullSlots = createEngine('ri-91-a4-relic-full', {
      allowedRelics: new Set(['postmortem']),
    });
    const fullI = enterDecisionBeat(fullSlots, 'shop-offer');
    fullI.budget = 100;
    fullI.relics = RELIC_DEFS.filter((r) => r.id !== 'postmortem')
      .slice(0, 6)
      .map((r) => r.id);
    expect(fullI.relics).toHaveLength(6);
    expect(fullI.relics.includes('postmortem')).toBe(false);
    fullSlots.resolveBeat(0);
    expect(fullSlots.snapshot().shop?.relic).toBeUndefined();

    const emptyPool = createEngine('ri-91-a4-relic-empty', {
      allowedRelics: new Set(),
    });
    const emptyI = enterDecisionBeat(emptyPool, 'shop-offer');
    emptyI.budget = 100;
    emptyI.relics = [];
    emptyPool.resolveBeat(0);
    expect(emptyPool.snapshot().shop?.relic).toBeUndefined();
    expect(emptyPool.snapshot().shop?.recruit).toEqual({ cost: RECRUIT_COST, bought: false });
  });

  it('buyShopCard は defId 一致のみ購入し、phase 外の shop API は no-op', () => {
    // defId === defId → true だと先頭の未購入カードを誤購入する。
    const engine = createEngine('ri-91-a4-defid');
    const i = asInternals(engine);
    i.phase = 'shop';
    i.budget = 100;
    i.deck = [];
    i.shop = {
      cards: [
        { defId: 'auto-test', cost: 18, bought: false },
        { defId: 'docs', cost: 15, bought: false },
      ],
    };
    engine.buyShopCard('docs');
    expect(engine.snapshot()).toMatchObject({
      budget: 85,
      deck: [{ defId: 'docs', level: 1 }],
      shop: {
        cards: [
          { defId: 'auto-test', cost: 18, bought: false },
          { defId: 'docs', cost: 15, bought: true },
        ],
      },
    });

    // phase !== 'shop' を外す変異を潰す（shop 実体は残す）。
    const offPhase = createEngine('ri-91-a4-off-phase');
    const off = asInternals(offPhase);
    off.phase = 'setup';
    off.budget = 100;
    off.deck = [];
    off.relics = [];
    off.shop = {
      cards: [{ defId: 'docs', cost: 12, bought: false }],
      relic: { id: 'postmortem', cost: 30, bought: false },
      recruit: { cost: RECRUIT_COST, bought: false },
    };
    const rosterSize = off.roster.members.length;
    offPhase.buyShopCard('docs');
    offPhase.buyShopRelic();
    offPhase.buyShopRecruit();
    offPhase.leaveShop();
    expect(offPhase.snapshot()).toMatchObject({
      phase: 'setup',
      budget: 100,
      deck: [],
      relics: [],
      shop: {
        cards: [{ defId: 'docs', cost: 12, bought: false }],
        relic: { id: 'postmortem', cost: 30, bought: false },
        recruit: { cost: RECRUIT_COST, bought: false },
      },
    });
    expect(offPhase.snapshot().roster.members).toHaveLength(rosterSize);
  });

  it('shop=null でも buyShopRelic/Recruit は throw せず、空デッキ upgrade は強化も採用もしない', () => {
    // OptionalChaining 除去変異は shop=null で TypeError になる。
    const nullShop = createEngine('ri-91-a4-null-shop');
    const nullI = asInternals(nullShop);
    nullI.phase = 'shop';
    nullI.budget = 100;
    nullI.shop = null;
    expect(() => nullShop.buyShopRelic()).not.toThrow();
    expect(() => nullShop.buyShopRecruit()).not.toThrow();
    expect(nullShop.snapshot().budget).toBe(100);

    // deck.length > 0 を外すと空デッキでも upgradeCardAt が呼ばれる。
    // option === 'recruit' → true だと空デッキ upgrade が tryRecruit してしまう。
    const emptyUpgrade = createEngine('ri-91-a4-empty-upgrade');
    const emptyI = asInternals(emptyUpgrade);
    emptyI.phase = 'rest';
    emptyI.deck = [];
    emptyI.budget = 100;
    const beforeSize = emptyI.roster.members.length;
    const upgradeCallsBefore = upgradeCardAtMock.calls;
    emptyUpgrade.restChoose('upgrade');
    expect(upgradeCardAtMock.calls).toBe(upgradeCallsBefore);
    expect(emptyUpgrade.snapshot()).toMatchObject({
      phase: 'setup',
      budget: 100,
      deck: [],
    });
    expect(emptyUpgrade.snapshot().roster.members).toHaveLength(beforeSize);
  });

  it('採用 RNG キーと offerRelic 抽選の決定論を固定する', () => {
    // rng キー空文字 / sprintIndex ±1 変異は採用アーキタイプが変わる。
    const rest = createEngine('ri-91-a4-rng-key');
    const restI = asInternals(rest);
    restI.phase = 'rest';
    restI.budget = RECRUIT_COST + 25;
    const restBefore = new Set(restI.roster.members.map((m) => m.id));
    rest.restChoose('recruit');
    const restHired = rest.snapshot().roster.members.find((m) => !restBefore.has(m.id));
    expect(restHired).toMatchObject({
      id: 'm3',
      name: 'カエデ',
      rank: 'middle',
      traits: ['megaPrMaker'],
    });

    const shop = createEngine('ri-91-a4-shop-rng');
    const shopI = asInternals(shop);
    shopI.phase = 'shop';
    shopI.budget = 100;
    shopI.shop = { cards: [], recruit: { cost: RECRUIT_COST, bought: false } };
    const shopBefore = new Set(shopI.roster.members.map((m) => m.id));
    shop.buyShopRecruit();
    const shopHired = shop.snapshot().roster.members.find((m) => !shopBefore.has(m.id));
    expect(shopHired).toMatchObject({
      id: 'm3',
      name: 'アオイ',
      rank: 'middle',
      traits: ['megaPrMaker'],
    });

    const phase = createEngine('ri-91-a4-phase-rng');
    const phaseI = asInternals(phase);
    phaseI.phase = 'recruit';
    phaseI.budget = RECRUIT_COST + 25;
    const phaseBefore = new Set(phaseI.roster.members.map((m) => m.id));
    phase.recruitChoose('hire');
    const phaseHired = phase.snapshot().roster.members.find((m) => !phaseBefore.has(m.id));
    expect(phaseHired).toMatchObject({
      id: 'm3',
      name: 'サキ',
      rank: 'junior',
      traits: ['docMaster'],
    });

    // rng()*pool.length → / だと常に先頭（postmortem）になる。
    const multi = createEngine('ri-91-a4-pick2', {
      allowedRelics: new Set(['postmortem', 'doc-driven', 'small-pr', 'strong-ci']),
    });
    const multiI = enterDecisionBeat(multi, 'shop-offer');
    multiI.budget = 100;
    multiI.relics = [];
    multi.resolveBeat(0);
    expect(multi.snapshot().shop?.relic?.id).toBe('small-pr');
    expect(multi.snapshot().shop?.relic?.id).not.toBe('postmortem');
  });

  it('rest / recruitChoose の採用コスト境界と NoCoverage（同一ロスター参照）を刺す', () => {
    const short = createEngine('ri-91-a4-rest-recruit-short');
    const shortI = asInternals(short);
    shortI.phase = 'rest';
    shortI.budget = RECRUIT_COST - 1;
    const shortSize = shortI.roster.members.length;
    short.restChoose('recruit');
    expect(short.snapshot()).toMatchObject({
      phase: 'setup',
      budget: RECRUIT_COST - 1,
      status: 'playing',
    });
    expect(short.snapshot().roster.members).toHaveLength(shortSize);

    const exact = createEngine('ri-91-a4-rest-recruit-exact');
    const exactI = asInternals(exact);
    exactI.phase = 'rest';
    exactI.budget = RECRUIT_COST;
    const exactSize = exactI.roster.members.length;
    exact.restChoose('recruit');
    expect(exact.snapshot()).toMatchObject({
      budget: 0,
      status: 'lost',
      loseReason: 'budgetExhausted',
    });
    expect(exact.snapshot().roster.members).toHaveLength(exactSize + 1);

    // L1239: recruitMember が同一参照を返しても課金・bought 更新しない。
    recruitMemberMock.returnSame = true;
    const sameRef = createEngine('ri-91-a4-recruit-same-ref');
    const sameRefI = asInternals(sameRef);
    sameRefI.phase = 'shop';
    sameRefI.budget = 100;
    sameRefI.shop = {
      cards: [],
      recruit: { cost: RECRUIT_COST, bought: false },
    };
    const beforeSize = sameRefI.roster.members.length;
    sameRef.buyShopRecruit();
    expect(sameRef.snapshot()).toMatchObject({
      budget: 100,
      shop: { recruit: { cost: RECRUIT_COST, bought: false } },
    });
    expect(sameRef.snapshot().roster.members).toHaveLength(beforeSize);

    const restSame = createEngine('ri-91-a4-rest-same-ref');
    const restSameI = asInternals(restSame);
    restSameI.phase = 'rest';
    restSameI.budget = 100;
    const restBefore = restSameI.roster.members.length;
    restSame.restChoose('recruit');
    expect(restSame.snapshot()).toMatchObject({
      phase: 'setup',
      budget: 100,
      status: 'playing',
    });
    expect(restSame.snapshot().roster.members).toHaveLength(restBefore);
  });

  it('enterTeam の未知チーム id は !team で拒否する（L1368）', () => {
    const engine = new RunEngine({ seed: 'ri-91-a4-enter-missing', difficulty: 'easy' });
    engine.startRun();
    const before = engine.snapshot();
    expect(before.phase).not.toBe('title');

    expect(engine.enterTeam('no-such-team')).toBe(false);

    const after = engine.snapshot();
    expect(after.activeTeamId).toBe(before.activeTeamId);
    expect(after.zoom).toEqual(before.zoom);
    expect(after.phase).toBe(before.phase);
  });

  it('recruitChoose hire も採用コスト境界を守る', () => {
    const short = createEngine('ri-91-a4-phase-hire-short');
    const shortI = asInternals(short);
    shortI.phase = 'recruit';
    shortI.budget = RECRUIT_COST - 1;
    shortI.org.morale = 80;
    const shortSize = shortI.roster.members.length;
    short.recruitChoose('hire');
    // 採用失敗 → 見送りペナルティ経路へ。人数・予算は採用コスト分減らない。
    expect(short.snapshot().budget).toBe(RECRUIT_COST - 1);
    expect(short.snapshot().roster.members).toHaveLength(shortSize);

    const exact = createEngine('ri-91-a4-phase-hire-exact');
    const exactI = asInternals(exact);
    exactI.phase = 'recruit';
    exactI.budget = RECRUIT_COST;
    const exactSize = exactI.roster.members.length;
    exact.recruitChoose('hire');
    expect(exact.snapshot()).toMatchObject({
      budget: 0,
      status: 'lost',
      loseReason: 'budgetExhausted',
    });
    expect(exact.snapshot().roster.members).toHaveLength(exactSize + 1);
  });
});

describe('RI-72-D2 RunEngine shop / rest / recruit branches', () => {
  it('shop-offer choice enters shop and builds discounted fixed offers', () => {
    const engine = createEngine('ri-72-d2');
    const i = enterDecisionBeat(engine, 'shop-offer');
    i.budget = 100;
    i.relics = ['budget-discipline'];

    engine.resolveBeat(0);

    const state = engine.snapshot();
    expect(state.phase).toBe('shop');
    expect(state.beat).toBeNull();
    expect(state.shop?.cards).toHaveLength(3);
    expect(Object.fromEntries(state.shop!.cards.map((c) => [c.defId, c]))).toMatchObject({
      'auto-test': { cost: 14, bought: false },
      docs: { cost: 12, bought: false },
      'pr-size-limit': { cost: 6, bought: false },
    });
    expect(state.shop?.relic).toEqual({
      id: 'postmortem',
      cost: Math.round(SHOP_RELIC_COST * 0.8),
      bought: false,
    });
    expect(state.shop?.recruit).toEqual({ cost: RECRUIT_COST, bought: false });
  });

  it('rest and recruit beat choices enter their dedicated phases', () => {
    const restEngine = createEngine('ri-72-d2-rest-beat');
    const restInternals = enterDecisionBeat(restEngine, 'rest-offer');

    restEngine.resolveBeat(0);

    let state = restEngine.snapshot();
    expect(state.phase).toBe('rest');
    expect(state.pendingSprintModifiers).toEqual({ taskCountMul: 0.7 });
    expect(restInternals.beat).toBeNull();
    restEngine.restChoose('repay');
    expect(restEngine.snapshot().pendingSprintModifiers).toEqual({
      reworkRateAdd: -0.08,
      taskCountMul: 0.7,
    });

    const recruitEngine = createEngine('ri-72-d2-recruit-beat');
    enterDecisionBeat(recruitEngine, 'recruit-offer');

    recruitEngine.resolveBeat(0);

    state = recruitEngine.snapshot();
    expect(state.phase).toBe('recruit');
    expect(state.beat).toBeNull();
    expect(state.pendingSprintModifiers).toEqual({});
  });

  it('shop purchases card, relic, and recruit with exact costs before leaving', () => {
    const engine = createEngine('ri-72-d2');
    const i = asInternals(engine);
    i.phase = 'shop';
    i.budget = 80;
    i.deck = [];
    i.relics = [];
    i.shop = {
      cards: [{ defId: 'docs', cost: 12, bought: false }],
      relic: { id: 'postmortem', cost: SHOP_RELIC_COST, bought: false },
      recruit: { cost: RECRUIT_COST, bought: false },
    };
    const initialRosterSize = i.roster.members.length;

    engine.buyShopCard('docs');
    let state = engine.snapshot();
    expect(state.budget).toBe(68);
    expect(state.deck).toEqual([{ defId: 'docs', level: 1 }]);
    expect(state.shop?.cards[0]).toEqual({ defId: 'docs', cost: 12, bought: true });

    engine.buyShopRelic();
    state = engine.snapshot();
    expect(state.budget).toBe(68 - SHOP_RELIC_COST);
    expect(state.relics).toEqual(['postmortem']);
    expect(state.shop?.relic).toEqual({ id: 'postmortem', cost: SHOP_RELIC_COST, bought: true });

    engine.buyShopRecruit();
    state = engine.snapshot();
    expect(state.phase).toBe('shop');
    expect(state.budget).toBe(68 - SHOP_RELIC_COST - RECRUIT_COST);
    expect(state.roster.members).toHaveLength(initialRosterSize + 1);
    expect(state.roster.members.at(-1)).toMatchObject({ assignment: 'bench', aiAssigned: false });
    expect(state.shop?.recruit).toEqual({ cost: RECRUIT_COST, bought: true });

    engine.leaveShop();
    state = engine.snapshot();
    expect(state.phase).toBe('setup');
    expect(state.shop).toBeNull();
  });

  it('shop guards preserve state outside phase, without budget, or without roster slots', () => {
    const engine = createEngine('ri-72-d2');
    const i = asInternals(engine);
    i.phase = 'setup';
    i.budget = 50;
    i.deck = [];
    i.shop = {
      cards: [{ defId: 'docs', cost: 12, bought: false }],
      recruit: { cost: RECRUIT_COST, bought: false },
    };

    engine.buyShopCard('docs');
    let state = engine.snapshot();
    expect(state.budget).toBe(50);
    expect(state.deck).toEqual([]);
    expect(state.shop?.cards[0].bought).toBe(false);

    i.phase = 'shop';
    i.budget = 11;
    engine.buyShopCard('docs');
    engine.buyShopCard('auto-test');
    state = engine.snapshot();
    expect(state.budget).toBe(11);
    expect(state.deck).toEqual([]);
    expect(state.shop?.cards[0].bought).toBe(false);

    i.budget = 50;
    i.roster = fillRoster(i.roster);
    engine.buyShopRecruit();
    state = engine.snapshot();
    expect(state.budget).toBe(50);
    expect(state.roster.members).toHaveLength(ROSTER_CAP);
    expect(state.shop?.recruit?.bought).toBe(false);
  });

  it('shop exact-cost purchases still apply and can trigger budget exhaustion', () => {
    const cardEngine = createEngine('ri-72-d2-shop-card-exact');
    const card = asInternals(cardEngine);
    card.phase = 'shop';
    card.budget = 12;
    card.deck = [];
    card.shop = { cards: [{ defId: 'docs', cost: 12, bought: false }] };

    cardEngine.buyShopCard('docs');

    let state = cardEngine.snapshot();
    expect(state.status).toBe('lost');
    expect(state.loseReason).toBe('budgetExhausted');
    expect(state.budget).toBe(0);
    expect(state.deck).toEqual([{ defId: 'docs', level: 1 }]);

    const relicEngine = createEngine('ri-72-d2-shop-relic-exact');
    const relic = asInternals(relicEngine);
    relic.phase = 'shop';
    relic.budget = 30;
    relic.relics = [];
    relic.shop = {
      cards: [],
      relic: { id: 'postmortem', cost: 30, bought: false },
    };

    relicEngine.buyShopRelic();

    state = relicEngine.snapshot();
    expect(state.status).toBe('lost');
    expect(state.loseReason).toBe('budgetExhausted');
    expect(state.budget).toBe(0);
    expect(state.relics).toEqual(['postmortem']);

    const recruitEngine = createEngine('ri-72-d2-shop-recruit-exact');
    const recruit = asInternals(recruitEngine);
    recruit.phase = 'shop';
    recruit.budget = RECRUIT_COST;
    recruit.shop = {
      cards: [],
      recruit: { cost: RECRUIT_COST, bought: false },
    };
    const beforeRosterSize = recruit.roster.members.length;

    recruitEngine.buyShopRecruit();

    state = recruitEngine.snapshot();
    expect(state.status).toBe('lost');
    expect(state.loseReason).toBe('budgetExhausted');
    expect(state.budget).toBe(0);
    expect(state.roster.members).toHaveLength(beforeRosterSize + 1);
    expect(state.shop?.recruit?.bought).toBe(true);
  });

  it('rest choices apply heal, repay, upgrade, and recruit effects exactly', () => {
    const healEngine = createEngine('ri-72-d2-rest-heal');
    const heal = asInternals(healEngine);
    heal.phase = 'rest';
    heal.relics = ['flow-first'];
    heal.org.seniorHp = 50;
    heal.org.morale = 95;
    heal.roster = {
      ...heal.roster,
      members: heal.roster.members.map((m, index) => (index === 0 ? { ...m, stamina: 10 } : m)),
    };

    healEngine.restChoose('heal');

    let state = healEngine.snapshot();
    expect(state.phase).toBe('setup');
    expect(state.org.seniorHp).toBe(50 + REST_HEAL + 10);
    expect(state.org.morale).toBe(100);
    expect(state.roster.members[0].stamina).toBe(55);

    const repayEngine = createEngine('ri-72-d2-rest-repay');
    const repay = asInternals(repayEngine);
    repay.phase = 'rest';
    repay.org.techDebt = REST_REPAY - 10;
    repayEngine.restChoose('repay');
    expect(repayEngine.snapshot().org.techDebt).toBe(0);
    expect(repayEngine.snapshot().pendingSprintModifiers).toEqual({
      reworkRateAdd: REST_REPAY_REWORK_RATE,
    });

    const upgradeEngine = createEngine('ri-72-d2-rest-upgrade');
    const upgrade = asInternals(upgradeEngine);
    upgrade.phase = 'rest';
    upgrade.deck = [
      { defId: 'docs', level: 1 },
      { defId: 'auto-test', level: 2 },
    ];
    upgradeEngine.restChoose('upgrade', 1);
    expect(upgradeEngine.snapshot().deck).toEqual([
      { defId: 'docs', level: 1 },
      { defId: 'auto-test', level: 3 },
    ]);
    expect(upgradeEngine.snapshot().pendingSprintModifiers).toEqual({
      focusMaxAdd: REST_UPGRADE_FOCUS_MAX,
    });

    const defaultUpgradeEngine = createEngine('ri-72-d2-rest-upgrade-default');
    const defaultUpgrade = asInternals(defaultUpgradeEngine);
    defaultUpgrade.phase = 'rest';
    defaultUpgrade.deck = [
      { defId: 'docs', level: 1 },
      { defId: 'auto-test', level: 2 },
    ];
    defaultUpgradeEngine.restChoose('upgrade');
    expect(defaultUpgradeEngine.snapshot().deck).toEqual([
      { defId: 'docs', level: 2 },
      { defId: 'auto-test', level: 2 },
    ]);
    expect(defaultUpgradeEngine.snapshot().pendingSprintModifiers).toEqual({
      focusMaxAdd: REST_UPGRADE_FOCUS_MAX,
    });

    const emptyUpgradeEngine = createEngine('ri-72-d2-rest-upgrade-empty');
    const emptyUpgrade = asInternals(emptyUpgradeEngine);
    emptyUpgrade.phase = 'rest';
    emptyUpgrade.deck = [];
    emptyUpgradeEngine.restChoose('upgrade');
    expect(emptyUpgradeEngine.snapshot().phase).toBe('setup');
    expect(emptyUpgradeEngine.snapshot().deck).toEqual([]);

    const recruitEngine = createEngine('ri-72-d2-rest-recruit');
    const recruit = asInternals(recruitEngine);
    recruit.phase = 'rest';
    recruit.budget = RECRUIT_COST + 25;
    const beforeRecruitSize = recruit.roster.members.length;
    recruitEngine.restChoose('recruit');
    state = recruitEngine.snapshot();
    expect(state.phase).toBe('setup');
    expect(state.budget).toBe(25);
    expect(state.roster.members).toHaveLength(beforeRecruitSize + 1);
  });

  it('rest recruit exact cost hires before budget exhaustion loss', () => {
    const engine = createEngine('ri-72-d2');
    const i = asInternals(engine);
    i.phase = 'rest';
    i.budget = RECRUIT_COST;
    const beforeRosterSize = i.roster.members.length;

    engine.restChoose('recruit');

    const state = engine.snapshot();
    expect(state.status).toBe('lost');
    expect(state.phase).toBe('lost');
    expect(state.loseReason).toBe('budgetExhausted');
    expect(state.budget).toBe(0);
    expect(state.roster.members).toHaveLength(beforeRosterSize + 1);
  });

  it('restChoose guard ignores non-rest phases', () => {
    const engine = createEngine('ri-72-d2');
    const i = asInternals(engine);
    i.phase = 'setup';
    i.org.techDebt = 50;

    engine.restChoose('repay');

    const state = engine.snapshot();
    expect(state.phase).toBe('setup');
    expect(state.org.techDebt).toBe(50);
  });

  it('recruitChoose handles hire, failed hire penalty, and skip loss branches', () => {
    const hireEngine = createEngine('ri-72-d2-recruit-hire');
    const hire = asInternals(hireEngine);
    hire.phase = 'recruit';
    hire.budget = RECRUIT_COST + 25;
    hire.org.morale = 40;
    const beforeHireSize = hire.roster.members.length;

    hireEngine.recruitChoose('hire');

    let state = hireEngine.snapshot();
    expect(state.phase).toBe('setup');
    expect(state.budget).toBe(25);
    expect(state.org.morale).toBe(40);
    expect(state.roster.members).toHaveLength(beforeHireSize + 1);

    const failedHireEngine = createEngine('ri-72-d2-recruit-fail');
    const failedHire = asInternals(failedHireEngine);
    failedHire.phase = 'recruit';
    failedHire.budget = RECRUIT_COST - 1;
    failedHire.org.morale = 40;
    const failedHireSize = failedHire.roster.members.length;

    failedHireEngine.recruitChoose('hire');

    state = failedHireEngine.snapshot();
    expect(state.phase).toBe('setup');
    expect(state.budget).toBe(RECRUIT_COST - 1);
    expect(state.org.morale).toBe(40 + RECRUIT_SKIP_MORALE);
    expect(state.roster.members).toHaveLength(failedHireSize);

    const skipEngine = createEngine('ri-72-d2-recruit-skip-loss');
    const skip = asInternals(skipEngine);
    skip.phase = 'recruit';
    skip.budget = 50;
    skip.org.morale = 4;

    skipEngine.recruitChoose('skip');

    state = skipEngine.snapshot();
    expect(state.status).toBe('lost');
    expect(state.phase).toBe('lost');
    expect(state.loseReason).toBe('moraleCollapse');
  });

  it('recruit hire exact cost returns lost before setup', () => {
    const engine = createEngine('ri-72-d2');
    const i = asInternals(engine);
    i.phase = 'recruit';
    i.budget = RECRUIT_COST;
    const beforeRosterSize = i.roster.members.length;

    engine.recruitChoose('hire');

    const state = engine.snapshot();
    expect(state.status).toBe('lost');
    expect(state.phase).toBe('lost');
    expect(state.loseReason).toBe('budgetExhausted');
    expect(state.budget).toBe(0);
    expect(state.roster.members).toHaveLength(beforeRosterSize + 1);
  });

  it('recruitChoose guard ignores non-recruit phases', () => {
    const engine = createEngine('ri-72-d2');
    const i = asInternals(engine);
    i.phase = 'setup';
    i.budget = RECRUIT_COST + 25;
    const before = engine.snapshot();

    engine.recruitChoose('hire');

    const state = engine.snapshot();
    expect(state.phase).toBe('setup');
    expect(state.budget).toBe(before.budget);
    expect(state.roster).toEqual(before.roster);
  });
});

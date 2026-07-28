import { describe, expect, it } from 'vitest';
import { RECRUIT_SKIP_MORALE } from '../../src/data/events';
import { RECRUIT_COST, ROSTER_CAP } from '../../src/sim/member';
import type { RosterState } from '../../src/sim/member';
import { REST_HEAL, REST_REPAY, RunEngine } from '../../src/sim/run/engine';
import type { BeatState, CardInstance, RunState, ShopOffer } from '../../src/sim/run/types';
import type { OrgState } from '../../src/sim/types';

type EngineInternals = {
  phase: RunState['phase'];
  beat: BeatState | null;
  pendingSprintModifiers: RunState['pendingSprintModifiers'];
  sprintIndexInQuarter: number;
  org: OrgState;
  deck: CardInstance[];
  relics: string[];
  roster: RosterState;
  budget: number;
  shop: ShopOffer | null;
};

const SHOP_CARDS = new Set(['auto-test', 'docs', 'pr-size-limit']);

function createEngine(seed = 'ri-72-d2'): RunEngine {
  const engine = new RunEngine({
    seed,
    difficulty: 'normal',
    allowedCards: SHOP_CARDS,
    allowedRelics: new Set(['postmortem']),
  });
  engine.startRun();
  return engine;
}

function internals(engine: RunEngine): EngineInternals {
  return engine as unknown as EngineInternals;
}

function enterDecisionBeat(engine: RunEngine, eventId: string): EngineInternals {
  const i = internals(engine);
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

describe('RI-72-D2 RunEngine shop / rest / recruit branches', () => {
  it('shop-offer choice enters shop and builds discounted fixed offers', () => {
    const engine = createEngine();
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
    expect(state.shop?.relic).toEqual({ id: 'postmortem', cost: 24, bought: false });
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

    const recruitEngine = createEngine('ri-72-d2-recruit-beat');
    enterDecisionBeat(recruitEngine, 'recruit-offer');

    recruitEngine.resolveBeat(0);

    state = recruitEngine.snapshot();
    expect(state.phase).toBe('recruit');
    expect(state.beat).toBeNull();
    expect(state.pendingSprintModifiers).toEqual({});
  });

  it('shop purchases card, relic, and recruit with exact costs before leaving', () => {
    const engine = createEngine();
    const i = internals(engine);
    i.phase = 'shop';
    i.budget = 80;
    i.deck = [];
    i.relics = [];
    i.shop = {
      cards: [{ defId: 'docs', cost: 12, bought: false }],
      relic: { id: 'postmortem', cost: 30, bought: false },
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
    expect(state.budget).toBe(38);
    expect(state.relics).toEqual(['postmortem']);
    expect(state.shop?.relic).toEqual({ id: 'postmortem', cost: 30, bought: true });

    engine.buyShopRecruit();
    state = engine.snapshot();
    expect(state.phase).toBe('shop');
    expect(state.budget).toBe(13);
    expect(state.roster.members).toHaveLength(initialRosterSize + 1);
    expect(state.roster.members.at(-1)).toMatchObject({ assignment: 'bench', aiAssigned: false });
    expect(state.shop?.recruit).toEqual({ cost: RECRUIT_COST, bought: true });

    engine.leaveShop();
    state = engine.snapshot();
    expect(state.phase).toBe('setup');
    expect(state.shop).toBeNull();
  });

  it('shop guards preserve state outside phase, without budget, or without roster slots', () => {
    const engine = createEngine();
    const i = internals(engine);
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
    const card = internals(cardEngine);
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
    const relic = internals(relicEngine);
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
    const recruit = internals(recruitEngine);
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
    const heal = internals(healEngine);
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
    const repay = internals(repayEngine);
    repay.phase = 'rest';
    repay.org.techDebt = REST_REPAY - 10;
    repayEngine.restChoose('repay');
    expect(repayEngine.snapshot().org.techDebt).toBe(0);

    const upgradeEngine = createEngine('ri-72-d2-rest-upgrade');
    const upgrade = internals(upgradeEngine);
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

    const defaultUpgradeEngine = createEngine('ri-72-d2-rest-upgrade-default');
    const defaultUpgrade = internals(defaultUpgradeEngine);
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

    const emptyUpgradeEngine = createEngine('ri-72-d2-rest-upgrade-empty');
    const emptyUpgrade = internals(emptyUpgradeEngine);
    emptyUpgrade.phase = 'rest';
    emptyUpgrade.deck = [];
    emptyUpgradeEngine.restChoose('upgrade');
    expect(emptyUpgradeEngine.snapshot().phase).toBe('setup');
    expect(emptyUpgradeEngine.snapshot().deck).toEqual([]);

    const recruitEngine = createEngine('ri-72-d2-rest-recruit');
    const recruit = internals(recruitEngine);
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
    const engine = createEngine();
    const i = internals(engine);
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
    const engine = createEngine();
    const i = internals(engine);
    i.phase = 'setup';
    i.org.techDebt = 50;

    engine.restChoose('repay');

    const state = engine.snapshot();
    expect(state.phase).toBe('setup');
    expect(state.org.techDebt).toBe(50);
  });

  it('recruitChoose handles hire, failed hire penalty, and skip loss branches', () => {
    const hireEngine = createEngine('ri-72-d2-recruit-hire');
    const hire = internals(hireEngine);
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
    const failedHire = internals(failedHireEngine);
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
    const skip = internals(skipEngine);
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
    const engine = createEngine();
    const i = internals(engine);
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
    const engine = createEngine();
    const i = internals(engine);
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

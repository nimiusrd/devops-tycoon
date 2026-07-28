import { describe, expect, it } from 'vitest';
import { RECRUIT_COST } from '../../src/sim/member';
import type { RosterState } from '../../src/sim/member';
import type { TeamRunState } from '../../src/sim/orgscale/types';
import { RunEngine } from '../../src/sim/run/engine';
import type { RunPhase, ShopOffer } from '../../src/sim/run/types';
import type { OrgState, SprintState, Task } from '../../src/sim/types';

type EngineInternals = {
  activeTeamId: string;
  budget: number;
  org: OrgState;
  phase: RunPhase;
  relics: string[];
  roster: RosterState;
  shop: ShopOffer | null;
  sprint: SprintState | null;
  teamLockUntilSprint: number;
  teams: TeamRunState[];
  usedHeavyActions: boolean;
};

const asInternals = (engine: RunEngine): EngineInternals => engine as unknown as EngineInternals;

const taskFrom = (base: Task, patch: Partial<Task>): Task => ({
  ...base,
  id: patch.id ?? base.id,
  lane: patch.lane ?? base.lane,
  progress: patch.progress ?? base.progress,
  incident: patch.incident ?? false,
  burnTicksLeft: patch.burnTicksLeft,
  reworkAttempts: patch.reworkAttempts ?? 0,
  wasReworked: patch.wasReworked ?? false,
  debt: patch.debt ?? false,
});

describe('RI-72-D5 RunEngine survived mutants', () => {
  it('heavy action だけが usedHeavyActions を立て、通常アクションでは立てない', () => {
    const engine = new RunEngine({ seed: 'ri-72-d5-survived-heavy', difficulty: 'easy' });
    engine.startRun();
    engine.beginSetupSprint();
    const i = asInternals(engine);
    i.sprint!.focus = 100;

    expect(engine.dispatch('aiThrottle').ok).toBe(true);
    expect(i.usedHeavyActions).toBe(false);

    expect(engine.dispatch('overtime').ok).toBe(true);
    expect(i.usedHeavyActions).toBe(true);
  });

  it('shop relic と recruit の guard/成功を公開 API 経由で固定する', () => {
    const engine = new RunEngine({ seed: 'ri-72-d5-survived-shop', difficulty: 'easy' });
    engine.startRun();
    const i = asInternals(engine);
    i.phase = 'shop';
    i.budget = 100;

    i.shop = { cards: [] };
    engine.buyShopRelic();
    expect(i.budget).toBe(100);
    expect(i.relics).toEqual([]);

    i.shop = { cards: [], relic: { id: 'psych-safety', cost: 20, bought: true } };
    engine.buyShopRelic();
    expect(i.budget).toBe(100);
    expect(i.relics).toEqual([]);

    i.shop = { cards: [], relic: { id: 'psych-safety', cost: 120, bought: false } };
    engine.buyShopRelic();
    expect(i.budget).toBe(100);
    expect(i.relics).toEqual([]);

    i.shop = { cards: [], relic: { id: 'psych-safety', cost: 20, bought: false } };
    engine.buyShopRelic();
    expect(i.budget).toBe(80);
    expect(i.relics).toEqual(['psych-safety']);
    expect(i.shop.relic?.bought).toBe(true);

    i.shop = { cards: [], relic: { id: 'psych-safety', cost: 20, bought: false } };
    engine.buyShopRelic();
    expect(i.budget).toBe(80);
    expect(i.relics).toEqual(['psych-safety']);

    i.shop = { cards: [] };
    engine.buyShopRecruit();
    expect(i.budget).toBe(80);

    i.shop = { cards: [], recruit: { cost: RECRUIT_COST, bought: true } };
    engine.buyShopRecruit();
    expect(i.budget).toBe(80);

    i.shop = { cards: [], recruit: { cost: RECRUIT_COST, bought: false } };
    engine.buyShopRecruit();
    expect(i.budget).toBe(80 - RECRUIT_COST);
    expect(i.shop.recruit?.bought).toBe(true);
  });

  it('sprint 中の orgScale は正本チームではなくライブ盤面の行列と炎上数を使う', () => {
    const engine = new RunEngine({ seed: 'ri-72-d5-survived-live-board', difficulty: 'easy' });
    engine.startRun();
    engine.beginSetupSprint();
    const i = asInternals(engine);
    const active = i.teams.find((team) => team.id === i.activeTeamId)!;
    active.reviewQueue = 0;
    active.incidents = 0;

    const base = i.sprint!.tasks[0]!;
    i.sprint!.tasks = [
      taskFrom(base, { id: 200, lane: 'review', incident: false }),
      taskFrom(base, { id: 201, lane: 'review', incident: true, burnTicksLeft: 4 }),
      taskFrom(base, { id: 202, lane: 'rework', incident: true, burnTicksLeft: 2 }),
    ];
    engine.zoomTo('company');

    const activeProjection = engine
      .snapshot()
      .orgScale!.departments.flatMap((department) => department.teams)
      .find((team) => team.id === i.activeTeamId)!;

    expect(activeProjection.reviewQueue).toBe(2);
    expect(activeProjection.incidents).toBe(2);
    expect(activeProjection.engineers).toBeGreaterThanOrEqual(i.roster.members.length);
  });

  it('active team のチームレバーは sprint 盤面とチーム正本の review/incidents を同期する', () => {
    const engine = new RunEngine({ seed: 'ri-72-d5-survived-align', difficulty: 'easy' });
    engine.startRun();
    engine.beginSetupSprint();
    const i = asInternals(engine);
    i.budget = 100;
    i.teamLockUntilSprint = 0;
    i.sprint!.metrics.contained = 0;

    const base = i.sprint!.tasks[0]!;
    i.sprint!.tasks = [
      taskFrom(base, { id: 300, lane: 'review', incident: false, progress: 0.2 }),
      taskFrom(base, { id: 301, lane: 'review', incident: false, progress: 0.4 }),
      taskFrom(base, { id: 302, lane: 'review', incident: true, burnTicksLeft: 5 }),
      taskFrom(base, { id: 303, lane: 'rework', incident: true, burnTicksLeft: 2 }),
    ];

    expect(engine.applyOrgLever('teamReviewHelp', undefined, i.activeTeamId)).toBe(true);

    const remainingReviews = i.sprint!.tasks.filter((task) => task.lane === 'review');
    const remainingIncidents = i.sprint!.tasks.filter((task) => task.incident);
    const active = i.teams.find((team) => team.id === i.activeTeamId)!;
    expect(remainingReviews).toHaveLength(1);
    expect(remainingIncidents).toHaveLength(2);
    expect(active.reviewQueue).toBe(1);
    expect(active.incidents).toBe(2);
  });
});

import { describe, expect, it } from 'vitest';
import { RunEngine } from '../../src/sim/run/engine';
import type { RunPersistState, RunReplayFrame } from '../../src/sim/run/persist';
import type { BeatState, RunState, ShopOffer } from '../../src/sim/run/types';

type PersistInternals = {
  phase: RunState['phase'];
  beat: BeatState | null;
  draft: string[] | null;
  shop: ShopOffer | null;
};

function started(seed = 'ri72-d3-hydrate'): RunEngine {
  const engine = new RunEngine({ seed, difficulty: 'normal' });
  engine.startRun('normal', [], seed, { kind: 'daily', dailyDate: '2026-07-28' });
  return engine;
}

function setupSave(seed = 'ri72-d3-save'): RunPersistState {
  const state = started(seed).exportPersistState();
  if (!state) throw new Error('setup save fixture was not exportable');
  return state;
}

function asPersistState(state: RunPersistState, patch: Partial<RunState>): RunPersistState {
  return { ...structuredClone(state), ...patch } as RunPersistState;
}

function asReplayFrame(state: RunPersistState, patch: Partial<RunState>): RunReplayFrame {
  return { ...structuredClone(state), ...patch } as RunReplayFrame;
}

describe('RI-72-D3 RunEngine hydrate / save-restore', () => {
  it('export は save/replay 可能 phase と playing status の境界を区別する', () => {
    const engine = new RunEngine({
      seed: 'ri72-d3-export-guard',
      difficulty: 'normal',
      allowedCards: new Set(['docs', 'auto-test']),
      allowedRelics: new Set(['postmortem']),
    });
    engine.startRun('normal', ['frontier-dependency'], 'ri72-d3-export-guard');
    const internals = engine as unknown as { phase: RunState['phase']; status: RunState['status'] };

    expect(engine.exportPersistState()).toMatchObject({
      phase: 'setup',
      status: 'playing',
      trials: ['frontier-dependency'],
      extras: {
        allowedCards: ['docs', 'auto-test'],
        allowedRelics: ['postmortem'],
      },
    });

    internals.status = 'won';
    expect(engine.exportPersistState()).toBeNull();

    internals.status = 'playing';
    internals.phase = 'shop';
    expect(engine.exportReplayFrame()).toBeNull();

    internals.phase = 'lost';
    internals.status = 'lost';
    expect(engine.exportReplayFrame()).toMatchObject({ phase: 'lost', status: 'lost' });
  });

  it('exportPersistState は beat / draft / shop の復元対象フィールドを clone して保存する', () => {
    const engine = started('ri72-d3-export-clone');
    const internals = engine as unknown as PersistInternals;

    internals.phase = 'beat';
    internals.beat = { eventId: 'urgent-demo', kind: 'decision' };
    const beatSave = engine.exportPersistState();
    expect(beatSave?.beat).toEqual({ eventId: 'urgent-demo', kind: 'decision' });
    internals.beat.eventId = 'mutated-after-export';
    expect(beatSave?.beat).toEqual({ eventId: 'urgent-demo', kind: 'decision' });

    internals.phase = 'draft';
    internals.draft = ['docs', 'auto-test'];
    const draftSave = engine.exportPersistState();
    expect(draftSave?.draft).toEqual(['docs', 'auto-test']);
    internals.draft.push('copilot');
    expect(draftSave?.draft).toEqual(['docs', 'auto-test']);

    internals.phase = 'shop';
    internals.shop = {
      cards: [{ defId: 'docs', cost: 4, bought: false }],
      relic: { id: 'postmortem', cost: 12, bought: false },
      recruit: { cost: 8, bought: false },
    };
    const shopSave = engine.exportPersistState();
    expect(shopSave?.shop).toEqual({
      cards: [{ defId: 'docs', cost: 4, bought: false }],
      relic: { id: 'postmortem', cost: 12, bought: false },
      recruit: { cost: 8, bought: false },
    });
    internals.shop.relic!.cost = 99;
    internals.shop.recruit!.bought = true;
    expect(shopSave?.shop?.relic).toEqual({ id: 'postmortem', cost: 12, bought: false });
    expect(shopSave?.shop?.recruit).toEqual({ cost: 8, bought: false });
  });

  it('hydratePersistState は save 不可 phase と playing 以外の save を拒否する', () => {
    const base = setupSave('ri72-d3-invalid-save');
    const restored = started('ri72-d3-invalid-target');

    expect(() => restored.hydratePersistState(asPersistState(base, { phase: 'sprint' }))).toThrow(
      'cannot hydrate run save in phase=sprint status=playing',
    );
    expect(() =>
      restored.hydratePersistState(asPersistState(base, { phase: 'setup', status: 'won' })),
    ).toThrow('cannot hydrate run save in phase=setup status=won');
    expect(() =>
      restored.hydratePersistState(asPersistState(base, { phase: 'lost', status: 'lost' })),
    ).toThrow('cannot hydrate run save in phase=lost status=lost');

    expect(restored.snapshot().seed).toBe('ri72-d3-invalid-target');
    expect(restored.snapshot().phase).toBe('setup');
  });

  it('hydratePersistState は valid save の phase と extras を復元し sprint 実行状態を落とす', () => {
    const source = started('ri72-d3-valid-save');
    expect(source.enterTeam('platform-t1')).toBe(true);
    const state = source.exportPersistState();
    if (!state) throw new Error('entered team save was not exportable');
    state.phase = 'draft';
    state.draft = ['docs', 'auto-test'];
    state.pendingSprintModifiers = { focusMaxAdd: -2, reviewLoadAdd: 3 };
    state.extras.coarseIncidentCarry = 1.25;

    const restored = started('ri72-d3-valid-dirty');
    restored.beginSetupSprint();
    expect(restored.snapshot().sprint).not.toBeNull();

    restored.hydratePersistState(state);
    state.draft.push('copilot');
    state.extras.coarseIncidentCarry = 9;

    const snap = restored.snapshot();
    expect(snap).toMatchObject({
      seed: 'ri72-d3-valid-save',
      difficulty: 'normal',
      runKind: 'daily',
      dailyDate: '2026-07-28',
      phase: 'draft',
      status: 'playing',
      activeTeamId: 'platform-t1',
      teamLockUntilSprint: 1,
      pendingSprintModifiers: { focusMaxAdd: -2, reviewLoadAdd: 3 },
      draft: ['docs', 'auto-test'],
      sprint: null,
      sprintTick: 0,
      whatIf: null,
      whatIfStatus: 'idle',
    });
    expect(restored.exportPersistState()?.extras.coarseIncidentCarry).toBeCloseTo(1.25, 8);
    expect(restored.whatIfComputeInput()).toMatchObject({
      phase: 'draft',
      seed: 'ri72-d3-valid-save',
      draft: ['docs', 'auto-test'],
      teamReviewQueue: snap.teams.find((t) => t.id === 'platform-t1')?.reviewQueue,
      teamIncidents: snap.teams.find((t) => t.id === 'platform-t1')?.incidents,
    });
  });

  it('hydratePersistState は旧 save extras の欠落値を既定値へ補完する', () => {
    const legacy = setupSave('ri72-d3-legacy-save');
    legacy.org.deliveryScore = 12.4;
    legacy.totals.delivered = 99;
    legacy.totals.incidents = 7;
    legacy.totals.contained = 2;
    legacy.extras.coarseIncidentCarry = -2;
    delete (legacy.extras as { teams?: unknown }).teams;
    delete (legacy.extras as { activeTeamId?: unknown }).activeTeamId;
    delete (legacy.extras as { homeTeamId?: unknown }).homeTeamId;
    delete (legacy.extras as { teamLockUntilSprint?: unknown }).teamLockUntilSprint;
    delete (legacy.extras as { teamRosters?: unknown }).teamRosters;
    delete (legacy.extras as { preferredCardIds?: unknown }).preferredCardIds;
    delete (legacy.extras.orgAdjust as { byTeam?: unknown }).byTeam;

    const restored = started('ri72-d3-legacy-target');
    restored.hydratePersistState(legacy);

    const snap = restored.snapshot();
    const persistedAgain = restored.exportPersistState();
    expect(snap.activeTeamId).toBe('product-t0');
    expect(snap.homeTeamId).toBe('product-t0');
    expect(snap.teamLockUntilSprint).toBe(0);
    expect(snap.totals.delivered).toBe(12);
    expect(snap.teams.find((t) => t.id === 'product-t0')).toMatchObject({
      reviewQueue: 0,
      incidents: 5,
    });
    expect(persistedAgain?.extras.coarseIncidentCarry).toBe(0);
    expect(persistedAgain?.extras.preferredCardIds).toEqual([]);
    expect(persistedAgain?.extras.orgAdjust.byTeam).toEqual({});
    expect(persistedAgain?.extras.teamRosters?.['product-t0']).toEqual(snap.roster);
  });

  it('hydratePersistState は旧 save の extraTeams を product 部門へ追加し baseline を継承する', () => {
    const legacy = setupSave('ri72-d3-legacy-extra-teams');
    legacy.deck = [{ defId: 'auto-test', level: 1, baselineAppliedLevel: 1 }];
    legacy.extras.orgAdjust.company.extraTeams = 2;
    delete (legacy.extras as { teams?: unknown }).teams;
    delete (legacy.extras as { activeTeamId?: unknown }).activeTeamId;

    const restored = started('ri72-d3-legacy-extra-target');
    restored.hydratePersistState(legacy);

    const snap = restored.snapshot();
    const productIds = snap.teams.filter((t) => t.deptId === 'product').map((t) => t.id);
    expect(productIds.slice(-2)).toEqual(['product-t4', 'product-t5']);
    expect(snap.deck[0]?.baselineAppliedByTeam).toMatchObject({
      'product-t0': 1,
      'product-t4': 1,
      'product-t5': 1,
    });
  });

  it('hydrateReplayFrame は replay 対象 phase だけを受け入れ、終端 lost を復元できる', () => {
    const base = setupSave('ri72-d3-replay');
    const restored = started('ri72-d3-replay-target');

    expect(() => restored.hydrateReplayFrame(asReplayFrame(base, { phase: 'shop' }))).toThrow(
      'cannot hydrate replay frame in phase=shop',
    );

    const lost = asReplayFrame(base, {
      phase: 'lost',
      status: 'lost',
      loseReason: 'budgetExhausted',
    });
    restored.hydrateReplayFrame(lost);

    expect(restored.snapshot()).toMatchObject({
      seed: 'ri72-d3-replay',
      phase: 'lost',
      status: 'lost',
      loseReason: 'budgetExhausted',
    });
    expect(restored.exportPersistState()).toBeNull();
    expect(restored.exportReplayFrame()).toMatchObject({
      phase: 'lost',
      status: 'lost',
      loseReason: 'budgetExhausted',
    });
  });
});

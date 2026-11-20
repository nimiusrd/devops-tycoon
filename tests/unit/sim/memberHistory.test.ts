import { describe, expect, it } from 'vitest';
import { MEMBER_BALANCE } from '../../../src/data/balance';
import { xpForLevel } from '../../../src/sim/member';
import { HOME_TEAM_ID } from '../../../src/sim/orgscale';
import { createRng } from '../../../src/sim/rng';
import { RunEngine } from '../../../src/sim/run/engine';
import type { RunPersistState } from '../../../src/sim/run/persist';
import { normalizeReplayKeyframes } from '../../../src/state/replay';
import { parseRunSave, toRunSave } from '../../../src/state/runPersistence';
import { parseRunSaveShare, serializeRunSave } from '../../../src/state/runSaveShare';

const SEED = 'ri213-member-history';
const SHARED_NAME = 'アオイ';

function setup(): RunEngine {
  const engine = new RunEngine({ seed: SEED, difficulty: 'easy' });
  engine.startRun();
  return engine;
}

function restore(state: RunPersistState): RunEngine {
  const engine = new RunEngine();
  engine.hydratePersistState(state);
  return engine;
}

function finishSprint(engine: RunEngine): void {
  engine.beginSetupSprint();
  expect(engine.snapshot().phase).toBe('sprint');
  engine.step(1_000_000);
  expect(engine.snapshot().phase).toBe('result');
}

function nearFirstPromotion(state: RunPersistState): void {
  const level = MEMBER_BALANCE.promotionMiddleLevel.value - 1;
  for (const member of state.roster.members.slice(0, 2)) {
    Object.assign(member, {
      name: SHARED_NAME,
      rank: 'junior',
      level,
      xp: xpForLevel(level) - 1,
    });
  }
}

describe('現在ランの人物の経歴', () => {
  it('実際の初昇格と休職を記録し、同名をIDで区別して当時の内容を保つ', () => {
    const initial = setup().exportPersistState()!;
    nearFirstPromotion(initial);
    const [first, second] = initial.roster.members;
    second!.stamina = 0;
    const engine = restore(initial);

    finishSprint(engine);

    const result = engine.snapshot();
    expect(result.lastGrowth?.promotions).toHaveLength(2);
    expect(result.lastGrowth?.wentOnLeave).toEqual([{ id: second!.id, name: SHARED_NAME }]);
    const events = [
      ...[first!, second!].map(({ id }) => ({
        kind: 'promotion',
        teamId: HOME_TEAM_ID,
        id,
        name: SHARED_NAME,
        to: 'middle',
        sprintNumber: 1,
      })),
      {
        kind: 'leave',
        reason: 'exhaustion',
        teamId: HOME_TEAM_ID,
        id: second!.id,
        name: SHARED_NAME,
        sprintNumber: 1,
      },
    ];
    expect(result.memberHistory).toEqual({ startedAfterSprint: 0, events });
    expect(result.roster.members.find((member) => member.id === second!.id)?.onLeave).toBe(true);

    engine.step(1_000_000);
    expect(engine.snapshot().memberHistory).toEqual(result.memberHistory);
    const duplicateRun = restore(initial);
    finishSprint(duplicateRun);
    expect(duplicateRun.snapshot()).toEqual(result);

    const untracked = new RunEngine();
    const comparisonFrame = restore(initial).exportCounterfactualFrame()!;
    delete comparisonFrame.persist.memberHistory;
    untracked.hydrateCounterfactualFrame(comparisonFrame);
    finishSprint(untracked);
    expect(untracked.snapshot().memberHistory).toBeUndefined();
    const { memberHistory: recordedHistory, ...trackedState } = result;
    expect(untracked.snapshot()).toEqual(trackedState);

    const frame = engine.exportReplayFrame()!;
    const shared = parseRunSaveShare(
      serializeRunSave(toRunSave(engine.exportPersistState()!, 0, [{ phase: 'result', frame }])),
    );
    expect(shared.ok).toBe(true);
    if (!shared.ok) throw new Error(shared.reason);
    const resumed = restore(shared.save.state);
    expect(resumed.snapshot().memberHistory).toEqual(result.memberHistory);
    const replay = new RunEngine();
    replay.hydrateReplayFrame(shared.save.replayKeyframes[0]!.frame);
    expect(replay.snapshot().memberHistory).toEqual(recordedHistory);

    const next = resumed.exportPersistState()!;
    next.phase = 'setup';
    const level = MEMBER_BALANCE.promotionSeniorLevel.value - 1;
    Object.assign(next.roster.members[0]!, {
      name: '現在の名前',
      level,
      xp: xpForLevel(level) - 1,
    });
    const grown = restore(next);
    finishSprint(grown);
    expect(grown.snapshot().lastGrowth?.promotions).toContainEqual({
      id: first!.id,
      name: '現在の名前',
      to: 'senior',
    });
    expect(grown.snapshot().memberHistory?.events.slice(0, events.length)).toEqual(events);
    expect(
      grown.snapshot().memberHistory?.events.filter((event) => event.kind === 'promotion'),
    ).toEqual(events.slice(0, 2));
    expect(replay.snapshot().memberHistory).toEqual(recordedHistory);
  });

  it('休職の回復をチーム別に保存し、再復帰も既存の通知制限と独立して記録する', () => {
    const initial = setup().exportPersistState()!;
    const otherTeamId = initial.extras.teams!.find(({ id }) => id !== HOME_TEAM_ID)!.id;
    const member = initial.roster.members[0]!;
    const returned = {
      ...member,
      name: SHARED_NAME,
      onLeave: true,
      assignment: 'bench' as const,
      aiAssigned: false,
      stamina: 0,
      staminaMax: 50,
    };
    initial.roster.members[0] = { ...returned };
    initial.extras.teamRosters![otherTeamId] = {
      ...initial.roster,
      members: [{ ...returned }, ...initial.roster.members.slice(1)],
    };
    const engine = restore(initial);

    finishSprint(engine);

    const base = { kind: 'return', id: member.id, name: SHARED_NAME };
    const events = [
      { ...base, teamId: HOME_TEAM_ID, sprintNumber: 1 },
      { ...base, teamId: otherTeamId, sprintNumber: 1 },
    ];
    expect(engine.snapshot().memberHistory?.events).toEqual(events);
    expect(engine.snapshot().leaveReturns).toEqual([{ id: member.id, name: SHARED_NAME }]);

    const rest = engine.exportPersistState()!;
    rest.phase = 'rest';
    rest.sprintsPlayed = 2;
    delete rest.extras.pendingLeaveReturns;
    rest.roster.members[0] = { ...returned };
    const resting = restore(rest);
    resting.restChoose('heal');
    resting.restChoose('heal');
    expect(resting.snapshot().memberHistory?.events).toEqual([
      ...events,
      { ...base, teamId: HOME_TEAM_ID, sprintNumber: 2 },
    ]);
    expect(resting.snapshot().leaveReturns).toEqual([]);

    expect(resting.enterTeam(otherTeamId)).toBe(true);
    const otherTeam = resting.snapshot();
    expect(otherTeam.roster.members.find(({ id }) => id === member.id)?.onLeave).toBe(false);
    expect(
      otherTeam.memberHistory?.events.filter(
        ({ teamId, id }) => teamId === otherTeam.activeTeamId && id === member.id,
      ),
    ).toEqual([events[1]]);
  });

  it('同じスプリント番号の復帰と四半期レビューでの再編休職を両方残す', () => {
    const state = setup().exportPersistState()!;
    state.sprintIndexInQuarter = state.sprintsPerQuarter - 1;
    state.sprintsPlayed = state.sprintIndexInQuarter;
    const index = Math.floor(createRng(`${SEED}:reorg:q1`)() * state.roster.members.length);
    const member = state.roster.members[index]!;
    Object.assign(member, {
      onLeave: true,
      assignment: 'bench',
      aiAssigned: false,
      stamina: 0,
      staminaMax: 50,
    });
    const engine = restore(state);
    finishSprint(engine);
    engine.acknowledgeResult();

    const review = engine.exportPersistState()!;
    expect(review.phase).toBe('quarterReview');
    expect(review.quarterReview).not.toBeNull();
    review.quarterReview!.outcome = 'missed_adjustable';
    review.quarterReview!.availableAdjustments = ['reorg_teams'];
    const adjusted = restore(review);
    adjusted.chooseGoalAdjustment('reorg_teams');
    adjusted.chooseGoalAdjustment('reorg_teams');
    const next = adjusted.snapshot();
    const identity = { id: member.id, name: member.name, teamId: HOME_TEAM_ID };
    expect(next.phase).toBe('setup');
    expect(next.roster.members.find(({ id }) => id === member.id)?.onLeave).toBe(true);
    expect(next.memberHistory?.events).toEqual([
      { ...identity, kind: 'return', sprintNumber: state.sprintsPerQuarter },
      {
        ...identity,
        kind: 'leave',
        reason: 'reorganization',
        sprintNumber: state.sprintsPerQuarter,
      },
    ]);
  });

  it('旧セーブは再開時点から記録し、旧リプレイに経歴を補わない', () => {
    const engine = setup();
    const state = engine.exportPersistState()!;
    const person = state.roster.members[0]!;
    const identity = { id: person.id, name: person.name };
    state.sprintsPlayed = 3;
    state.lastGrowth = {
      promotions: [{ ...identity, to: 'middle' }],
      leveledUp: [person.id],
      wentOnLeave: [identity],
      docGain: 0,
    };
    Object.assign(person, { onLeave: true, assignment: 'bench', aiAssigned: false, stamina: 0 });
    delete state.memberHistory;

    engine.hydrateReplayFrame(state);
    expect(engine.snapshot().memberHistory).toBeUndefined();
    expect(engine.exportReplayFrame()).not.toHaveProperty('memberHistory');

    const resumed = restore({ ...state, phase: 'rest' });
    expect(resumed.snapshot().memberHistory).toEqual({ startedAfterSprint: 3, events: [] });
    resumed.restChoose('heal');
    expect(resumed.snapshot().memberHistory).toEqual({
      startedAfterSprint: 3,
      events: [{ ...identity, kind: 'return', teamId: HOME_TEAM_ID, sprintNumber: 3 }],
    });
    resumed.startRun();
    expect(resumed.snapshot().memberHistory).toEqual({ startedAfterSprint: 0, events: [] });
  });

  it('保存とリプレイの読取境界で重複した記録と未来の記録を拒否する', () => {
    const state = setup().exportPersistState()!;
    const event = {
      kind: 'promotion' as const,
      teamId: HOME_TEAM_ID,
      id: 'm0',
      name: SHARED_NAME,
      to: 'middle' as const,
      sprintNumber: 1,
    };
    state.sprintsPlayed = 1;
    state.memberHistory = { startedAfterSprint: 0, events: [event, { ...event }] };

    expect(parseRunSave(toRunSave(state, 0))).toBeNull();
    expect(normalizeReplayKeyframes([{ phase: state.phase, frame: state }])).toEqual([]);

    state.memberHistory.events = [{ ...event, sprintNumber: 2 }];
    expect(parseRunSave(toRunSave(state, 0))).toBeNull();
    expect(normalizeReplayKeyframes([{ phase: state.phase, frame: state }])).toEqual([]);
  });
});

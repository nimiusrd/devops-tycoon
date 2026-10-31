import { describe, expect, it } from 'vitest';
import {
  membersReturnedFromLeave,
  planLeaveReturnNotices,
  recoverStamina,
  REST_STAMINA_RECOVER,
  STAMINA_RECOVER_BETWEEN,
} from '../../../src/sim/member';
import type { LeaveReturnNotice, Member, RosterState } from '../../../src/sim/member/types';
import { HOME_TEAM_ID } from '../../../src/sim/orgscale/teamState';
import { RunEngine } from '../../../src/sim/run/engine';
import type { GrowthOutcome } from '../../../src/sim/run/types';
import { leaveReturnNoticeText } from '../../../src/render/leaveReturnNoticeView';
import { completeSprint, makeOrg, zeroTotals } from '../helpers/runEngineFixtures';

function member(overrides: Partial<Member> = {}): Member {
  return {
    id: 'm0',
    name: 'アオイ',
    rank: 'junior',
    level: 1,
    xp: 0,
    stats: { implementation: 40, review: 30, aiMastery: 20 },
    stamina: 0,
    staminaMax: 80,
    traits: [],
    assignment: 'bench',
    aiAssigned: false,
    onLeave: true,
    ...overrides,
  };
}

function roster(members: Member[]): RosterState {
  return { members, nextId: members.length };
}

describe('休職復帰の通知計画', () => {
  it('回復で休職が解けた人だけを、名前つきで一度ずつ返す', () => {
    const before = roster([
      member({ id: 'm0', name: 'アオイ' }),
      member({ id: 'm1', name: 'ハルキ', stamina: 10, staminaMax: 80 }),
      member({ id: 'm2', name: 'ミナ', onLeave: false, assignment: 'coding', stamina: 40 }),
      member({ id: 'm0', name: 'アオイ' }),
    ]);
    const after = recoverStamina(before, REST_STAMINA_RECOVER);
    expect(after.members.map((person) => person.onLeave)).toEqual([false, false, false, false]);
    expect(membersReturnedFromLeave(before.members, after.members)).toEqual([
      { id: 'm0', name: 'アオイ' },
      { id: 'm1', name: 'ハルキ' },
    ]);
    expect(leaveReturnNoticeText('アオイ')).toBe('アオイが復帰しました（ベンチ）');
  });

  it('閾値未満・スキップ・ベンチ以外は通知しない', () => {
    const staying = roster([member({ staminaMax: 200 })]);
    const stillLeave = recoverStamina(staying, REST_STAMINA_RECOVER);
    expect(stillLeave.members[0]?.onLeave).toBe(true);
    expect(membersReturnedFromLeave(staying.members, stillLeave.members)).toEqual([]);

    const skipped = roster([member()]);
    const held = recoverStamina(skipped, STAMINA_RECOVER_BETWEEN, new Set(['m0']));
    expect(membersReturnedFromLeave(skipped.members, held.members)).toEqual([]);

    const coding = roster([member({ assignment: 'coding' })]);
    const returnedToCoding = {
      ...coding,
      members: [{ ...coding.members[0]!, onLeave: false, assignment: 'coding' as const }],
    };
    expect(membersReturnedFromLeave(coding.members, returnedToCoding.members)).toEqual([]);
  });

  it('同じランで通知済みの人はもう載せない', () => {
    const returned: LeaveReturnNotice[] = [
      { id: 'm0', name: 'アオイ' },
      { id: 'm1', name: 'ハルキ' },
      { id: 'm0', name: 'アオイ' },
    ];
    expect(planLeaveReturnNotices(returned, [])).toEqual([
      { id: 'm0', name: 'アオイ' },
      { id: 'm1', name: 'ハルキ' },
    ]);
    expect(planLeaveReturnNotices(returned, ['m0'])).toEqual([{ id: 'm1', name: 'ハルキ' }]);
    expect(planLeaveReturnNotices(returned, ['m0', 'm1'])).toEqual([]);
  });
});

describe('RunEngine の休職復帰通知', () => {
  type Internals = {
    phase: 'rest' | 'sprint' | 'setup';
    roster: RosterState;
    org: ReturnType<typeof makeOrg>;
    totals: ReturnType<typeof zeroTotals>;
    currentSprintId: string | null;
    currentSprintKind: 'normal';
    sprint: ReturnType<typeof completeSprint> | null;
    sprintBaselineInput: null;
    lastGrowth: GrowthOutcome | null;
    applyGrowth(): void;
    resolveSprint(): void;
  };

  const internals = (engine: RunEngine): Internals => engine as unknown as Internals;

  function leave(engine: RunEngine, ids: readonly string[], staminaMax = 80): void {
    const state = internals(engine);
    state.roster = {
      ...state.roster,
      members: state.roster.members.map((person) =>
        ids.includes(person.id)
          ? {
              ...person,
              onLeave: true,
              assignment: 'bench' as const,
              stamina: 0,
              staminaMax,
              aiAssigned: false,
            }
          : person,
      ),
    };
  }

  it('休息で複数人が戻ると、編成画面にそれぞれの名前が一度ずつ出る', () => {
    const engine = new RunEngine({ seed: 'leave-return-rest', difficulty: 'easy' });
    engine.startRun();
    const state = internals(engine);
    const names = new Map(state.roster.members.map((person) => [person.id, person.name]));
    const ids = state.roster.members.slice(0, 2).map((person) => person.id);
    leave(engine, ids);
    state.phase = 'rest';
    engine.restChoose('heal');

    const snap = engine.snapshot();
    expect(snap.phase).toBe('setup');
    expect(snap.leaveReturns).toEqual(ids.map((id) => ({ id, name: names.get(id) })));
    expect(new Set(snap.leaveReturns?.map((person) => person.id)).size).toBe(ids.length);
    for (const person of snap.leaveReturns ?? []) {
      expect(leaveReturnNoticeText(person.name)).toBe(`${person.name}が復帰しました（ベンチ）`);
      expect(snap.roster.members.find((member) => member.id === person.id)).toMatchObject({
        onLeave: false,
        assignment: 'bench',
      });
    }
  });

  it('スプリントを始めると通知は消え、同じ人の再復帰は同じランで知らせない', () => {
    const engine = new RunEngine({ seed: 'leave-return-once', difficulty: 'easy' });
    engine.startRun();
    const state = internals(engine);
    const first = state.roster.members[0]!;
    const second = state.roster.members[1]!;
    leave(engine, [first.id]);
    state.phase = 'rest';
    engine.restChoose('heal');
    expect(engine.snapshot().leaveReturns?.map((person) => person.id)).toEqual([first.id]);

    engine.beginSetupSprint();
    expect(engine.snapshot().leaveReturns).toEqual([]);

    leave(engine, [first.id, second.id]);
    state.phase = 'rest';
    engine.restChoose('heal');
    expect(engine.snapshot().leaveReturns).toEqual([{ id: second.id, name: second.name }]);
  });

  it('スプリント間の回復でも復帰を記録し、休職直後の人はまだ通知しない', () => {
    const engine = new RunEngine({ seed: 'leave-return-between', difficulty: 'easy' });
    engine.startRun();
    const state = internals(engine);
    const person = state.roster.members[0]!;
    state.phase = 'sprint';
    state.currentSprintKind = 'normal';
    state.currentSprintId = 'q1-s1';
    state.org = makeOrg();
    state.totals = zeroTotals();
    state.sprint = completeSprint('leave-return-between', state.org);
    state.sprintBaselineInput = null;
    leave(engine, [person.id], 50);
    state.applyGrowth = () => {
      state.lastGrowth = { promotions: [], leveledUp: [], wentOnLeave: [], docGain: 0 };
    };

    state.resolveSprint();
    expect(engine.snapshot().leaveReturns).toEqual([{ id: person.id, name: person.name }]);
    expect(
      engine.snapshot().roster.members.find((member) => member.id === person.id)?.onLeave,
    ).toBe(false);

    const skipped = new RunEngine({ seed: 'leave-return-just-left', difficulty: 'easy' });
    skipped.startRun();
    const skippedState = internals(skipped);
    const justLeft = skippedState.roster.members[0]!;
    skippedState.phase = 'sprint';
    skippedState.currentSprintKind = 'normal';
    skippedState.currentSprintId = 'q1-s1';
    skippedState.org = makeOrg();
    skippedState.totals = zeroTotals();
    skippedState.sprint = completeSprint('leave-return-just-left', skippedState.org);
    skippedState.sprintBaselineInput = null;
    leave(skipped, [justLeft.id], 50);
    skippedState.applyGrowth = () => {
      skippedState.lastGrowth = {
        promotions: [],
        leveledUp: [],
        wentOnLeave: [{ id: justLeft.id, name: justLeft.name }],
        docGain: 0,
      };
    };
    skippedState.resolveSprint();
    expect(skipped.snapshot().leaveReturns).toEqual([]);
    expect(
      skipped.snapshot().roster.members.find((member) => member.id === justLeft.id)?.onLeave,
    ).toBe(true);
  });

  it('セーブして戻しても、出した通知と同じ人の再通知は残る', () => {
    const engine = new RunEngine({ seed: 'leave-return-save', difficulty: 'easy' });
    engine.startRun();
    const state = internals(engine);
    const person = state.roster.members[0]!;
    leave(engine, [person.id]);
    state.phase = 'rest';
    engine.restChoose('heal');
    const saved = engine.exportPersistState();
    expect(saved?.extras.pendingLeaveReturns?.[HOME_TEAM_ID]).toEqual([
      { id: person.id, name: person.name },
    ]);

    const restored = new RunEngine({ seed: 'leave-return-save-other', difficulty: 'easy' });
    restored.hydratePersistState(saved!);
    expect(restored.snapshot().leaveReturns).toEqual([{ id: person.id, name: person.name }]);
    restored.beginSetupSprint();
    expect(restored.snapshot().leaveReturns).toEqual([]);

    const restoredState = internals(restored);
    leave(restored, [person.id]);
    restoredState.phase = 'rest';
    restored.restChoose('heal');
    expect(restored.snapshot().leaveReturns).toEqual([]);
    expect(restored.exportPersistState()?.extras.pendingLeaveReturns).toBeUndefined();
    expect(restored.exportPersistState()?.extras.announcedLeaveReturnKeys).toContain(
      `${HOME_TEAM_ID}:${person.id}`,
    );
  });
});

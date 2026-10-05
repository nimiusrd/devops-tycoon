import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/absence-release-comparison.json';
import { assignMember } from '../sim/member/roster';
import {
  advanceAbsenceReleasePeriod,
  compareAbsenceReleaseStrategies,
  createAbsenceReleasePrototype,
  previewAbsenceRelease,
} from './absenceRelease';

describe('予定不在のリリース準備', () => {
  it.each(['normal', 'frontload', 'handover'] as const)(
    '%sでも残り体力の範囲だけ処理し、払えない育成を実施しない',
    (preparation) => {
      const initial = createAbsenceReleasePrototype(1, preparation);
      const { mentorId, apprenticeId } = initial.handover.mentorship;
      for (const id of [mentorId, apprenticeId])
        initial.handover.mentorship.roster.members.find((member) => member.id === id)!.stamina = 1;
      const next = advanceAbsenceReleasePeriod(initial);
      expect(next.history[0]).toMatchObject({
        reviewWork: 2,
        overtimeWork: 0,
        teachingCost: 0,
        specialistStaminaSpent: 1,
        successorStaminaSpent: 1,
        remaining: 38,
      });
      expect(next.handover.mentorship.lessons).toBe(0);
      expect(
        next.handover.mentorship.roster.members.find((member) => member.id === apprenticeId)!.stats
          .review,
      ).toBe(32);
      expect(
        next.handover.mentorship.roster.members
          .filter((member) => [mentorId, apprenticeId].includes(member.id))
          .every((member) => member.stamina === 0),
      ).toBe(true);
    },
  );

  it.each([
    [2, 1, false],
    [3, 0, false],
    [3, 1, true],
  ] as const)(
    '育成余力%s/%sで実施可否と費用が一致する',
    (mentorBudget, apprenticeBudget, taught) => {
      const state = createAbsenceReleasePrototype(1, 'handover');
      const { mentorId, apprenticeId } = state.handover.mentorship;
      state.handover.mentorship.roster.members.find((member) => member.id === mentorId)!.stamina =
        mentorBudget;
      state.handover.mentorship.roster.members.find(
        (member) => member.id === apprenticeId,
      )!.stamina = apprenticeBudget;
      const next = advanceAbsenceReleasePeriod(state);
      expect(next.handover.mentorship.history[0].taught).toBe(taught);
      expect(next.history[0].teachingCost).toBe(taught ? 4 : 0);
      expect(next.handover.mentorship.roster.members.every((member) => member.stamina >= 0)).toBe(
        true,
      );
    },
  );

  it('不在中の保存状態を再配置しても主力は働かず、元の配置へ復帰する', () => {
    let state = createAbsenceReleasePrototype(1, 'normal');
    state = advanceAbsenceReleasePeriod(advanceAbsenceReleasePeriod(state));
    state = JSON.parse(JSON.stringify(state));
    state.handover.mentorship.roster = assignMember(
      state.handover.mentorship.roster,
      state.absence.memberId,
      'review',
    );
    for (let period = 3; period <= 5; period += 1) {
      state = advanceAbsenceReleasePeriod(state);
      expect(state.absence.active).toBe(true);
      expect(state.history[period - 1].reviewWork).toBe(3);
      expect(state.handover.mentorship.history[period - 1].mentorWork).toBe(0);
      expect(
        state.handover.mentorship.roster.members.find(
          (member) => member.id === state.absence.memberId,
        )!.assignment,
      ).toBe('bench');
    }
    const returned = advanceAbsenceReleasePeriod(state);
    expect(
      returned.handover.mentorship.roster.members.find(
        (member) => member.id === returned.absence.memberId,
      )!.assignment,
    ).toBe('review');
  });
  it('記録した同条件の比較を再現する', () => {
    expect(compareAbsenceReleaseStrategies(comparison.seed)).toEqual(comparison.results);
  });
  it('準備前に同じ人物の不在開始・復帰・費用を予告する', () => {
    const state = createAbsenceReleasePrototype(1, 'handover');
    expect(previewAbsenceRelease(state)).toMatchObject({
      memberId: state.handover.mentorship.mentorId,
      announcedAt: 0,
      preparationPeriod: 1,
      absentFrom: 2,
      returnsAt: 6,
      deadline: 6,
      remaining: 40,
      handoverMentorCapacityCost: 3,
      handoverSuccessorCapacityCost: 1,
    });
    expect(state.handover.mentorship.period).toBe(0);
  });

  it('前倒しと育成を成果・費用・不在中の能力に分けて比較する', () => {
    const [normal, frontload, handover] = compareAbsenceReleaseStrategies('RI-261');
    expect(frontload.preparationDelivered).toBeGreaterThan(handover.preparationDelivered);
    expect(handover.absenceDelivered).toBeGreaterThan(frontload.absenceDelivered);
    expect(frontload.specialistStaminaSpent).toBeGreaterThan(handover.specialistStaminaSpent);
    expect(handover.teachingCost).toBe(4);
    expect(normal.teachingCost).toBe(0);
    for (const result of [normal, frontload, handover]) {
      expect(result.delivered + result.remaining).toBe(40);
      expect(result.history.reduce((sum, row) => sum + row.reviewWork + row.overtimeWork, 0)).toBe(
        result.delivered,
      );
    }
    expect(compareAbsenceReleaseStrategies('RI-261')).toEqual([normal, frontload, handover]);
  });

  it.each(['normal', 'frontload', 'handover'] as const)(
    '%sの全境界でJSON再開が同じ人物・復帰・残量になる',
    (preparation) => {
      let state = createAbsenceReleasePrototype(1, preparation);
      const original = structuredClone(state);
      for (let period = 1; period <= 6; period += 1) {
        const restored = JSON.parse(JSON.stringify(state));
        const next = advanceAbsenceReleasePeriod(state);
        expect(advanceAbsenceReleasePeriod(restored)).toEqual(next);
        expect(state.handover.mentorship.period).toBe(period - 1);
        expect(next.absence.active).toBe(period >= 2 && period < 6);
        const person = next.handover.mentorship.roster.members.find(
          (m) => m.id === next.absence.memberId,
        )!;
        expect(person.onLeave).toBe(false);
        expect(person.assignment).toBe(period >= 2 && period < 6 ? 'bench' : 'review');
        if (period === 6) expect(next.absence.returned).toBe(true);
        state = next;
      }
      expect(original.absence.returned).toBe(false);
      expect(advanceAbsenceReleasePeriod(state)).toBe(state);
      expect(state.history.filter((row) => row.period === 6)).toHaveLength(1);
      expect(state.handover.mentorship.roster.members.map((m) => m.id)).toEqual(
        original.handover.mentorship.roster.members.map((m) => m.id),
      );
    },
  );

  it('予定不在の復帰が疲労休職を解除しない', () => {
    let state = createAbsenceReleasePrototype(1, 'normal');
    state.handover.mentorship.roster.members.find((m) => m.id === state.absence.memberId)!.onLeave =
      true;
    while (state.handover.mentorship.period < 6) state = advanceAbsenceReleasePeriod(state);
    expect(
      state.handover.mentorship.roster.members.find((m) => m.id === state.absence.memberId),
    ).toMatchObject({ onLeave: true, assignment: 'bench' });
    expect(state.history[5].reviewWork).toBe(3);
  });

  it('仕事を尽くした場合は前倒しを二重計上せず、体力0では教えられない', () => {
    const empty = createAbsenceReleasePrototype(1, 'frontload');
    empty.handover.mentorship.backlog = 0;
    const result = advanceAbsenceReleasePeriod(empty);
    expect(result.handover.mentorship.delivered).toBe(0);
    expect(result.history[0].overtimeWork).toBe(0);
    const exhausted = createAbsenceReleasePrototype(1, 'handover');
    exhausted.handover.mentorship.roster.members.find(
      (m) => m.id === exhausted.absence.memberId,
    )!.stamina = 0;
    expect(advanceAbsenceReleasePeriod(exhausted).history[0].teachingCost).toBe(0);
  });
});

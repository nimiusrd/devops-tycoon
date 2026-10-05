import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/absence-release-comparison.json';
import {
  advanceAbsenceReleasePeriod,
  compareAbsenceReleaseStrategies,
  createAbsenceReleasePrototype,
  previewAbsenceRelease,
} from './absenceRelease';

describe('予定不在のリリース準備', () => {
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

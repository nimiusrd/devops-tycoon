import { describe, expect, it } from 'vitest';
import { assignMember, recoverStamina } from '../sim/member/roster';
import { createAbsenceReleasePrototype, compareAbsenceReleaseStrategies } from './absenceRelease';
import { applyPlannedAbsence, createPlannedAbsence, previewPlannedAbsence } from './plannedAbsence';
import type { PlannedAbsence } from './plannedAbsence';

const setup = () => {
  const run = createAbsenceReleasePrototype('RI-205', 'normal');
  return { roster: run.handover.mentorship.roster, id: run.absence.memberId };
};

describe('予定不在の編成モデル', () => {
  it('共通型で保持したリリース予定にも理由を保存し、直接プレビューできる', () => {
    const run = createAbsenceReleasePrototype('RI-205', 'normal');
    const saved: PlannedAbsence = JSON.parse(JSON.stringify(run.absence));
    expect(previewPlannedAbsence(run.handover.mentorship.roster, saved).reason).toBe('vacation');
    const next = applyPlannedAbsence(run.handover.mentorship.roster, saved, saved.start);
    expect(next.absence.reason).toBe('vacation');
  });
  it.each(['vacation', 'training', 'business-trip'] as const)(
    '理由%sを開始前に確認し、同じ人物が一度復帰する',
    (reason) => {
      const { roster, id } = setup();
      const schedule = createPlannedAbsence(roster, id, reason, 2, 4);
      expect(previewPlannedAbsence(roster, schedule)).toMatchObject({
        memberId: id,
        reason,
        announcedAt: 0,
        absentFrom: 2,
        returnsAt: 4,
        onLeave: false,
      });
      const first = applyPlannedAbsence(roster, schedule, 1);
      expect(first.absence.active).toBe(false);
      const absent = applyPlannedAbsence(first.roster, first.absence, 2);
      const tampered = assignMember(absent.roster, id, 'coding');
      tampered.members.find((m) => m.id === id)!.aiAssigned = true;
      const stillAbsent = applyPlannedAbsence(tampered, absent.absence, 3);
      expect(stillAbsent.roster.members.find((m) => m.id === id)).toMatchObject({
        assignment: 'bench',
        aiAssigned: false,
      });
      const returned = applyPlannedAbsence(stillAbsent.roster, stillAbsent.absence, 4);
      expect(returned.roster.members.find((m) => m.id === id)).toMatchObject({
        assignment: 'review',
      });
      expect(returned.absence).toMatchObject({ active: false, returned: true });
      const reassigned = assignMember(returned.roster, id, 'coding');
      expect(applyPlannedAbsence(reassigned, returned.absence, 5).roster).toEqual(reassigned);
      expect(
        applyPlannedAbsence(stillAbsent.roster, JSON.parse(JSON.stringify(stillAbsent.absence)), 4),
      ).toEqual(returned);
      expect(roster.members.find((m) => m.id === id)!.assignment).toBe('review');
      expect(returned.roster.members.map((m) => m.id)).toEqual(roster.members.map((m) => m.id));
    },
  );
  it('休職が先に回復しても予定終了まで不在を維持する', () => {
    const { roster, id } = setup();
    const person = roster.members.find((m) => m.id === id)!;
    person.onLeave = true;
    person.assignment = 'bench';
    person.stamina = 0;
    const schedule = createPlannedAbsence(roster, id, 'vacation', 1, 3);
    const absent = applyPlannedAbsence(roster, schedule, 1);
    const recovered = recoverStamina(absent.roster, 100);
    expect(recovered.members.find((m) => m.id === id)!.onLeave).toBe(false);
    const next = applyPlannedAbsence(assignMember(recovered, id, 'review'), absent.absence, 2);
    expect(next.roster.members.find((m) => m.id === id)!.assignment).toBe('bench');
  });
  it('予定終了で休職を解除せず、回復後も控えから再配置する', () => {
    const { roster, id } = setup();
    const schedule = createPlannedAbsence(roster, id, 'vacation', 1, 2);
    const absent = applyPlannedAbsence(roster, schedule, 1);
    const person = absent.roster.members.find((m) => m.id === id)!;
    person.onLeave = true;
    person.stamina = 0;
    const returned = applyPlannedAbsence(absent.roster, absent.absence, 2);
    expect(returned.roster.members.find((m) => m.id === id)).toMatchObject({
      onLeave: true,
      assignment: 'bench',
    });
    const recovered = recoverStamina(returned.roster, 100);
    expect(
      applyPlannedAbsence(recovered, returned.absence, 3).roster.members.find((m) => m.id === id),
    ).toMatchObject({ onLeave: false, assignment: 'bench' });
  });
  it('CodingのAI配布を一度だけ復元する', () => {
    const { roster, id } = setup();
    const coderRoster = assignMember(roster, id, 'coding');
    coderRoster.members.find((m) => m.id === id)!.aiAssigned = true;
    const absent = applyPlannedAbsence(
      coderRoster,
      createPlannedAbsence(coderRoster, id, 'business-trip', 1, 2),
      1,
    );
    expect(
      applyPlannedAbsence(absent.roster, absent.absence, 2).roster.members.find((m) => m.id === id),
    ).toMatchObject({ assignment: 'coding', aiAssigned: true });
  });
  it.each([
    [0, 2],
    [2, 2],
    [3, 2],
    [1.5, 3],
    [1, Infinity],
  ])('不正期間%s/%sを拒否する', (start, end) => {
    const { roster, id } = setup();
    expect(() => createPlannedAbsence(roster, id, 'vacation', start, end)).toThrow();
  });
  it('前倒しと代打育成の成果・費用を同条件で比較する', () => {
    const results = compareAbsenceReleaseStrategies('RI-205');
    expect(results[1].preparationDelivered).toBeGreaterThan(results[2].preparationDelivered);
    expect(results[2].absenceDelivered).toBeGreaterThan(results[1].absenceDelivered);
    expect(results[1].specialistStaminaSpent).toBeGreaterThan(results[2].specialistStaminaSpent);
  });
});

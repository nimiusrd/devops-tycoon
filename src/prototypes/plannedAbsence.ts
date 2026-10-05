import { assignMember } from '../sim/member/roster';
import type { LaneAssignment, RosterState } from '../sim/member/types';

export type AbsenceReason = 'vacation' | 'training' | 'business-trip';

/** 試作の期間はスプリント相当。予定不在と疲労休職を別々に保持する。 */
export interface PlannedAbsence {
  memberId: string;
  announcedAt: number;
  start: number;
  end: number;
  active: boolean;
  returned: boolean;
  returnAssignment: LaneAssignment | null;
  returnAiAssigned: boolean;
}

export function createPlannedAbsence(
  roster: RosterState,
  memberId: string,
  reason: AbsenceReason,
  start = 2,
  end = 6,
) {
  if (!roster.members.some((member) => member.id === memberId))
    throw new Error('不在対象の人物が存在しない');
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end <= start)
    throw new Error('不在期間は開始から復帰までの正の整数');
  return {
    memberId,
    reason,
    announcedAt: 0,
    start,
    end,
    active: false,
    returned: false,
    returnAssignment: null,
    returnAiAssigned: false,
  } satisfies PlannedAbsence & { reason: AbsenceReason };
}

/** 期首に適用する。配置・AIの再設定では不在を解除できない。 */
export function applyPlannedAbsence<T extends PlannedAbsence>(
  before: RosterState,
  schedule: T,
  period: number,
): { roster: RosterState; absence: T } {
  if (!Number.isInteger(period) || period < 1) throw new Error('期は正の整数');
  let roster = structuredClone(before);
  const absence = { ...schedule };
  const person = roster.members.find((member) => member.id === absence.memberId);
  if (!person) throw new Error('不在対象の人物が存在しない');
  if (period >= absence.start && !absence.active && !absence.returned) {
    absence.returnAssignment = person.assignment;
    absence.returnAiAssigned = person.aiAssigned;
    absence.active = true;
  }
  if (period >= absence.end && absence.active) {
    absence.active = false;
    absence.returned = true;
    if (!person.onLeave && absence.returnAssignment !== null)
      roster = assignMember(roster, absence.memberId, absence.returnAssignment);
    const returning = roster.members.find((member) => member.id === absence.memberId)!;
    returning.aiAssigned =
      !returning.onLeave && returning.assignment === 'coding' && absence.returnAiAssigned;
  }
  const current = roster.members.find((member) => member.id === absence.memberId)!;
  if (absence.active || current.onLeave) {
    current.assignment = 'bench';
    current.aiAssigned = false;
  }
  return { roster, absence };
}

/** 編成の事前確認用。休職解除の判定は既存recoverStaminaに任せる。 */
export function previewPlannedAbsence(
  roster: RosterState,
  absence: PlannedAbsence & { reason: AbsenceReason },
) {
  const member = roster.members.find((person) => person.id === absence.memberId);
  if (!member) throw new Error('不在対象の人物が存在しない');
  return {
    memberId: member.id,
    name: member.name,
    assignment: member.assignment,
    reason: absence.reason,
    announcedAt: absence.announcedAt,
    absentFrom: absence.start,
    returnsAt: absence.end,
    onLeave: member.onLeave,
    active: absence.active,
    canWork: !member.onLeave && !absence.active,
  };
}

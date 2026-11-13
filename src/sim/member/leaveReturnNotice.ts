/**
 * 休職復帰の通知計画（#937）。
 *
 * スタミナ回復で休職が解けた人だけを、編成画面へ一度ずつ載せる。
 * 同じ id は引数の中でも、このランで通知済みの id でも、繰り返さない。
 * 復帰先はベンチだけを知らせる（休職入りでベンチに固定される）。
 */
import type { LaneAssignment, LeaveReturnNotice } from './types';

interface LeaveMember {
  id: string;
  name: string;
  onLeave: boolean;
}

interface ReturnedMember extends LeaveMember {
  assignment: LaneAssignment;
}

/** 回復の前後で、休職が解けてベンチにいるメンバーをロスター順に返す。 */
export function membersReturnedFromLeave(
  before: readonly LeaveMember[],
  after: readonly ReturnedMember[],
): LeaveReturnNotice[] {
  const afterById = new Map(after.map((member) => [member.id, member]));
  const notices: LeaveReturnNotice[] = [];
  const seen = new Set<string>();
  for (const member of before) {
    if (!member.onLeave || seen.has(member.id)) continue;
    const next = afterById.get(member.id);
    if (!next || next.onLeave || next.assignment !== 'bench') continue;
    seen.add(member.id);
    notices.push({ id: next.id, name: next.name });
  }
  return notices;
}

/**
 * 復帰者のうち、まだ通知していない人だけを順に残す。
 * `announcedIds` と今回の重複はどちらも一度だけにする。
 */
export function planLeaveReturnNotices(
  returned: readonly LeaveReturnNotice[],
  announcedIds: readonly string[],
): LeaveReturnNotice[] {
  const announced = new Set(announcedIds);
  const notices: LeaveReturnNotice[] = [];
  for (const person of returned) {
    if (announced.has(person.id)) continue;
    announced.add(person.id);
    notices.push({ id: person.id, name: person.name });
  }
  return notices;
}

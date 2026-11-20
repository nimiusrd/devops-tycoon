/** RI-215 の試作専用。使用済み ID はスプリントをまたいでランに保持する。 */
import type { RosterState } from '../sim/member/types';
import type { Rng } from '../sim/rng';
import { isAwaitingMinCompleteTick, reviewOne } from '../sim/sprint';
import type { OrgState, SprintState } from '../sim/types';

export const PRIORITY_REVIEW = { trait: 'reviewDemon', focusCost: 3, staminaCost: 12 } as const;

export interface MemberInterventionState {
  roster: RosterState;
  priorityReviewUsedBy: string[];
}

interface PriorityReviewTarget {
  memberId: string;
  taskId: number;
}

/** 指定した本人とPRを確認する。対象の自動選択や盤面の変更は行わない。 */
export function checkPriorityReview(
  state: MemberInterventionState,
  sprint: SprintState,
  target?: PriorityReviewTarget,
) {
  if (sprint.complete || isAwaitingMinCompleteTick(sprint)) {
    return { ok: false, reason: 'complete' } as const;
  }
  if (!target) return { ok: false, reason: 'no-target' } as const;
  const member = state.roster.members.find(({ id }) => id === target.memberId);
  if (!member) return { ok: false, reason: 'missing-member' } as const;
  if (member.onLeave) return { ok: false, reason: 'on-leave' } as const;
  if (member.assignment !== 'review' || !member.traits.includes(PRIORITY_REVIEW.trait)) {
    return { ok: false, reason: 'ineligible-member' } as const;
  }
  if (state.priorityReviewUsedBy.includes(member.id)) {
    return { ok: false, reason: 'already-used' } as const;
  }
  const task = sprint.tasks.find(({ id }) => id === target.taskId);
  if (task?.lane !== 'review' || !task.highValue || task.incident) {
    return { ok: false, reason: 'no-target' } as const;
  }
  if (sprint.focus < PRIORITY_REVIEW.focusCost) return { ok: false, reason: 'no-focus' } as const;
  if (member.stamina < PRIORITY_REVIEW.staminaCost) {
    return { ok: false, reason: 'no-stamina' } as const;
  }
  return { ok: true, member, task } as const;
}

/** 既存のレビュー判定で1件を処理し、レビュー結果にかかわらず費用を払う。 */
export function applyPriorityReview(
  state: MemberInterventionState,
  sprint: SprintState,
  org: OrgState,
  rng: Rng,
  tick: number,
  target?: PriorityReviewTarget,
) {
  const check = checkPriorityReview(state, sprint, target);
  if (!check.ok) return check;
  const { member, task } = check;

  reviewOne(task, sprint, org, rng, tick);
  sprint.focus -= PRIORITY_REVIEW.focusCost;
  sprint.metrics.focusSpent += PRIORITY_REVIEW.focusCost;
  sprint.metrics.interventionsUsed += 1;
  state.roster = {
    ...state.roster,
    members: state.roster.members.map((entry) =>
      entry.id === member.id
        ? { ...entry, stamina: entry.stamina - PRIORITY_REVIEW.staminaCost }
        : entry,
    ),
  };
  state.priorityReviewUsedBy.push(member.id);
  return { ok: true } as const;
}

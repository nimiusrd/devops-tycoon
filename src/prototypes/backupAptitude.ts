import { assignMember } from '../sim/member/roster';
import {
  advanceAbsenceReleasePeriod,
  createAbsenceReleasePrototype,
  type AbsenceReleaseState,
} from './absenceRelease';
import { createPlannedAbsence, previewPlannedAbsence, type AbsenceReason } from './plannedAbsence';

export type BackupStrategy = 'none' | 'successor' | 'experienced';

/** RI-207: 予定不在中の実績によるReview適性発見。通常の成長とは独立。 */
export interface BackupAptitudeState {
  version: 1;
  release: AbsenceReleaseState;
  strategy: BackupStrategy;
  reason: AbsenceReason;
  backupId: string | null;
  successorId: string;
  experiencedId: string;
  evidence: { period: number; memberId: string; work: number }[];
  discovery: { memberId: string; period: number; reviewGain: number } | null;
  history: {
    period: number;
    backupWork: number;
    foregoneCodingCapacity: number;
    discovered: boolean;
  }[];
}

export function createBackupAptitudePrototype(
  seed: string | number,
  strategy: BackupStrategy,
): BackupAptitudeState {
  const release = createAbsenceReleasePrototype(seed, 'normal');
  const { roster, mentorId, apprenticeId } = release.handover.mentorship;
  const experienced = roster.members.find(
    (member) =>
      member.id !== mentorId && member.id !== apprenticeId && member.assignment === 'coding',
  )!;
  // 比較開始時の編成は全戦略で同じ。控えを準備中から働かせない。
  release.handover.mentorship.roster = assignMember(roster, apprenticeId, 'bench');
  release.absence = createPlannedAbsence(roster, mentorId, 'vacation', 2, 6);
  return {
    version: 1,
    release,
    strategy,
    reason: 'vacation',
    backupId: strategy === 'none' ? null : strategy === 'successor' ? apprenticeId : experienced.id,
    successorId: apprenticeId,
    experiencedId: experienced.id,
    evidence: [],
    discovery: null,
    history: [],
  };
}

export function previewBackupAptitude(state: BackupAptitudeState) {
  return {
    ...previewPlannedAbsence(state.release.handover.mentorship.roster, {
      ...state.release.absence,
      reason: state.reason,
    }),
    backupId: state.backupId,
    ability: 'review' as const,
    requiredWork: 6,
    requiredPeriods: 2,
    maximumReviewGain: 10,
    effective: '条件を満たした期の翌期から' as const,
    discovered: state.discovery,
  };
}

export function advanceBackupAptitudePeriod(state: BackupAptitudeState): BackupAptitudeState {
  const period = state.release.handover.mentorship.period + 1;
  if (period > state.release.deadline) return state;
  let prepared = state.release;
  // 初回の起用だけを入力として適用。以後の編成変更・休職は上書きしない。
  if (period === prepared.absence.start && state.backupId !== null) {
    prepared = {
      ...prepared,
      handover: {
        ...prepared.handover,
        mentorship: {
          ...prepared.handover.mentorship,
          apprenticeId: state.backupId,
          roster: assignMember(prepared.handover.mentorship.roster, state.backupId, 'review'),
        },
      },
    };
  }
  const before = prepared.handover.mentorship.roster.members.find((m) => m.id === state.backupId);
  const release = advanceAbsenceReleasePeriod(prepared);
  const workHistory = release.handover.mentorship.history;
  const row = workHistory[workHistory.length - 1];
  const backupWork =
    state.backupId === release.handover.mentorship.apprenticeId ? row.apprenticeWork : 0;
  const evidence = [...state.evidence];
  if (release.absence.active && backupWork > 0 && state.backupId !== null)
    evidence.push({ period, memberId: state.backupId, work: backupWork });
  let discovery = state.discovery;
  let discovered = false;
  if (
    state.strategy === 'successor' &&
    discovery === null &&
    evidence.length >= 2 &&
    evidence.reduce((sum, event) => sum + event.work, 0) >= 6
  ) {
    const member = release.handover.mentorship.roster.members.find(
      (m) => m.id === state.successorId,
    )!;
    const reviewGain = Math.min(10, Math.max(0, 100 - member.stats.review));
    member.stats.review += reviewGain;
    discovery = { memberId: member.id, period, reviewGain };
    discovered = true;
  }
  // 経験者をCodingから借りた場合、実装側で失う余力も成果と分けて残す。
  const foregoneCodingCapacity =
    state.strategy === 'experienced' &&
    before &&
    !before.onLeave &&
    before.stamina > 0 &&
    before.assignment === 'review'
      ? Math.min(Math.floor(before.stats.implementation / 10), Math.floor(before.stamina))
      : 0;
  return {
    ...state,
    release,
    evidence,
    discovery,
    history: [...state.history, { period, backupWork, foregoneCodingCapacity, discovered }],
  };
}

export function compareBackupAptitudeStrategies(seed: string | number) {
  return (['none', 'successor', 'experienced'] as const).map((strategy) => {
    let state = createBackupAptitudePrototype(seed, strategy);
    while (state.release.handover.mentorship.period < state.release.deadline)
      state = advanceBackupAptitudePeriod(state);
    return {
      strategy,
      delivered: state.release.handover.mentorship.delivered,
      remaining: state.release.handover.mentorship.backlog,
      absenceDelivered: state.history
        .filter(
          (row) =>
            row.period >= state.release.absence.start && row.period < state.release.absence.end,
        )
        .reduce((sum, row) => sum + row.backupWork, 0),
      foregoneCodingCapacity: state.history.reduce(
        (sum, row) => sum + row.foregoneCodingCapacity,
        0,
      ),
      staminaSpent: state.release.history.reduce(
        (sum, row) => sum + row.specialistStaminaSpent + row.successorStaminaSpent,
        0,
      ),
      discovery: state.discovery,
      evidence: state.evidence,
      history: state.history,
    };
  });
}

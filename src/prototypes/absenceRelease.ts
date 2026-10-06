import { applyPlannedAbsence, type PlannedAbsence } from './plannedAbsence';
import { advanceHandoverPeriod, createHandoverPrototype, type HandoverState } from './handover';

export type AbsencePreparation = 'normal' | 'frontload' | 'handover';

/** RI-261: 1期前予告・主力1人・固定不在期間のリリース比較。 */
export interface AbsenceReleaseState {
  version: 1;
  handover: HandoverState;
  preparation: AbsencePreparation;
  deadline: number;
  absence: PlannedAbsence;
  history: {
    period: number;
    absent: boolean;
    reviewWork: number;
    overtimeWork: number;
    teachingCost: number;
    specialistStaminaSpent: number;
    successorStaminaSpent: number;
    recovered: number;
    remaining: number;
  }[];
}

export function createAbsenceReleasePrototype(
  seed: string | number,
  preparation: AbsencePreparation,
): AbsenceReleaseState {
  const handover = createHandoverPrototype(seed);
  // 同じ40工数を準備前から公開。前倒しもボス本番も同じ残量を処理する。
  handover.mentorship.backlog = 40;
  return {
    version: 1,
    handover,
    preparation,
    deadline: 6,
    absence: {
      memberId: handover.mentorship.mentorId,
      reason: 'vacation',
      announcedAt: 0,
      start: 2,
      end: 6,
      active: false,
      returned: false,
      returnAssignment: null,
      returnAiAssigned: false,
    },
    history: [],
  };
}

export function previewAbsenceRelease(state: AbsenceReleaseState) {
  return {
    memberId: state.absence.memberId,
    announcedAt: state.absence.announcedAt,
    preparationPeriod: state.absence.start - 1,
    absentFrom: state.absence.start,
    returnsAt: state.absence.end,
    deadline: state.deadline,
    remaining: state.handover.mentorship.backlog,
    frontloadExtraCapacity: 3,
    frontloadStaminaPerExtraWork: 2,
    handoverMentorCapacityCost: 3,
    handoverSuccessorCapacityCost: 1,
    handoverReviewGain: 10,
    growthEffectiveFrom: state.absence.start,
  };
}

/** 期首に不在/復帰を適用し、通常処理→前倒し→消耗/不在回復を確定する。 */
export function advanceAbsenceReleasePeriod(state: AbsenceReleaseState): AbsenceReleaseState {
  const period = state.handover.mentorship.period + 1;
  if (period > state.deadline) return state;
  const { roster, absence } = applyPlannedAbsence(
    state.handover.mentorship.roster,
    state.absence,
    period,
  );
  const specialist = roster.members.find((member) => member.id === absence.memberId)!;
  const preparing = period === absence.start - 1;
  const successorBefore = roster.members.find(
    (member) => member.id === state.handover.mentorship.apprenticeId,
  )!;
  const handover = advanceHandoverPeriod(
    { ...state.handover, mentorship: { ...state.handover.mentorship, roster } },
    {
      teach: preparing && state.preparation === 'handover',
      reviewDemand: 0,
      codingDemand: 0,
      reviewWorkBudget: {
        mentor: Math.floor(specialist.stamina),
        apprentice: Math.floor(successorBefore.stamina),
      },
    },
  );
  const work = handover.mentorship.history[handover.mentorship.history.length - 1];
  const mentor = handover.mentorship.roster.members.find(
    (member) => member.id === absence.memberId,
  )!;
  const successor = handover.mentorship.roster.members.find(
    (member) => member.id === handover.mentorship.apprenticeId,
  )!;
  const normalMentorCost = work.mentorWork + work.mentorCapacityCost;
  const overtimeWork =
    preparing &&
    state.preparation === 'frontload' &&
    !mentor.onLeave &&
    mentor.assignment === 'review'
      ? Math.min(
          3,
          handover.mentorship.backlog,
          Math.max(0, Math.floor((mentor.stamina - normalMentorCost) / 2)),
        )
      : 0;
  handover.mentorship.backlog -= overtimeWork;
  handover.mentorship.delivered += overtimeWork;
  const specialistStaminaSpent = normalMentorCost + overtimeWork * 2;
  const successorStaminaSpent = work.apprenticeWork + work.apprenticeCapacityCost;
  mentor.stamina -= specialistStaminaSpent;
  successor.stamina -= successorStaminaSpent;
  const recovered = absence.active ? Math.min(5, mentor.staminaMax - mentor.stamina) : 0;
  mentor.stamina += recovered;
  return {
    ...state,
    handover,
    absence,
    history: [
      ...state.history,
      {
        period,
        absent: absence.active,
        reviewWork: work.mentorWork + work.apprenticeWork,
        overtimeWork,
        teachingCost: work.mentorCapacityCost + work.apprenticeCapacityCost,
        specialistStaminaSpent,
        successorStaminaSpent,
        recovered,
        remaining: handover.mentorship.backlog,
      },
    ],
  };
}

export function compareAbsenceReleaseStrategies(seed: string | number) {
  return (['normal', 'frontload', 'handover'] as const).map((preparation) => {
    let state = createAbsenceReleasePrototype(seed, preparation);
    while (state.handover.mentorship.period < state.deadline)
      state = advanceAbsenceReleasePeriod(state);
    return {
      preparation,
      delivered: state.handover.mentorship.delivered,
      remaining: state.handover.mentorship.backlog,
      absenceDelivered: state.history
        .filter((row) => row.absent)
        .reduce((sum, row) => sum + row.reviewWork, 0),
      preparationDelivered: state.history[0].reviewWork + state.history[0].overtimeWork,
      teachingCost: state.history.reduce((sum, row) => sum + row.teachingCost, 0),
      specialistStaminaSpent: state.history.reduce(
        (sum, row) => sum + row.specialistStaminaSpent,
        0,
      ),
      successorStaminaSpent: state.history.reduce((sum, row) => sum + row.successorStaminaSpent, 0),
      successorReview: state.handover.mentorship.roster.members.find(
        (member) => member.id === state.handover.mentorship.apprenticeId,
      )!.stats.review,
      history: state.history,
    };
  });
}

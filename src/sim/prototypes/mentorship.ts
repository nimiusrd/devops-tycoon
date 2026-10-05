import { createInitialRoster } from '../member/roster';
import type { RosterState } from '../member/types';
import type { Member } from '../member/types';
import { createRng } from '../rng';

/** RI-206: RI-151の期間単位比較へ渡せる、育成1種の隔離試作。 */
export interface MentorshipState {
  version: 1;
  period: number;
  roster: RosterState;
  mentorId: string;
  apprenticeId: string;
  initialApprenticeReview: number;
  lessons: number;
  backlog: number;
  delivered: number;
  history: MentorshipPeriod[];
}

export interface MentorshipPeriod {
  period: number;
  taught: boolean;
  mentorWork: number;
  apprenticeWork: number;
  apprenticeGrowthWork: number;
  mentorCapacityCost: number;
  apprenticeCapacityCost: number;
  reviewGain: number;
  backlog: number;
}

const activeReviewer = (member: Member | undefined): member is Member =>
  member !== undefined && !member.onLeave && member.assignment === 'review' && member.stamina > 0;

function canTeach(
  state: MentorshipState,
  mentor: Member | undefined,
  apprentice: Member | undefined,
) {
  return (
    activeReviewer(mentor) &&
    activeReviewer(apprentice) &&
    mentor.id !== apprentice.id &&
    mentor.rank === 'senior' &&
    state.lessons < 2 &&
    apprentice.stats.review < 100 &&
    Math.floor(mentor.stats.review / 10) >= 3 &&
    Math.floor(apprentice.stats.review / 10) >= 1
  );
}

export function createMentorshipPrototype(seed: string | number): MentorshipState {
  const roster = createInitialRoster(createRng(seed));
  const mentor = roster.members.find((member) => member.rank === 'senior')!;
  const apprentice = roster.members.find((member) => member.rank === 'junior')!;
  apprentice.assignment = 'review';
  return {
    version: 1,
    period: 0,
    roster,
    mentorId: mentor.id,
    apprenticeId: apprentice.id,
    initialApprenticeReview: apprentice.stats.review,
    lessons: 0,
    backlog: 0,
    delivered: 0,
    history: [],
  };
}

/** 成長は当期処理の後。休職・不在・控え・別レーンでは教えられない。 */
export function advanceMentorshipPeriod(
  state: MentorshipState,
  teach: boolean,
  demand = 12,
): MentorshipState {
  if (!Number.isInteger(demand) || demand < 0) throw new Error('仕事量は非負の整数');
  const roster: RosterState = {
    ...state.roster,
    members: state.roster.members.map((member) => ({
      ...member,
      stats: { ...member.stats },
      traits: [...member.traits],
    })),
  };
  const mentor = roster.members.find((member) => member.id === state.mentorId);
  const apprentice = roster.members.find((member) => member.id === state.apprenticeId);
  const taught = teach && canTeach(state, mentor, apprentice);
  const mentorCapacityCost = taught ? 3 : 0;
  const apprenticeCapacityCost = taught ? 1 : 0;
  let remaining = state.backlog + demand;
  const mentorCapacity = activeReviewer(mentor) ? Math.floor(mentor.stats.review / 10) : 0;
  const apprenticeCapacity = activeReviewer(apprentice)
    ? Math.floor(apprentice.stats.review / 10)
    : 0;
  const mentorWork = Math.min(remaining, Math.max(0, mentorCapacity - mentorCapacityCost));
  remaining -= mentorWork;
  const apprenticeWork = Math.min(
    remaining,
    Math.max(0, apprenticeCapacity - apprenticeCapacityCost),
  );
  remaining -= apprenticeWork;
  const reviewGain = taught ? Math.min(10, 100 - apprentice!.stats.review) : 0;
  if (taught) apprentice!.stats.review += reviewGain;
  const baselineCapacity = Math.max(
    0,
    Math.floor(state.initialApprenticeReview / 10) - apprenticeCapacityCost,
  );
  // 教えたという操作への得点はない。獲得能力で実際に処理した分だけ記録。
  const apprenticeGrowthWork = Math.max(0, apprenticeWork - baselineCapacity);
  const period: MentorshipPeriod = {
    period: state.period + 1,
    taught,
    mentorWork,
    apprenticeWork,
    apprenticeGrowthWork,
    mentorCapacityCost,
    apprenticeCapacityCost,
    reviewGain,
    backlog: remaining,
  };
  return {
    ...state,
    period: state.period + 1,
    roster,
    lessons: state.lessons + Number(taught),
    backlog: remaining,
    delivered: state.delivered + mentorWork + apprenticeWork,
    history: [...state.history, period],
  };
}

export function previewMentorship(state: MentorshipState) {
  const mentor = state.roster.members.find((member) => member.id === state.mentorId);
  const apprentice = state.roster.members.find((member) => member.id === state.apprenticeId);
  const available = canTeach(state, mentor, apprentice);
  return {
    available,
    mentorId: mentor?.id ?? null,
    apprenticeId: apprentice?.id ?? null,
    ability: 'review' as const,
    mentorCapacityCost: 3,
    apprenticeCapacityCost: 1,
    nextPeriodReviewGain: available ? Math.min(10, 100 - apprentice!.stats.review) : 0,
    effectiveFromPeriod: state.period + 2,
    remainingLessons: Math.max(0, 2 - state.lessons),
  };
}

export function compareMentorshipStrategies(seed: string | number, periods: number) {
  if (!Number.isInteger(periods) || periods < 1) throw new Error('期間数は正の整数');
  return (['concentrate', 'mentor'] as const).map((strategy) => {
    let state = createMentorshipPrototype(seed);
    for (let period = 0; period < periods; period += 1) {
      state = advanceMentorshipPeriod(state, strategy === 'mentor' && period < 2);
    }
    return {
      strategy,
      delivered: state.delivered,
      backlog: state.backlog,
      apprenticeReview: state.roster.members.find((member) => member.id === state.apprenticeId)!
        .stats.review,
      apprenticeGrowthWork: state.history.reduce(
        (sum, period) => sum + period.apprenticeGrowthWork,
        0,
      ),
      history: state.history,
    };
  });
}

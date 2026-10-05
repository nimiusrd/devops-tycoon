import { assignMember } from '../sim/member/roster';
import {
  advanceMentorshipPeriod,
  createMentorshipPrototype,
  previewMentorship,
  type MentorshipState,
} from './mentorship';

/** RI-214: 同一ロスターのReview専門家をCodingへ移す比較試作。 */
export interface HandoverState {
  version: 1;
  mentorship: MentorshipState;
  codingBacklog: number;
  codingDelivered: number;
  movedAt: number | null;
  history: { period: number; codingWork: number; reviewWork: number }[];
}

export function createHandoverPrototype(seed: string | number): HandoverState {
  return {
    version: 1,
    mentorship: createMentorshipPrototype(seed),
    codingBacklog: 0,
    codingDelivered: 0,
    movedAt: null,
    history: [],
  };
}

export function previewHandover(state: HandoverState) {
  return {
    ...previewMentorship(state.mentorship),
    knowledge: 'release-review' as const,
    destination: 'coding' as const,
    movedAt: state.movedAt,
  };
}

/** 移動は期首、知識習得は期末。移動自体に費用や得点を付けない。 */
export function advanceHandoverPeriod(
  state: HandoverState,
  input: { teach?: boolean; move?: boolean; reviewDemand?: number; codingDemand?: number } = {},
): HandoverState {
  const { teach = false, move = false, reviewDemand = 12, codingDemand = 8 } = input;
  if (!Number.isInteger(codingDemand) || codingDemand < 0)
    throw new Error('実装仕事量は非負の整数');
  const before = state.mentorship;
  const specialist = before.roster.members.find((member) => member.id === before.mentorId);
  const moving = move && state.movedAt === null && specialist !== undefined && !specialist.onLeave;
  const prepared = moving
    ? { ...before, roster: assignMember(before.roster, before.mentorId, 'coding') }
    : before;
  const mentorship = advanceMentorshipPeriod(prepared, teach, reviewDemand);
  const coder = mentorship.roster.members.find((member) => member.id === mentorship.mentorId);
  const capacity =
    coder && !coder.onLeave && coder.stamina > 0 && coder.assignment === 'coding'
      ? Math.floor(coder.stats.implementation / 10)
      : 0;
  const codingWork = Math.min(state.codingBacklog + codingDemand, capacity);
  const review = mentorship.history[mentorship.history.length - 1];
  return {
    ...state,
    mentorship,
    codingBacklog: state.codingBacklog + codingDemand - codingWork,
    codingDelivered: state.codingDelivered + codingWork,
    movedAt: moving ? mentorship.period : state.movedAt,
    history: [
      ...state.history,
      {
        period: mentorship.period,
        codingWork,
        reviewWork: review.mentorWork + review.apprenticeWork,
      },
    ],
  };
}

export function compareHandoverStrategies(seed: string | number, periods: number) {
  if (!Number.isInteger(periods) || periods < 1) throw new Error('期間数は正の整数');
  return (['immediate', 'handover', 'stay'] as const).map((strategy) => {
    let state = createHandoverPrototype(seed);
    for (let period = 0; period < periods; period += 1) {
      state = advanceHandoverPeriod(state, {
        teach: strategy === 'handover' && state.mentorship.lessons < 2,
        move:
          strategy === 'immediate' || (strategy === 'handover' && state.mentorship.lessons === 2),
      });
    }
    return {
      strategy,
      codingDelivered: state.codingDelivered,
      reviewDelivered: state.mentorship.delivered,
      codingBacklog: state.codingBacklog,
      reviewBacklog: state.mentorship.backlog,
      movedAt: state.movedAt,
      successorReview: state.mentorship.roster.members.find(
        (member) => member.id === state.mentorship.apprenticeId,
      )!.stats.review,
      teachingCost: state.mentorship.history.reduce(
        (sum, period) => sum + period.mentorCapacityCost + period.apprenticeCapacityCost,
        0,
      ),
      history: state.history,
    };
  });
}

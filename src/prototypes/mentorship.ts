import { assignMember, createInitialRoster } from '../sim/member/roster';
import type { RosterState } from '../sim/member/types';
import type { Member } from '../sim/member/types';
import { createRng } from '../sim/rng';

/** RI-206: RI-151の期間単位比較へ渡せる、育成1種の隔離試作。 */
export interface MentorshipState {
  version: 1;
  period: number;
  roster: RosterState;
  mentorId: string;
  apprenticeId: string;
  mentorshipReviewGains: Record<string, number>;
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

/** 呼び出し側が当期に使える余力。未指定の師弟単独試作は従来の能力上限を使う。 */
export interface ReviewWorkBudget {
  mentor: number;
  apprentice: number;
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
  const initialRoster = createInitialRoster(createRng(seed));
  const mentor = initialRoster.members.find((member) => member.rank === 'senior')!;
  const apprentice = initialRoster.members.find((member) => member.rank === 'junior')!;
  const roster = assignMember(initialRoster, apprentice.id, 'review');
  return {
    version: 1,
    period: 0,
    roster,
    mentorId: mentor.id,
    apprenticeId: apprentice.id,
    mentorshipReviewGains: {},
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
  workBudget?: ReviewWorkBudget,
): MentorshipState {
  if (!Number.isInteger(demand) || demand < 0) throw new Error('仕事量は非負の整数');
  if (
    workBudget &&
    Object.values(workBudget).some((value) => !Number.isInteger(value) || value < 0)
  )
    throw new Error('当期の余力は非負の整数');
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
  const mentorshipReviewGains = { ...state.mentorshipReviewGains };
  const baselineReview = apprentice
    ? apprentice.stats.review - (mentorshipReviewGains[apprentice.id] ?? 0)
    : 0;
  const mentorCapacity = activeReviewer(mentor)
    ? Math.min(Math.floor(mentor.stats.review / 10), workBudget?.mentor ?? Infinity)
    : 0;
  const apprenticeCapacity =
    state.mentorId !== state.apprenticeId && activeReviewer(apprentice)
      ? Math.min(Math.floor(apprentice.stats.review / 10), workBudget?.apprentice ?? Infinity)
      : 0;
  const taught =
    teach && canTeach(state, mentor, apprentice) && mentorCapacity >= 3 && apprenticeCapacity >= 1;
  const mentorCapacityCost = taught ? 3 : 0;
  const apprenticeCapacityCost = taught ? 1 : 0;
  let remaining = state.backlog + demand;
  const mentorWork = Math.min(remaining, Math.max(0, mentorCapacity - mentorCapacityCost));
  remaining -= mentorWork;
  const apprenticeWork = Math.min(
    remaining,
    Math.max(0, apprenticeCapacity - apprenticeCapacityCost),
  );
  remaining -= apprenticeWork;
  const reviewGain = taught ? Math.min(10, 100 - apprentice!.stats.review) : 0;
  if (taught) {
    apprentice!.stats.review += reviewGain;
    mentorshipReviewGains[apprentice!.id] =
      (mentorshipReviewGains[apprentice!.id] ?? 0) + reviewGain;
  }
  const baselineCapacity = Math.max(
    0,
    Math.min(Math.floor(baselineReview / 10), workBudget?.apprentice ?? Infinity) -
      apprenticeCapacityCost,
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
    mentorshipReviewGains,
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
    remainingLessons: Math.min(
      Math.max(0, 2 - state.lessons),
      apprentice
        ? Math.max(0, Math.ceil((100 - apprentice.stats.review) / 10))
        : Number.POSITIVE_INFINITY,
    ),
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

/** 初回の8期間・需要12・師弟能力を固定し、要因を一つずつ動かす。 */
const FACTOR_SEED = 'RI-206';
const FACTOR_HORIZON = 8;
const FACTOR_DEMAND = 12;

type MentorshipFactorAxis = 'load' | 'deadline' | 'return';
type MentorshipPreference = 'concentrate' | 'mentor' | 'tie';
type MentorshipStrategyName = 'concentrate' | 'mentor';

interface MentorshipFactorStep {
  demand: number;
  mentorPresent: boolean;
  expireBacklog: boolean;
}

function withMentorPresence(state: MentorshipState, present: boolean): MentorshipState {
  return {
    ...state,
    roster: {
      ...state.roster,
      members: state.roster.members.map((member) =>
        member.id === state.mentorId
          ? {
              ...member,
              stats: { ...member.stats },
              traits: [...member.traits],
              onLeave: !present,
            }
          : member,
      ),
    },
  };
}

function runMentorshipFactor(
  strategy: MentorshipStrategyName,
  steps: readonly MentorshipFactorStep[],
) {
  let state = createMentorshipPrototype(FACTOR_SEED);
  let expired = 0;
  const teach: boolean[] = [];
  for (const step of steps) {
    const requested = strategy === 'mentor' && state.lessons < 2;
    teach.push(requested);
    state = advanceMentorshipPeriod(
      withMentorPresence(state, step.mentorPresent),
      requested,
      step.demand,
    );
    if (step.expireBacklog) {
      expired += state.backlog;
      state = { ...state, backlog: 0 };
    }
  }
  return {
    strategy,
    teach,
    delivered: state.delivered,
    backlog: state.backlog,
    expired,
    apprenticeReview: state.roster.members.find((member) => member.id === state.apprenticeId)!.stats
      .review,
    apprenticeGrowthWork: state.history.reduce(
      (sum, period) => sum + period.apprenticeGrowthWork,
      0,
    ),
    history: state.history,
  };
}

function factorSchedule(at: (period: number) => MentorshipFactorStep) {
  const steps: MentorshipFactorStep[] = [];
  for (let period = 1; period <= FACTOR_HORIZON; period += 1) steps.push(at(period));
  return steps;
}

function preference(concentrate: number, mentor: number): MentorshipPreference {
  if (concentrate > mentor) return 'concentrate';
  if (mentor > concentrate) return 'mentor';
  return 'tie';
}

function factorPoint(axis: MentorshipFactorAxis, parameter: string, steps: MentorshipFactorStep[]) {
  const concentrate = runMentorshipFactor('concentrate', steps);
  const mentor = runMentorshipFactor('mentor', steps);
  return {
    axis,
    parameter,
    schedule: steps.map((step, index) => ({ period: index + 1, ...step })),
    preference: preference(concentrate.delivered, mentor.delivered),
    runs: { concentrate, mentor },
  };
}

function reversalsOf<T extends ReturnType<typeof factorPoint>>(rows: readonly T[]) {
  const found: {
    axis: MentorshipFactorAxis;
    before: {
      parameter: string;
      preference: MentorshipPreference;
      concentrate: number;
      mentor: number;
    };
    after: {
      parameter: string;
      preference: MentorshipPreference;
      concentrate: number;
      mentor: number;
    };
  }[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after || before.preference === after.preference) continue;
    found.push({
      axis: before.axis,
      before: {
        parameter: before.parameter,
        preference: before.preference,
        concentrate: before.runs.concentrate.delivered,
        mentor: before.runs.mentor.delivered,
      },
      after: {
        parameter: after.parameter,
        preference: after.preference,
        concentrate: after.runs.concentrate.delivered,
        mentor: after.runs.mentor.delivered,
      },
    });
  }
  return found;
}

/**
 * 初回と同じ師弟・8期間の上で、需要、期限の失効、師匠の復帰を一つずつ動かす。
 * 固定戦略の計算。2期間と4期間の比較は再実行しない。
 */
export function compareMentorshipFactorReversals() {
  const load = Array.from({ length: FACTOR_DEMAND + 1 }, (_, demand) =>
    factorPoint(
      'load',
      String(demand),
      factorSchedule(() => ({ demand, mentorPresent: true, expireBacklog: false })),
    ),
  );
  const deadline = [
    factorPoint(
      'deadline',
      'none',
      factorSchedule(() => ({
        demand: FACTOR_DEMAND,
        mentorPresent: true,
        expireBacklog: false,
      })),
    ),
    ...Array.from({ length: FACTOR_HORIZON }, (_, index) =>
      factorPoint(
        'deadline',
        String(index + 1),
        factorSchedule((period) => ({
          demand: FACTOR_DEMAND,
          mentorPresent: true,
          expireBacklog: period === index + 1,
        })),
      ),
    ),
  ];
  const returnPeriods = [
    ...Array.from({ length: FACTOR_HORIZON }, (_, index) => index + 1),
    FACTOR_HORIZON + 1,
  ];
  const mentorReturn = returnPeriods.map((returnPeriod) =>
    factorPoint(
      'return',
      returnPeriod > FACTOR_HORIZON ? 'absent' : String(returnPeriod),
      factorSchedule((period) => ({
        demand: FACTOR_DEMAND,
        mentorPresent: period >= returnPeriod,
        expireBacklog: false,
      })),
    ),
  );
  const sweeps = { load, deadline, return: mentorReturn };
  return {
    conditions: {
      seed: FACTOR_SEED,
      horizon: FACTOR_HORIZON,
      baselineDemand: FACTOR_DEMAND,
      score: 'delivered',
      strategies: {
        concentrate: '毎期教えない',
        mentor: '実施済みが2回未満なら教える。休職中は進まず回数も消費しない',
      },
      held: {
        load: '8期間、師匠は全期間稼働。需要だけを0から12まで動かす',
        deadline:
          '8期間、毎期需要12、師匠は全期間稼働。指定期間の処理後に未処理を失効させる。noneは失効なし',
        return:
          '8期間、毎期需要12。師匠が復帰する期間だけを動かす。それ以前は休職。absentは期末まで不在',
      },
      controls: ['load:12', 'deadline:none', 'return:1'],
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionIntegration: false,
      traitsStaminaGrowth: false,
    },
    sweeps,
    reversals: [load, deadline, mentorReturn].flatMap((rows) => reversalsOf(rows)),
  };
}

import { assignMember } from '../sim/member/roster';
import type { LaneAssignment, RosterState } from '../sim/member/types';
import { createMentorshipPrototype } from './mentorship';

export type AbsenceReason = 'vacation' | 'training' | 'business-trip';

/** 試作の期間はスプリント相当。予定不在と疲労休職を別々に保持する。 */
export interface PlannedAbsence {
  memberId: string;
  reason: AbsenceReason;
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
): PlannedAbsence {
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
  };
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
export function previewPlannedAbsence(roster: RosterState, absence: PlannedAbsence) {
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

/** 初回の40工数・6期・主力m2・後継m1を固定し、要因を一つずつ動かす。 */
const FACTOR_SEED = 'RI-205';
const FACTOR_HORIZON = 6;
const FACTOR_WORK = 40;
const FACTOR_ABSENCE_START = 2;
const FACTOR_BASE_CAPABILITY = 10;
const FACTOR_BASE_ARRIVAL = 1;
const FACTOR_BASE_LENGTH = 4;
const FACTOR_CAPABILITY_MAX = 20;
const TEACH_SPECIALIST = 3;
const TEACH_SUCCESSOR = 1;
const ABSENCE_RECOVERY = 5;

export type PlannedAbsenceDecision = 'ignore' | 'reorganize';
export type PlannedAbsenceFactorAxis = 'futureCapability' | 'arrival' | 'absenceLength';
export type PlannedAbsencePreference = PlannedAbsenceDecision | 'tie';

export interface PlannedAbsenceFactor {
  futureCapability: number;
  arrivalPeriod: number;
  absenceLength: number;
}

interface FactorResources {
  specialistId: string;
  successorId: string;
  specialistReview: number;
  successorReview: number;
  specialistStamina: number;
  successorStamina: number;
  specialistStaminaMax: number;
  successorStaminaMax: number;
}

function factorResources(): FactorResources {
  const state = createMentorshipPrototype(FACTOR_SEED);
  const specialist = state.roster.members.find((member) => member.id === state.mentorId);
  const successor = state.roster.members.find((member) => member.id === state.apprenticeId);
  if (!specialist || !successor) throw new Error('初回と同じ主力と後継がいない');
  return {
    specialistId: specialist.id,
    successorId: successor.id,
    specialistReview: specialist.stats.review,
    successorReview: successor.stats.review,
    specialistStamina: specialist.stamina,
    successorStamina: successor.stamina,
    specialistStaminaMax: specialist.staminaMax,
    successorStaminaMax: successor.staminaMax,
  };
}

function assertFactor(factor: PlannedAbsenceFactor) {
  const maxLength = FACTOR_HORIZON - FACTOR_ABSENCE_START + 1;
  if (!Number.isInteger(factor.futureCapability) || factor.futureCapability < 0)
    throw new Error('研修の将来能力は0以上の整数');
  if (
    !Number.isInteger(factor.arrivalPeriod) ||
    factor.arrivalPeriod < 1 ||
    factor.arrivalPeriod > FACTOR_HORIZON
  )
    throw new Error('仕事の到着時期は期間内の正の整数');
  if (
    !Number.isInteger(factor.absenceLength) ||
    factor.absenceLength < 0 ||
    factor.absenceLength > maxLength
  )
    throw new Error('不在の長さは準備期を残す範囲の整数');
}

function runPlannedAbsenceDecision(
  resources: FactorResources,
  decision: PlannedAbsenceDecision,
  factor: PlannedAbsenceFactor,
) {
  assertFactor(factor);
  let successorReview = resources.successorReview;
  let specialistStamina = resources.specialistStamina;
  let successorStamina = resources.successorStamina;
  let backlog = 0;
  let delivered = 0;
  let absenceDelivered = 0;
  let preparationDelivered = 0;
  let teachingCost = 0;
  let specialistStaminaSpent = 0;
  let successorStaminaSpent = 0;
  const absenceEnd = FACTOR_ABSENCE_START + factor.absenceLength;
  const inputs: { period: number; demand: number; absent: boolean; teach: boolean }[] = [];
  const history: {
    period: number;
    demand: number;
    absent: boolean;
    teach: boolean;
    taught: boolean;
    specialistWork: number;
    successorWork: number;
    reviewGain: number;
    specialistStaminaSpent: number;
    successorStaminaSpent: number;
    recovered: number;
    remaining: number;
  }[] = [];

  for (let period = 1; period <= FACTOR_HORIZON; period += 1) {
    const demand = period === factor.arrivalPeriod ? FACTOR_WORK : 0;
    const absent = period >= FACTOR_ABSENCE_START && period < absenceEnd;
    const teach = decision === 'reorganize' && period === FACTOR_ABSENCE_START - 1;
    const specialistCapacity = absent ? 0 : Math.floor(resources.specialistReview / 10);
    const successorCapacity = Math.floor(successorReview / 10);
    const specialistRoom = Math.min(specialistCapacity, Math.floor(specialistStamina));
    const successorRoom = Math.min(successorCapacity, Math.floor(successorStamina));
    const taught =
      teach &&
      specialistRoom >= TEACH_SPECIALIST &&
      successorRoom >= TEACH_SUCCESSOR &&
      successorReview < 100;
    const specialistCost = taught ? TEACH_SPECIALIST : 0;
    const successorCost = taught ? TEACH_SUCCESSOR : 0;
    let remaining = backlog + demand;
    const specialistWork = Math.min(remaining, Math.max(0, specialistRoom - specialistCost));
    remaining -= specialistWork;
    const successorWork = Math.min(remaining, Math.max(0, successorRoom - successorCost));
    remaining -= successorWork;
    const reviewGain = taught ? Math.min(factor.futureCapability, 100 - successorReview) : 0;
    successorReview += reviewGain;
    const specialistSpent = specialistWork + specialistCost;
    const successorSpent = successorWork + successorCost;
    specialistStamina -= specialistSpent;
    successorStamina -= successorSpent;
    const recovered = absent
      ? Math.min(ABSENCE_RECOVERY, resources.specialistStaminaMax - specialistStamina)
      : 0;
    specialistStamina += recovered;
    const periodDelivered = specialistWork + successorWork;
    backlog = remaining;
    delivered += periodDelivered;
    if (absent) absenceDelivered += periodDelivered;
    if (period === FACTOR_ABSENCE_START - 1) preparationDelivered = periodDelivered;
    teachingCost += specialistCost + successorCost;
    specialistStaminaSpent += specialistSpent;
    successorStaminaSpent += successorSpent;
    inputs.push({ period, demand, absent, teach });
    history.push({
      period,
      demand,
      absent,
      teach,
      taught,
      specialistWork,
      successorWork,
      reviewGain,
      specialistStaminaSpent: specialistSpent,
      successorStaminaSpent: successorSpent,
      recovered,
      remaining,
    });
  }

  return {
    decision,
    inputs,
    delivered,
    remaining: backlog,
    absenceDelivered,
    preparationDelivered,
    teachingCost,
    specialistStaminaSpent,
    successorStaminaSpent,
    successorReview,
    successorCapacity: Math.floor(successorReview / 10),
    history,
  };
}

function preferenceOf(ignore: number, reorganize: number): PlannedAbsencePreference {
  if (ignore > reorganize) return 'ignore';
  if (reorganize > ignore) return 'reorganize';
  return 'tie';
}

function factorPoint(
  resources: FactorResources,
  axis: PlannedAbsenceFactorAxis,
  parameter: string,
  factor: PlannedAbsenceFactor,
) {
  const ignore = runPlannedAbsenceDecision(resources, 'ignore', factor);
  const reorganize = runPlannedAbsenceDecision(resources, 'reorganize', factor);
  return {
    axis,
    parameter,
    factor,
    preference: preferenceOf(ignore.delivered, reorganize.delivered),
    margin: reorganize.delivered - ignore.delivered,
    runs: { ignore, reorganize },
  };
}

function reversalsOf(rows: ReturnType<typeof factorPoint>[]) {
  const found: {
    axis: PlannedAbsenceFactorAxis;
    before: {
      parameter: string;
      preference: PlannedAbsencePreference;
      ignore: number;
      reorganize: number;
    };
    after: {
      parameter: string;
      preference: PlannedAbsencePreference;
      ignore: number;
      reorganize: number;
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
        ignore: before.runs.ignore.delivered,
        reorganize: before.runs.reorganize.delivered,
      },
      after: {
        parameter: after.parameter,
        preference: after.preference,
        ignore: after.runs.ignore.delivered,
        reorganize: after.runs.reorganize.delivered,
      },
    });
  }
  return found;
}

/**
 * 初回と同じ資源の上で、研修の将来能力・仕事の到着時期・不在の長短を一つずつ動かす。
 * 固定戦略の計算。通常・前倒し・代打育成の三点比較は再実行しない。
 */
export function comparePlannedAbsenceFactorReversals() {
  const resources = factorResources();
  const base = {
    futureCapability: FACTOR_BASE_CAPABILITY,
    arrivalPeriod: FACTOR_BASE_ARRIVAL,
    absenceLength: FACTOR_BASE_LENGTH,
  };
  const futureCapability = Array.from({ length: FACTOR_CAPABILITY_MAX + 1 }, (_, value) =>
    factorPoint(resources, 'futureCapability', String(value), { ...base, futureCapability: value }),
  );
  const arrival = Array.from({ length: FACTOR_HORIZON }, (_, index) =>
    factorPoint(resources, 'arrival', String(index + 1), { ...base, arrivalPeriod: index + 1 }),
  );
  const absenceLength = Array.from(
    { length: FACTOR_HORIZON - FACTOR_ABSENCE_START + 2 },
    (_, length) =>
      factorPoint(resources, 'absenceLength', String(length), { ...base, absenceLength: length }),
  );
  const sweeps = { futureCapability, arrival, absenceLength };
  return {
    conditions: {
      seed: FACTOR_SEED,
      horizon: FACTOR_HORIZON,
      work: FACTOR_WORK,
      absenceStart: FACTOR_ABSENCE_START,
      score: 'delivered',
      baseline: base,
      resources,
      teaching: { specialist: TEACH_SPECIALIST, successor: TEACH_SUCCESSOR },
      absenceRecovery: ABSENCE_RECOVERY,
      strategies: {
        ignore: '予告を見ても準備期に研修しない。主力と後継の能力も担当も変えない',
        reorganize:
          '不在の前の期に後継へ研修を1回入れる。費用は主力3・後継1で、将来能力は次の期から処理に出る',
      },
      held: {
        futureCapability: '到着は1期、不在の長さは4。将来能力のレビュー増分だけを0から20まで動かす',
        arrival: '将来能力は10、不在の長さは4。40工数が一度に着く期だけを1から6まで動かす',
        absenceLength:
          '将来能力は10、到着は1期。開始は2のまま、不在の長さだけを0から5まで動かす。0は不在なし、5は期内に復帰しない',
      },
      controls: ['futureCapability:10', 'arrival:1', 'absenceLength:4'],
      oneFactorAtATime: true,
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionIntegration: false,
      traitMultipliers: false,
      naturalGrowth: false,
    },
    sweeps,
    reversals: [futureCapability, arrival, absenceLength].flatMap((rows) => reversalsOf(rows)),
  };
}

import { assignMember } from '../sim/member/roster';
import {
  advanceAbsenceReleasePeriod,
  createAbsenceReleasePrototype,
  type AbsencePreparation,
  type AbsenceReleaseState,
} from './absenceRelease';
import { createPlannedAbsence, previewPlannedAbsence, type AbsenceReason } from './plannedAbsence';

export type BackupStrategy = 'none' | 'successor' | 'experienced';

/** 初回比較の資源の上で、一つだけ動かす要因。数値は本番定数ではない。 */
export interface BackupAptitudeRules {
  codingDemand: number;
  absenceStart: number;
  absenceEnd: number;
  requiredWork: number;
  requiredPeriods: number;
  qualityNumerator: number;
  qualityDenominator: number;
}

export const baselineBackupRules: BackupAptitudeRules = {
  codingDemand: 0,
  absenceStart: 2,
  absenceEnd: 6,
  requiredWork: 6,
  requiredPeriods: 2,
  qualityNumerator: 1,
  qualityDenominator: 1,
};

const FACTOR_SEED = 'RI-207';
/** 不在中の主力回復と同じ刻み。休息が体力を増やすかの確認にだけ使う。 */
const REST_RECOVERY = 5;

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
  rules: BackupAptitudeRules;
  history: {
    period: number;
    backupWork: number;
    foregoneCodingCapacity: number;
    discovered: boolean;
  }[];
}

function cloneRules(rules: BackupAptitudeRules): BackupAptitudeRules {
  return { ...rules };
}

function assertRules(rules: BackupAptitudeRules) {
  if (!Number.isInteger(rules.codingDemand) || rules.codingDemand < 0)
    throw new Error('Coding需要は非負の整数');
  if (
    !Number.isInteger(rules.absenceStart) ||
    !Number.isInteger(rules.absenceEnd) ||
    rules.absenceStart < 1 ||
    rules.absenceEnd <= rules.absenceStart
  )
    throw new Error('不在期間は開始から復帰までの正の整数');
  if (!Number.isInteger(rules.requiredWork) || rules.requiredWork < 0)
    throw new Error('実績工数は非負の整数');
  if (!Number.isInteger(rules.requiredPeriods) || rules.requiredPeriods < 1)
    throw new Error('実績期数は正の整数');
  if (
    !Number.isInteger(rules.qualityNumerator) ||
    !Number.isInteger(rules.qualityDenominator) ||
    rules.qualityNumerator < 0 ||
    rules.qualityDenominator < 1 ||
    rules.qualityNumerator > rules.qualityDenominator
  )
    throw new Error('品質成功は分母以下の非負整数比');
}

export function createBackupAptitudePrototype(
  seed: string | number,
  strategy: BackupStrategy,
  rules: BackupAptitudeRules = baselineBackupRules,
): BackupAptitudeState {
  assertRules(rules);
  const frozen = cloneRules(rules);
  const release = createAbsenceReleasePrototype(seed, 'normal');
  const { roster, mentorId, apprenticeId } = release.handover.mentorship;
  const experienced = roster.members.find(
    (member) =>
      member.id !== mentorId && member.id !== apprenticeId && member.assignment === 'coding',
  )!;
  // 比較開始時の編成は全戦略で同じ。控えを準備中から働かせない。
  release.handover.mentorship.roster = assignMember(roster, apprenticeId, 'bench');
  release.absence = createPlannedAbsence(
    roster,
    mentorId,
    'vacation',
    frozen.absenceStart,
    frozen.absenceEnd,
  );
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
    rules: frozen,
    history: [],
  };
}

export function previewBackupAptitude(state: BackupAptitudeState) {
  const rules = state.rules ?? baselineBackupRules;
  return {
    ...previewPlannedAbsence(state.release.handover.mentorship.roster, {
      ...state.release.absence,
      reason: state.reason,
    }),
    backupId: state.backupId,
    ability: 'review' as const,
    requiredWork: rules.requiredWork,
    requiredPeriods: rules.requiredPeriods,
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
  const rules = state.rules ?? baselineBackupRules;
  // 品質成功は控えの処理にだけ掛ける。経験者と主力の処理は成功として数える。
  const accepted =
    state.strategy === 'successor'
      ? Math.floor((backupWork * rules.qualityNumerator) / rules.qualityDenominator)
      : backupWork;
  const rejected = backupWork - accepted;
  if (rejected > 0) {
    release.handover.mentorship.delivered -= rejected;
    release.handover.mentorship.backlog += rejected;
  }
  const evidence = [...state.evidence];
  if (release.absence.active && accepted > 0 && state.backupId !== null)
    evidence.push({ period, memberId: state.backupId, work: accepted });
  let discovery = state.discovery;
  let discovered = false;
  if (
    state.strategy === 'successor' &&
    discovery === null &&
    evidence.length >= rules.requiredPeriods &&
    evidence.reduce((sum, event) => sum + event.work, 0) >= rules.requiredWork
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

export type BackupDecision = 'discover' | 'withhold' | 'borrow' | 'train' | 'rest';
export type BackupPreference = 'discover' | 'withhold' | 'borrow' | 'train' | 'rest' | 'tie';

export interface BackupPeriodRow {
  period: number;
  action: string;
  memberId: string | null;
  grossBackup: number;
  acceptedBackup: number;
  codingWork: number;
  reviewWork: number;
}

export interface BackupFactorOutcome {
  label: BackupDecision;
  reviewDelivered: number;
  codingDelivered: number;
  net: number;
  remaining: number;
  discovery: BackupAptitudeState['discovery'];
  acceptedEvidence: number;
  successorReview: number;
  successorStamina: number;
  staminaGained: number;
  inputs: { period: number; action: string; memberId: string | null }[];
  periods: BackupPeriodRow[];
}

export interface BackupFactorPoint {
  axis: string;
  parameter: string;
  rules: BackupAptitudeRules;
  discover: BackupFactorOutcome;
  withhold: BackupFactorOutcome;
  borrow: BackupFactorOutcome;
  discoverVsWithhold: BackupPreference;
  discoverVsBorrow: BackupPreference;
}

export interface BackupExchangePoint {
  axis: 'benchExchange';
  parameter: 'train' | 'rest';
  rules: BackupAptitudeRules;
  discover: BackupFactorOutcome;
  exchange: BackupFactorOutcome;
  preference: BackupPreference;
}

export interface BackupFactorReversal {
  axis: string;
  pair: 'discoverVsWithhold' | 'discoverVsBorrow' | 'discoverVsExchange';
  before: { parameter: string; preference: string; discover: number; other: number };
  after: { parameter: string; preference: string; discover: number; other: number };
}

function withRules(patch: Partial<BackupAptitudeRules>): BackupAptitudeRules {
  return { ...baselineBackupRules, ...patch };
}

function withRoster(
  state: BackupAptitudeState,
  roster: BackupAptitudeState['release']['handover']['mentorship']['roster'],
  preparation?: AbsencePreparation,
): BackupAptitudeState {
  return {
    ...state,
    release: {
      ...state.release,
      preparation: preparation ?? state.release.preparation,
      handover: {
        ...state.release.handover,
        mentorship: { ...state.release.handover.mentorship, roster },
      },
    },
  };
}

function codingWorkOf(state: BackupAptitudeState, demand: number) {
  if (demand === 0) return 0;
  const capacity = state.release.handover.mentorship.roster.members.reduce((sum, member) => {
    if (member.onLeave || member.assignment !== 'coding' || member.stamina <= 0) return sum;
    return sum + Math.min(Math.floor(member.stats.implementation / 10), Math.floor(member.stamina));
  }, 0);
  return Math.min(demand, capacity);
}

function outcomeFrom(
  state: BackupAptitudeState,
  label: BackupDecision,
  periods: BackupPeriodRow[],
  staminaGained: number,
): BackupFactorOutcome {
  const reviewDelivered = state.release.handover.mentorship.delivered;
  const codingDelivered = periods.reduce((sum, row) => sum + row.codingWork, 0);
  const successor = state.release.handover.mentorship.roster.members.find(
    (member) => member.id === state.successorId,
  )!;
  const outcome = {
    label,
    reviewDelivered,
    codingDelivered,
    net: reviewDelivered + codingDelivered,
    remaining: state.release.handover.mentorship.backlog,
    discovery: state.discovery,
    acceptedEvidence: state.evidence.reduce((sum, event) => sum + event.work, 0),
    successorReview: successor.stats.review,
    successorStamina: successor.stamina,
    staminaGained,
    inputs: periods.map(({ period, action, memberId }) => ({ period, action, memberId })),
    periods,
  };
  if (outcome.reviewDelivered + outcome.remaining !== 40)
    throw new Error(`${label}の処理と未処理が40工数にならない`);
  return outcome;
}

function finishStandard(
  strategy: BackupStrategy,
  rules: BackupAptitudeRules,
  label: BackupDecision,
): BackupFactorOutcome {
  let state = createBackupAptitudePrototype(FACTOR_SEED, strategy, rules);
  const periods: BackupPeriodRow[] = [];
  while (state.release.handover.mentorship.period < state.release.deadline) {
    const period = state.release.handover.mentorship.period + 1;
    const before = state.release.handover.mentorship.delivered;
    const action =
      period === state.rules.absenceStart && state.backupId !== null
        ? 'assign-review'
        : 'unchanged';
    state = advanceBackupAptitudePeriod(state);
    const row = state.history[state.history.length - 1]!;
    const acceptedBackup =
      strategy === 'successor'
        ? Math.floor((row.backupWork * rules.qualityNumerator) / rules.qualityDenominator)
        : row.backupWork;
    periods.push({
      period,
      action,
      memberId: action === 'assign-review' ? state.backupId : null,
      grossBackup: row.backupWork,
      acceptedBackup,
      codingWork: codingWorkOf(state, rules.codingDemand),
      reviewWork: state.release.handover.mentorship.delivered - before,
    });
  }
  return outcomeFrom(state, label, periods, 0);
}

function finishTrain(rules: BackupAptitudeRules): BackupFactorOutcome {
  let state = createBackupAptitudePrototype(FACTOR_SEED, 'none', rules);
  const memberId = state.successorId;
  const periods: BackupPeriodRow[] = [];
  while (state.release.handover.mentorship.period < state.release.deadline) {
    const period = state.release.handover.mentorship.period + 1;
    const before = state.release.handover.mentorship.delivered;
    const action =
      period === state.rules.absenceStart - 1
        ? 'train'
        : period < state.rules.absenceEnd
          ? 'assign-bench'
          : 'assign-review';
    state = withRoster(
      state,
      assignMember(
        state.release.handover.mentorship.roster,
        memberId,
        action === 'assign-bench' ? 'bench' : 'review',
      ),
      action === 'train' ? 'handover' : 'normal',
    );
    state = advanceBackupAptitudePeriod(state);
    periods.push({
      period,
      action,
      memberId,
      grossBackup: 0,
      acceptedBackup: 0,
      codingWork: codingWorkOf(state, rules.codingDemand),
      reviewWork: state.release.handover.mentorship.delivered - before,
    });
  }
  return outcomeFrom(state, 'train', periods, 0);
}

function finishRest(rules: BackupAptitudeRules): BackupFactorOutcome {
  let state = createBackupAptitudePrototype(FACTOR_SEED, 'none', rules);
  const memberId = state.successorId;
  const periods: BackupPeriodRow[] = [];
  let staminaGained = 0;
  while (state.release.handover.mentorship.period < state.release.deadline) {
    const period = state.release.handover.mentorship.period + 1;
    const before = state.release.handover.mentorship.delivered;
    let action = 'unchanged';
    if (period >= state.rules.absenceStart && period < state.rules.absenceEnd) {
      state = withRoster(
        state,
        assignMember(state.release.handover.mentorship.roster, memberId, 'bench'),
        'normal',
      );
      action = 'rest';
    } else if (period >= state.rules.absenceEnd) {
      state = withRoster(
        state,
        assignMember(state.release.handover.mentorship.roster, memberId, 'review'),
        'normal',
      );
      action = 'assign-review';
    }
    state = advanceBackupAptitudePeriod(state);
    if (action === 'rest') {
      const person = state.release.handover.mentorship.roster.members.find(
        (member) => member.id === memberId,
      )!;
      const gained = Math.min(REST_RECOVERY, person.staminaMax - person.stamina);
      person.stamina += gained;
      staminaGained += gained;
    }
    periods.push({
      period,
      action,
      memberId: action === 'unchanged' ? null : memberId,
      grossBackup: 0,
      acceptedBackup: 0,
      codingWork: codingWorkOf(state, rules.codingDemand),
      reviewWork: state.release.handover.mentorship.delivered - before,
    });
  }
  return outcomeFrom(state, 'rest', periods, staminaGained);
}

export function runBackupFactor(
  kind: BackupDecision,
  rules: BackupAptitudeRules = baselineBackupRules,
): BackupFactorOutcome {
  if (kind === 'discover') return finishStandard('successor', rules, 'discover');
  if (kind === 'withhold') return finishStandard('none', rules, 'withhold');
  if (kind === 'borrow') return finishStandard('experienced', rules, 'borrow');
  if (kind === 'train') return finishTrain(rules);
  return finishRest(rules);
}

function prefer(discover: number, other: number, name: BackupPreference): BackupPreference {
  if (discover > other) return 'discover';
  if (other > discover) return name;
  return 'tie';
}

function factorPoint(
  axis: string,
  parameter: string,
  rules: BackupAptitudeRules,
): BackupFactorPoint {
  const discover = runBackupFactor('discover', rules);
  const withhold = runBackupFactor('withhold', rules);
  const borrow = runBackupFactor('borrow', rules);
  if (withhold.reviewDelivered <= 0) throw new Error('代打なしの処理が無い');
  return {
    axis,
    parameter,
    rules: cloneRules(rules),
    discover,
    withhold,
    borrow,
    discoverVsWithhold: prefer(discover.net, withhold.net, 'withhold'),
    discoverVsBorrow: prefer(discover.net, borrow.net, 'borrow'),
  };
}

function exchangePoint(parameter: 'train' | 'rest'): BackupExchangePoint {
  const rules = cloneRules(baselineBackupRules);
  const discover = runBackupFactor('discover', rules);
  const exchange = runBackupFactor(parameter, rules);
  return {
    axis: 'benchExchange',
    parameter,
    rules,
    discover,
    exchange,
    preference: prefer(discover.net, exchange.net, parameter),
  };
}

function reversalsOf(rows: BackupFactorPoint[]): BackupFactorReversal[] {
  const found: BackupFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after) continue;
    if (before.discoverVsWithhold !== after.discoverVsWithhold) {
      found.push({
        axis: before.axis,
        pair: 'discoverVsWithhold',
        before: {
          parameter: before.parameter,
          preference: before.discoverVsWithhold,
          discover: before.discover.net,
          other: before.withhold.net,
        },
        after: {
          parameter: after.parameter,
          preference: after.discoverVsWithhold,
          discover: after.discover.net,
          other: after.withhold.net,
        },
      });
    }
    if (before.discoverVsBorrow !== after.discoverVsBorrow) {
      found.push({
        axis: before.axis,
        pair: 'discoverVsBorrow',
        before: {
          parameter: before.parameter,
          preference: before.discoverVsBorrow,
          discover: before.discover.net,
          other: before.borrow.net,
        },
        after: {
          parameter: after.parameter,
          preference: after.discoverVsBorrow,
          discover: after.discover.net,
          other: after.borrow.net,
        },
      });
    }
  }
  return found;
}

function exchangeReversals(rows: BackupExchangePoint[]): BackupFactorReversal[] {
  const found: BackupFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after || before.preference === after.preference) continue;
    found.push({
      axis: 'benchExchange',
      pair: 'discoverVsExchange',
      before: {
        parameter: before.parameter,
        preference: before.preference,
        discover: before.discover.net,
        other: before.exchange.net,
      },
      after: {
        parameter: after.parameter,
        preference: after.preference,
        discover: after.discover.net,
        other: after.exchange.net,
      },
    });
  }
  return found;
}

/** 初回と同じ資源で要因を一つずつ動かす。固定戦略の再計算であり、初回の3戦略表は再出力しない。 */
export function compareBackupAptitudeFactorReversals() {
  const sweeps = {
    codingDemand: [0, 1, 2, 5, 8].map((codingDemand) =>
      factorPoint('codingDemand', String(codingDemand), withRules({ codingDemand })),
    ),
    absenceLength: [1, 2, 3, 4].map((length) =>
      factorPoint(
        'absenceLength',
        String(length),
        withRules({ absenceEnd: baselineBackupRules.absenceStart + length }),
      ),
    ),
    requiredWork: [6, 8, 10, 12, 14, 16].map((requiredWork) =>
      factorPoint('requiredWork', String(requiredWork), withRules({ requiredWork })),
    ),
    requiredPeriods: [2, 3, 4, 5].map((requiredPeriods) =>
      factorPoint('requiredPeriods', String(requiredPeriods), withRules({ requiredPeriods })),
    ),
    qualitySuccess: [
      [1, 1],
      [3, 4],
      [2, 3],
      [1, 2],
      [1, 3],
      [0, 1],
    ].map(([qualityNumerator, qualityDenominator]) =>
      factorPoint(
        'qualitySuccess',
        `${qualityNumerator}/${qualityDenominator}`,
        withRules({ qualityNumerator, qualityDenominator }),
      ),
    ),
  };
  const benchExchange = (['train', 'rest'] as const).map((parameter) => exchangePoint(parameter));
  return {
    conditions: {
      seed: FACTOR_SEED,
      backlog: 40,
      deadline: 6,
      score: 'reviewDelivered + codingDelivered',
      decisions: { discover: 'successor', withhold: 'none', borrow: 'experienced' },
      baseline: cloneRules(baselineBackupRules),
      quality:
        '控えの処理だけを分子/分母で切り捨て、不成功は未処理へ戻す。経験者と主力の処理は成功として数える。',
      training:
        '1期に既存の引継ぎ育成を行い、不在中は控えへ戻し、復帰期にレビューへ置く。育成の実装は変更しない。',
      rest: '不在中は控えのまま1期あたり5まで回復を試し、復帰期にレビューへ置く。',
      held: {
        codingDemand:
          '期あたりのCoding需要だけを動かす。不在は2期から6期、実績は2期かつ6工数、品質は1/1。',
        absenceLength:
          '不在の長さだけを動かす。開始は2期のまま、長さは復帰までの稼働期数。需要0、実績は2期かつ6工数、品質は1/1。',
        requiredWork: '発見に必要な累計工数だけを動かす。期間条件は2期のまま。',
        requiredPeriods: '発見に必要な稼働期数だけを動かす。累計工数は6のまま。',
        qualitySuccess:
          '控えの品質成功比だけを動かす。需要0、不在は2期から6期、実績は2期かつ6工数。',
        benchExchange:
          '控えの使い道だけをバックアップから育成または休息へ替える。他の規則は基準のまま。',
      },
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    },
    sweeps,
    benchExchange,
    reversals: [
      ...Object.values(sweeps).flatMap((rows) => reversalsOf(rows)),
      ...exchangeReversals(benchExchange),
    ],
  };
}

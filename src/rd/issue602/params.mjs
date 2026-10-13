/**
 * Issue #602 Phase 1 の凍結値。
 * #731 の師弟試作と #538 の安定／逼迫 seed を複製しただけ。ライブ import しない。
 */

/** #731 (`src/prototypes/mentorship.ts`) から複製した参照値。式へは入れず、候補の根拠だけに使う。 */
export const COPIED_FROM_731 = Object.freeze({
  source: 'copied-not-imported',
  copiedFrom: [
    'src/prototypes/mentorship.ts',
    'docs/prototypes/RI-206-mentorship.md',
    'docs/prototypes/mentorship-comparison.json',
  ],
  issue: 731,
  seed: 'RI-206',
  periodsShort: 2,
  periodsLong: 8,
  demandPerPeriod: 12,
  mentorReview: 64,
  apprenticeReview: 32,
  mentorCapacity: 6,
  apprenticeCapacity: 3,
  mentorCapacityCost: 3,
  apprenticeCapacityCost: 1,
  reviewGain: 10,
  maxLessons: 2,
  abilityCap: 100,
  recorded: Object.freeze({
    short: Object.freeze({ concentrate: 18, mentor: 11 }),
    long: Object.freeze({ concentrate: 72, mentor: 77, apprenticeGrowthWork: 13 }),
  }),
});

/**
 * #538 R&D (`src/rd/intervene` / PR #540) から複製した参照値。
 * 危機 seed を使わず、何が危機だったかの倍率根拠だけに使う。
 */
export const COPIED_FROM_538 = Object.freeze({
  source: 'copied-not-imported',
  copiedFrom: ['src/rd/intervene/knobs.ts', 'src/rd/intervene/PROTO.md', 'src/rd/intervene/sim.ts'],
  issue: 538,
  pr: 540,
  incomingBase: 10,
  incomingPressure: 0.32,
  rngAmplitude: 3,
  processRate: 0.4,
  crisisFromIncoming: 0.5,
  outputCrisisPenalty: 0.18,
  stable: Object.freeze({
    rngSeed: 'rd-intervene-stable',
    pressure: Object.freeze([30, 28, 32]),
    capability: Object.freeze([74, 70, 72]),
    crisis: Object.freeze([8, 6, 10]),
    fatigue: Object.freeze([10, 12, 11]),
  }),
  crisis: Object.freeze({
    rngSeed: 'rd-intervene-crisis',
    pressure: Object.freeze([70, 82, 64]),
    capability: Object.freeze([36, 28, 40]),
    crisis: Object.freeze([46, 62, 40]),
    fatigue: Object.freeze([22, 30, 18]),
  }),
  meanPressure: Object.freeze({ stable: 30, crisis: 72 }),
  meanIncoming: Object.freeze({ stable: 19.6, crisis: 33.04 }),
  pressureRatio: 2.4,
  incomingRatio: 1.6857,
});

export const DECISION_METRIC = 'delivered';

export const DECISION_METRIC_JUSTIFICATION = [
  'delivered は #731 の長期処理数（出荷した工数）。',
  '能力増分や授業回数そのものは得点にしない。弟子の成長能力で実際に処理した量は説明用に別掲する。',
].join(' ');

/**
 * 危機は seed ではなく発生率の倍率で定義する。
 * #538 の逼迫は平均負荷 72 / 安定 30（2.4 倍）、流入 33.04 / 19.6（1.69 倍）。
 * その間を取り、障害発生率を安定の 2 倍に固定する。
 */
export const CRISIS_INCIDENT_MULTIPLIER = 2;
export const STABLE_INCIDENT_RATE = 0.25;
export const CRISIS_INCIDENT_RATE = STABLE_INCIDENT_RATE * CRISIS_INCIDENT_MULTIPLIER;
export const INCIDENT_MENTOR_CAPACITY_LOSS = COPIED_FROM_731.mentorCapacityCost;

export const PARAMS = Object.freeze({
  experimentId: 'issue602-phase1',
  copiedIssues: Object.freeze([731, 538]),
  periods: COPIED_FROM_731.periodsLong,
  demandPerPeriod: COPIED_FROM_731.demandPerPeriod,
  mentorReview: COPIED_FROM_731.mentorReview,
  apprenticeReview: COPIED_FROM_731.apprenticeReview,
  mentorCapacityCost: COPIED_FROM_731.mentorCapacityCost,
  apprenticeCapacityCost: COPIED_FROM_731.apprenticeCapacityCost,
  reviewGain: COPIED_FROM_731.reviewGain,
  maxLessons: COPIED_FROM_731.maxLessons,
  abilityCap: COPIED_FROM_731.abilityCap,
  stableIncidentRate: STABLE_INCIDENT_RATE,
  crisisIncidentRate: CRISIS_INCIDENT_RATE,
  crisisIncidentMultiplier: CRISIS_INCIDENT_MULTIPLIER,
  incidentMentorCapacityLoss: INCIDENT_MENTOR_CAPACITY_LOSS,
  decisionMetric: DECISION_METRIC,
  passLine: Object.freeze({
    stableMentorWins: 4,
    crisisConcentrateWins: 4,
    seeds: 5,
    otherwise: 'Kill',
  }),
});

export const COMPARISON_SEEDS = Object.freeze([
  'RI-602-a',
  'RI-602-b',
  'RI-602-c',
  'RI-602-d',
  'RI-602-e',
]);

export const CONDITIONS = Object.freeze({
  stable: Object.freeze({
    id: 'stable',
    label: '安定',
    incidentRate: PARAMS.stableIncidentRate,
  }),
  crisis: Object.freeze({
    id: 'crisis',
    label: '危機',
    incidentRate: PARAMS.crisisIncidentRate,
  }),
});

export const POLICIES = Object.freeze({
  concentrate: Object.freeze({
    id: 'concentrate',
    label: '集中',
    teachFirstLessons: 0,
  }),
  mentor: Object.freeze({
    id: 'mentor',
    label: '育成',
    teachFirstLessons: PARAMS.maxLessons,
  }),
});

/** Phase 1 の smoke。障害率 0 で #731 の RI-206 を再現する。 */
export const SMOKE_RI206 = Object.freeze({
  id: 'smoke-ri206-no-incident',
  seed: COPIED_FROM_731.seed,
  incidentRate: 0,
  expected: Object.freeze({
    2: Object.freeze({
      concentrate: Object.freeze({
        delivered: 18,
        backlog: 6,
        apprenticeReview: 32,
        apprenticeGrowthWork: 0,
      }),
      mentor: Object.freeze({
        delivered: 11,
        backlog: 13,
        apprenticeReview: 52,
        apprenticeGrowthWork: 1,
      }),
    }),
    8: Object.freeze({
      concentrate: Object.freeze({
        delivered: 72,
        backlog: 24,
        apprenticeReview: 32,
        apprenticeGrowthWork: 0,
      }),
      mentor: Object.freeze({
        delivered: 77,
        backlog: 19,
        apprenticeReview: 52,
        apprenticeGrowthWork: 13,
      }),
    }),
  }),
});

/**
 * 構造チェック用の固定列。C=静穏、I=障害。
 * 集中が勝つ列と育成が勝つ列を、安定・危機の両方で手計算する。
 */
export const SMOKE_SEQUENCES = Object.freeze({
  allCalm: Object.freeze({
    id: 'all-calm',
    incidents: Object.freeze([false, false, false, false, false, false, false, false]),
    expected: Object.freeze({
      concentrate: Object.freeze({ delivered: 72, lessons: 0, apprenticeGrowthWork: 0 }),
      mentor: Object.freeze({ delivered: 77, lessons: 2, apprenticeGrowthWork: 13 }),
      winner: 'mentor',
    }),
  }),
  lateLessons: Object.freeze({
    id: 'late-lessons',
    incidents: Object.freeze([true, true, true, true, true, true, false, false]),
    expected: Object.freeze({
      concentrate: Object.freeze({ delivered: 54, lessons: 0, apprenticeGrowthWork: 0 }),
      mentor: Object.freeze({ delivered: 47, lessons: 2, apprenticeGrowthWork: 1 }),
      winner: 'concentrate',
    }),
  }),
  firstIncidentThenCalm: Object.freeze({
    id: 'first-incident-then-calm',
    incidents: Object.freeze([true, false, false, false, false, false, false, false]),
    expected: Object.freeze({
      concentrate: Object.freeze({ delivered: 69, lessons: 0, apprenticeGrowthWork: 0 }),
      mentor: Object.freeze({ delivered: 72, lessons: 2, apprenticeGrowthWork: 11 }),
      winner: 'mentor',
    }),
  }),
  allIncident: Object.freeze({
    id: 'all-incident',
    incidents: Object.freeze([true, true, true, true, true, true, true, true]),
    expected: Object.freeze({
      concentrate: Object.freeze({ delivered: 48, lessons: 0, apprenticeGrowthWork: 0 }),
      mentor: Object.freeze({ delivered: 48, lessons: 0, apprenticeGrowthWork: 0 }),
      winner: 'tie',
    }),
  }),
});

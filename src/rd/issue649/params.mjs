/**
 * Issue #649 Phase 1 の凍結候補値。
 * 本番コードからは import しない。ライブ値はここに複製したコピーだけを使う。
 */

/** ライブコードから複製した参照値。式へは入れず、候補の根拠だけに使う。 */
export const COPIED_FROM_LIVE = {
  source: 'copied-not-imported',
  bosses: {
    id: 'major-incident',
    name: '本番大規模障害',
    incidentMul: 1.1,
    maxSpread: 2,
    minSprintDelivered: 40,
    copiedFrom: 'src/data/bosses.ts',
  },
  process: {
    incidentBaseProbability: 0.02,
    incidentMaximum: 0.4,
    burnTicks: 35,
    spreadDebt: 6,
    spreadMoraleCost: 5,
    customerTrustPerSpreadRaw: 2,
    customerTrustPerIncidentRaw: 0.5,
    copiedFrom: 'src/data/balance/process.ts',
  },
  sprint: {
    gradePenaltyIncident: 6,
    gradePenaltySpread: 10,
    copiedFrom: 'src/data/balance/sprint.ts',
  },
  members: {
    starterStaffIds: ['starter-coder', 'starter-ai-junior', 'starter-reviewer'],
    copiedFrom: 'src/data/members.ts',
  },
  prototypes: {
    otherValuePerTick: 2,
    investigationTicks: 2,
    shippedValue: 20,
    copiedFrom: ['src/prototypes/incidentRecovery.ts', 'src/prototypes/incidentInvestigation.ts'],
  },
};

export const ROLES = Object.freeze(['recovery', 'investigation', 'communication']);

export const DECISION_METRIC = 'netOutcome';

export const DECISION_METRIC_JUSTIFICATION = [
  'downtime-only は線形復旧だと 2 件目を足しても 2W/3 < W のため、両条件で all-on-recovery が勝つ。',
  '説明担当は信頼低下だけを動かすので、停止時間だけでは評価に乗らない。',
  'netOutcome だけが復旧時間・再発・信頼・未配置の通常成果・交代費用を一つの比較値に載せる。',
  '復旧時間・再発・信頼は説明用に別掲し、採否の単一指標には使わない。',
].join(' ');

export const PARAMS = Object.freeze({
  experimentId: 'issue649-phase1',
  seed: 649,
  staffIds: Object.freeze([...COPIED_FROM_LIVE.members.starterStaffIds]),
  roles: ROLES,
  horizonTicks: 24,
  baseRecoveryWork: 12,
  recoveryPower: 1,
  baselineRecoveryRate: 1,
  investigationWork: 4,
  investigationRecurrenceReduction: 0.45,
  communicationTrustReduction: 0.15,
  baseTrustDrop: 0.35,
  recurrenceThreshold: 0.5,
  normalWorkPerTick: COPIED_FROM_LIVE.prototypes.otherValuePerTick,
  alreadyShipped: COPIED_FROM_LIVE.bosses.minSprintDelivered,
  downtimeCostPerTick: COPIED_FROM_LIVE.sprint.gradePenaltyIncident,
  switchCost: 2,
  initialAssignmentFree: true,
  decisionMetric: DECISION_METRIC,
});

/** 本比較の seed。1 seed につき u を 1 回だけ引く。 */
export const COMPARISON_SEEDS = Object.freeze([
  'RI-649-a',
  'RI-649-b',
  'RI-649-c',
  'RI-649-d',
  'RI-649-e',
]);

export const CONDITIONS = Object.freeze({
  A: Object.freeze({
    id: 'A',
    label: 'low-recurrence',
    baseRecurrence: 0.2,
  }),
  B: Object.freeze({
    id: 'B',
    label: 'high-recurrence',
    baseRecurrence: 0.9,
  }),
});

export const POLICIES = Object.freeze({
  'all-on-recovery': Object.freeze({
    id: 'all-on-recovery',
    recovery: 3,
    investigation: 0,
    communication: 0,
    plannedSwitches: 0,
  }),
  split: Object.freeze({
    id: 'split',
    recovery: 1,
    investigation: 1,
    communication: 1,
    plannedSwitches: 0,
  }),
  'investigation-first': Object.freeze({
    id: 'investigation-first',
    recovery: 1,
    investigation: 2,
    communication: 0,
    plannedSwitches: 1,
  }),
});

/** Phase 1 の比較スクリプトはこれだけを実行する。本実験の 2×3 盤面は含めない。 */
export const SMOKE_CASE = Object.freeze({
  id: 'smoke-trivial',
  seed: 0,
  staffIds: Object.freeze(['smoke-1']),
  horizonTicks: 10,
  baseRecoveryWork: 4,
  recoveryPower: 1,
  baselineRecoveryRate: 1,
  investigationWork: 4,
  investigationRecurrenceReduction: 0.45,
  communicationTrustReduction: 0.15,
  baseTrustDrop: 0,
  recurrenceThreshold: 0.5,
  normalWorkPerTick: 1,
  alreadyShipped: 10,
  downtimeCostPerTick: 1,
  switchCost: 2,
  initialAssignmentFree: true,
  condition: Object.freeze({
    id: 'smoke',
    label: 'trivial-no-recurrence',
    baseRecurrence: 0,
  }),
  policy: Object.freeze({
    id: 'smoke-recovery',
    recovery: 1,
    investigation: 0,
    communication: 0,
    plannedSwitches: 0,
  }),
  expected: Object.freeze({
    violations: 0,
    recoveryTime: 4,
    totalDowntime: 4,
    recurred: false,
    incidentCount: 1,
    effectiveTrustDrop: 0,
    shippedAfterTrust: 16,
    netOutcome: 12,
  }),
});

export const SMOKE_DOUBLE_ASSIGN = Object.freeze({
  id: 'smoke-double-assign',
  staffIds: Object.freeze(['smoke-1']),
  overlappingLists: Object.freeze({
    recovery: Object.freeze(['smoke-1']),
    investigation: Object.freeze(['smoke-1']),
    communication: Object.freeze([]),
  }),
  expectedViolations: 1,
});

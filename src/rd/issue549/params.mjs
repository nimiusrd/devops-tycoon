/**
 * Issue #549 Phase 1 の凍結値。
 * #733 (`src/prototypes/featureSets.ts`) から複製しただけ。ライブ import しない。
 */

/** #733 から複製した参照値。式へは入れず、候補の根拠だけに使う。 */
export const COPIED_FROM_733 = Object.freeze({
  source: 'copied-not-imported',
  copiedFrom: [
    'src/prototypes/featureSets.ts',
    'docs/prototypes/RI-153-feature-sets.md',
    'docs/prototypes/feature-sets-comparison.json',
  ],
  issue: 733,
  seed: 'RI-153',
  deadline: 8,
  workPerTick: 1,
  reworkProbability: 0.25,
  reworkExtraWork: 1,
  taskDefinitions: Object.freeze([
    Object.freeze({ work: 2, value: 4 }),
    Object.freeze({ work: 2, value: 4 }),
    Object.freeze({ work: 5, value: 4 }),
    Object.freeze({ work: 1, value: 2 }),
    Object.freeze({ work: 1, value: 2 }),
    Object.freeze({ work: 4, value: 3 }),
  ]),
  featureSets: Object.freeze([
    Object.freeze({ id: 'reports', required: Object.freeze([0, 1, 2]), integrationValue: 8 }),
    Object.freeze({ id: 'alerts', required: Object.freeze([3, 4, 5]), integrationValue: 5 }),
  ]),
  roles: Object.freeze(['api', 'screen', 'migration']),
  immediateOrder: Object.freeze([0, 1, 3, 4, 5, 2]),
  featureCompleteOrder: Object.freeze([3, 4, 5, 0, 1, 2]),
  recorded: Object.freeze({
    immediate: Object.freeze({ individualValue: 12, integrationValue: 0 }),
    featureComplete: Object.freeze({ individualValue: 11, integrationValue: 5 }),
  }),
});

export const DECISION_METRIC = 'totalShippedValue';

export const DECISION_METRIC_JUSTIFICATION = [
  'totalShippedValue = individualValue + setReward。',
  '個別出荷とセット完成報酬は別勘定し、後者は #733 の統合価値（reports 8 / alerts 5）をそのまま足す。',
  '個別価値をセット報酬へ再加算しない。完成は featureId ごとに一度だけ。',
].join(' ');

/** ゼロ手戻りでセットがちょうど完成する最小 tick。alerts = 1+1+4。 */
export const TIGHT_DEADLINE_TICKS = 6;

export const PARAMS = Object.freeze({
  experimentId: 'issue549-phase1',
  copiedIssue: 733,
  taskCount: 6,
  setCount: 2,
  workPerTick: COPIED_FROM_733.workPerTick,
  reworkExtraWork: COPIED_FROM_733.reworkExtraWork,
  reworkOnlyMigration: true,
  baselineDeadline: COPIED_FROM_733.deadline,
  baselineReworkProbability: COPIED_FROM_733.reworkProbability,
  tightDeadline: TIGHT_DEADLINE_TICKS,
  heavyReworkProbability: COPIED_FROM_733.reworkProbability * 2,
  reportsIntegrationValue: 8,
  alertsIntegrationValue: 5,
  decisionMetric: DECISION_METRIC,
});

export const TASK_DEFINITIONS = COPIED_FROM_733.taskDefinitions;
export const FEATURE_SETS = COPIED_FROM_733.featureSets;

export const COMPARISON_SEEDS = Object.freeze([
  'RI-153',
  'RI-549-a',
  'RI-549-b',
  'RI-549-c',
  'RI-549-d',
]);

export const CONDITIONS = Object.freeze({
  baseline: Object.freeze({
    id: 'baseline',
    label: '#733 as-is',
    deadline: PARAMS.baselineDeadline,
    reworkProbability: PARAMS.baselineReworkProbability,
  }),
  'tight-deadline': Object.freeze({
    id: 'tight-deadline',
    label: 'zero-rework set-complete minimum',
    deadline: PARAMS.tightDeadline,
    reworkProbability: PARAMS.baselineReworkProbability,
  }),
  'heavy-rework': Object.freeze({
    id: 'heavy-rework',
    label: '2x baseline rework probability',
    deadline: PARAMS.baselineDeadline,
    reworkProbability: PARAMS.heavyReworkProbability,
  }),
});

export const POLICIES = Object.freeze({
  'immediate-ship': Object.freeze({
    id: 'immediate-ship',
    order: COPIED_FROM_733.immediateOrder,
  }),
  'feature-complete-first': Object.freeze({
    id: 'feature-complete-first',
    order: COPIED_FROM_733.featureCompleteOrder,
  }),
});

/** Phase 1 の smoke。#733 の RI-153 固定盤面を再現する。 */
export const SMOKE_RI153 = Object.freeze({
  id: 'smoke-ri153-baseline',
  seed: 'RI-153',
  conditionId: 'baseline',
  expectedReworkPending: Object.freeze({ 2: true, 5: false }),
  expected: Object.freeze({
    'immediate-ship': Object.freeze({
      individualValue: 12,
      setReward: 0,
      totalShippedValue: 12,
      completedFeatureIds: Object.freeze([]),
      individualShipEvents: 4,
      setCompletionEvents: 0,
    }),
    'feature-complete-first': Object.freeze({
      individualValue: 11,
      setReward: 5,
      totalShippedValue: 16,
      completedFeatureIds: Object.freeze(['alerts']),
      individualShipEvents: 4,
      setCompletionEvents: 1,
    }),
  }),
});

/** 両セット完成後も個別・完成は一度ずつ。手戻りなし・期限 20。 */
export const SMOKE_NO_DOUBLE_COUNT = Object.freeze({
  id: 'smoke-no-double-count',
  seed: 1,
  deadline: 20,
  reworkProbability: 0,
  order: Object.freeze([5, 4, 3, 2, 1, 0]),
  expected: Object.freeze({
    individualValue: 19,
    setReward: 13,
    totalShippedValue: 32,
    completedFeatureIds: Object.freeze(['alerts', 'reports']),
    individualShipEvents: 6,
    setCompletionEvents: 2,
  }),
});

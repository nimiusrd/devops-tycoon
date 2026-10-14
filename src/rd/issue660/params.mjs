/**
 * Issue #660 Phase 1 の凍結値。
 * #732 (`src/prototypes/rescue.ts`) と、そこで再利用していた本番定数を複製しただけ。
 * ライブ import しない。
 */

/** #732 / 本番から複製した参照値。式へは入れず、候補の根拠だけに使う。 */
export const COPIED_FROM_732 = Object.freeze({
  source: 'copied-not-imported',
  copiedFrom: [
    'src/prototypes/rescue.ts',
    'docs/prototypes/RI-264-rescue.md',
    'docs/prototypes/rescue-comparison.json',
    'src/data/balance/actions.ts',
    'src/data/balance/process.ts',
    'src/sim/scenarios.ts',
  ],
  issue: 732,
  seed: 'RI-264-review-crisis-1',
  taskCount: 20,
  limitTicks: 120,
  safetyMaxTicks: 121,
  focusMax: 9,
  maxSuccessfulInterventions: 3,
  seniorHp: 60,
  morale: 40,
  baselineReviewWaiting: 6,
  baselineBurning: 2,
  burnDeadlines: Object.freeze([50, 70]),
  codingSlots: 6,
  interruptReview: Object.freeze({
    focusCost: 3,
    cooldownTicks: 70,
    reviewCount: 4,
    hpCost: 2,
  }),
  firefight: Object.freeze({
    focusCost: 1,
    cooldownTicks: 40,
    hpCost: 2,
    hpEscalation: 1,
    hpCostMax: 6,
    lightHpCost: 11,
    urgentBurnTicks: 15,
    urgentMinimumBurning: 2,
  }),
  andon: Object.freeze({
    focusCost: 5,
    cooldownTicks: 250,
    durationTicks: 12,
    congestedReviewMin: 10,
    thinHpCost: 14,
  }),
  autoContainHpCost: 12,
  recordedUnattended: Object.freeze({
    delivered: 176,
    spread: 1,
    burning: 1,
    seniorHp: 7.6,
    rescued: false,
  }),
  recordedContainAndReview: Object.freeze({
    delivered: 201,
    spread: 0,
    burning: 0,
    seniorHp: 23.05,
    rescued: true,
  }),
});

/** #732 の救済条件。通常の勝利判定とは独立。 */
export const RESCUE_RULE = Object.freeze({
  deliveredMin: 180,
  spreadMax: 2,
  seniorHpMin: 10,
  burningMax: 0,
});

export const DECISION_METRIC = 'rescued';

export const DECISION_METRIC_JUSTIFICATION = [
  'rescued は #732 の成功条件をそのまま使う。',
  '終了時に delivered >= 180 かつ spread <= 2 かつ seniorHp >= 10 かつ burning === 0。',
  '全タスク完了は要求しない。通常ランの勝利判定とは独立。',
].join(' ');

export const INTERVENTION_SLOTS = Object.freeze([10, 20, 40, 60, 80]);

export const ACTIONS = Object.freeze(['interruptReview', 'andon', 'firefight']);

/**
 * 無介入の終了値。基準は #732 実測。滞留×2 / 流入×2 は同じ土台へ倍率だけを掛ける。
 * 隔離モデルは本番 stepSprint を動かさない。
 */
export const UNATTENDED = Object.freeze({
  baseline: Object.freeze({
    delivered: COPIED_FROM_732.recordedUnattended.delivered,
    spread: COPIED_FROM_732.recordedUnattended.spread,
    burning: COPIED_FROM_732.recordedUnattended.burning,
    seniorHp: COPIED_FROM_732.recordedUnattended.seniorHp,
  }),
  'review-stall-x2': Object.freeze({
    delivered: COPIED_FROM_732.recordedUnattended.delivered - 12,
    spread: 1,
    burning: 1,
    seniorHp: 14,
  }),
  'inflow-x2': Object.freeze({
    delivered: COPIED_FROM_732.recordedUnattended.delivered - 16,
    spread: 2,
    burning: 2,
    seniorHp: 9,
  }),
});

export const DELTAS = Object.freeze({
  fireDelivered: 12,
  reviewDelivered: 16,
  reviewDeliveredStall: 24,
  andonThinDelivered: -8,
  andonCongestedDelivered: 8,
  andonInflowRescueDelivered: 24,
  andonInflowRescueUntilTick: 20,
  intakePerTick: Object.freeze({
    baseline: 0.1,
    'review-stall-x2': 0.1,
    'inflow-x2': 0.2,
  }),
});

export const PARAMS = Object.freeze({
  experimentId: 'issue660-phase1',
  copiedIssue: 732,
  seed: COPIED_FROM_732.seed,
  taskCount: COPIED_FROM_732.taskCount,
  limitTicks: COPIED_FROM_732.limitTicks,
  focusMax: COPIED_FROM_732.focusMax,
  maxSuccessfulInterventions: COPIED_FROM_732.maxSuccessfulInterventions,
  seniorHp: COPIED_FROM_732.seniorHp,
  codingSlots: COPIED_FROM_732.codingSlots,
  inflowMultiplier: 2,
  reviewStallMultiplier: 2,
  reviewDrawCount: 64,
  incidentProbability: 0,
  reworkProbability: 0,
  decisionMetric: DECISION_METRIC,
});

export const BOARDS = Object.freeze({
  baseline: Object.freeze({
    id: 'baseline',
    label: '基準（#732 の盤面）',
    reviewWaiting: COPIED_FROM_732.baselineReviewWaiting,
    codingSlots: PARAMS.codingSlots,
    backlog: 12,
  }),
  'review-stall-x2': Object.freeze({
    id: 'review-stall-x2',
    label: 'レビュー滞留×2',
    reviewWaiting: COPIED_FROM_732.baselineReviewWaiting * PARAMS.reviewStallMultiplier,
    codingSlots: PARAMS.codingSlots,
    backlog: 6,
  }),
  'inflow-x2': Object.freeze({
    id: 'inflow-x2',
    label: '流入×2',
    reviewWaiting: COPIED_FROM_732.baselineReviewWaiting,
    codingSlots: PARAMS.codingSlots * PARAMS.inflowMultiplier,
    backlog: 12,
  }),
});

export const REPRESENTATIVE_ORDERS = Object.freeze({
  unattended: Object.freeze([]),
  'contain-and-review': Object.freeze([
    Object.freeze({ tick: 10, action: 'firefight' }),
    Object.freeze({ tick: 20, action: 'interruptReview' }),
    Object.freeze({ tick: 60, action: 'firefight' }),
  ]),
  'andon-review-fire': Object.freeze([
    Object.freeze({ tick: 10, action: 'andon' }),
    Object.freeze({ tick: 20, action: 'interruptReview' }),
    Object.freeze({ tick: 40, action: 'firefight' }),
  ]),
  'fire-review-andon': Object.freeze([
    Object.freeze({ tick: 10, action: 'firefight' }),
    Object.freeze({ tick: 20, action: 'interruptReview' }),
    Object.freeze({ tick: 40, action: 'andon' }),
  ]),
  'late-andon-only': Object.freeze([Object.freeze({ tick: 80, action: 'andon' })]),
});

/** 盤面ごとに、その盤面だけで見る代表順序。他盤面の結果は参照しない。 */
export const BOARD_ORDER_MATRIX = Object.freeze({
  baseline: Object.freeze(['unattended', 'contain-and-review', 'fire-review-andon']),
  'review-stall-x2': Object.freeze(['unattended', 'andon-review-fire', 'late-andon-only']),
  'inflow-x2': Object.freeze(['unattended', 'andon-review-fire', 'late-andon-only']),
});

/** 手計算と smoke が照合する期待値。後から合わせていない。 */
export const SMOKE_EXPECTED = Object.freeze({
  baseline: Object.freeze({
    unattended: Object.freeze({
      rescued: false,
      delivered: 176,
      spread: 1,
      burning: 1,
      seniorHp: 7.6,
    }),
    'contain-and-review': Object.freeze({
      rescued: true,
      delivered: 216,
      spread: 0,
      burning: 0,
      seniorHp: 24.6,
    }),
    'fire-review-andon': Object.freeze({
      rescued: false,
      delivered: 196,
      spread: 0,
      burning: 0,
      seniorHp: 1.6,
    }),
  }),
  'review-stall-x2': Object.freeze({
    unattended: Object.freeze({
      rescued: false,
      delivered: 164,
      spread: 1,
      burning: 1,
      seniorHp: 14,
    }),
    'andon-review-fire': Object.freeze({
      rescued: true,
      delivered: 208,
      spread: 0,
      burning: 0,
      seniorHp: 22,
    }),
    'late-andon-only': Object.freeze({
      rescued: false,
      delivered: 172,
      spread: 1,
      burning: 1,
      seniorHp: 14,
    }),
  }),
  'inflow-x2': Object.freeze({
    unattended: Object.freeze({
      rescued: false,
      delivered: 160,
      spread: 2,
      burning: 2,
      seniorHp: 9,
    }),
    'andon-review-fire': Object.freeze({
      rescued: true,
      delivered: 204,
      spread: 0,
      burning: 0,
      seniorHp: 10,
    }),
    'late-andon-only': Object.freeze({
      rescued: false,
      delivered: 168,
      spread: 2,
      burning: 2,
      seniorHp: 9,
    }),
  }),
});

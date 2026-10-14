/**
 * Issue #586 Phase 1 の凍結値。
 * #778 の仕事盤面定数と RI-190 / #779 の計画 tick を複製しただけ。ライブ import しない。
 */

/** RI-190 (`src/prototypes/implementationPlan.ts`) から複製した参照値。式へは入れず、候補の根拠だけに使う。 */
export const COPIED_FROM_190 = Object.freeze({
  source: 'copied-not-imported',
  copiedFrom: [
    'src/prototypes/implementationPlan.ts',
    'src/prototypes/modelAssignment.ts',
    'docs/prototypes/RI-190-implementation-plan.md',
    'docs/prototypes/implementation-plan-comparison.json',
  ],
  issue: 586,
  prototypeIssue: 190,
  prototypePr: 779,
  seed: 'RI-190',
  planTicks: 2,
  wanderWork: 3,
  wanderPenalty: 6,
  jobWork: 6,
  jobValue: Object.freeze({ simple: 10, complex: 18 }),
  horizons: Object.freeze({ simpleShort: 6, complexTight: 8, complexLong: 12 }),
  recorded: Object.freeze({
    simpleShort: Object.freeze({ rush: 10, plan: 0 }),
    complexTight: Object.freeze({ rush: 0, plan: 18 }),
    complexLong: Object.freeze({ rush: 12, plan: 18 }),
  }),
});

export const DECISION_METRIC = 'shippedValue';

export const DECISION_METRIC_JUSTIFICATION = [
  'shippedValue は期限内に終えた仕事の価値。未完了は 0。',
  '迷走して完了したら JOB_VALUE から wanderPenalty を一度だけ引く。',
  '完成 tick や迷走回数そのものは得点にしない。',
].join(' ');

/**
 * #779 の +3 迷走工数だと、期限 8 で計画なしも 6+3=9 で未完了になる。
 * 両方が未完了だと期限ぎりぎりの計画なし厳密勝ちが消えるので、+2 に固定する。
 * 迷走しなければ計画ありは 2+6=8 でちょうど終わる。
 */
export const WANDER_EXTRA = 2;
export const PLAN_TICKS = COPIED_FROM_190.planTicks;
export const JOB_WORK = COPIED_FROM_190.jobWork;
export const WANDER_PENALTY = COPIED_FROM_190.wanderPenalty;
export const JOB_VALUE = COPIED_FROM_190.jobValue;
export const TIGHT_DEADLINE = PLAN_TICKS + JOB_WORK;
export const PLENTY_DEADLINE = COPIED_FROM_190.horizons.complexLong;

/** 計画なしの complex 迷走率。計画ありは半分。 */
export const RUSH_WANDER_RATE = 0.5;
export const PLAN_WANDER_RATE = RUSH_WANDER_RATE / 2;

/**
 * 単純仕事は計画しても迷走率を下げない（計画不要の初動遅延だけが残る）。
 * 計画なし complex と同じ発生率を両方針で共有する。
 */
export const SIMPLE_WANDER_RATE = RUSH_WANDER_RATE;

export const PARAMS = Object.freeze({
  experimentId: 'issue586-phase1',
  copiedIssues: Object.freeze([190, 779]),
  planTicks: PLAN_TICKS,
  jobWork: JOB_WORK,
  wanderExtra: WANDER_EXTRA,
  wanderPenalty: WANDER_PENALTY,
  simpleValue: JOB_VALUE.simple,
  complexValue: JOB_VALUE.complex,
  tightDeadline: TIGHT_DEADLINE,
  plentyDeadline: PLENTY_DEADLINE,
  rushWanderRate: RUSH_WANDER_RATE,
  planWanderRate: PLAN_WANDER_RATE,
  simpleWanderRate: SIMPLE_WANDER_RATE,
  drawsPerSeed: 1,
  decisionMetric: DECISION_METRIC,
  simpleExcludedFromVerdict: true,
  passLine: Object.freeze({
    excludeSimple: true,
    complexPlentyPlanWins: 4,
    tightRushWins: 4,
    seeds: 5,
    tiesAreNotWins: true,
    otherwise: 'Kill',
  }),
});

export const COMPARISON_SEEDS = Object.freeze([
  'RI-586-a',
  'RI-586-b',
  'RI-586-c',
  'RI-586-d',
  'RI-586-e',
]);

export const CONDITIONS = Object.freeze({
  'simple-plenty': Object.freeze({
    id: 'simple-plenty',
    kind: 'simple',
    slack: 'plenty',
    deadline: PARAMS.plentyDeadline,
    inVerdict: false,
  }),
  'simple-tight': Object.freeze({
    id: 'simple-tight',
    kind: 'simple',
    slack: 'tight',
    deadline: PARAMS.tightDeadline,
    inVerdict: false,
  }),
  'complex-plenty': Object.freeze({
    id: 'complex-plenty',
    kind: 'complex',
    slack: 'plenty',
    deadline: PARAMS.plentyDeadline,
    inVerdict: true,
  }),
  'complex-tight': Object.freeze({
    id: 'complex-tight',
    kind: 'complex',
    slack: 'tight',
    deadline: PARAMS.tightDeadline,
    inVerdict: true,
  }),
});

export const POLICIES = Object.freeze({
  plan: Object.freeze({
    id: 'plan',
    label: '計画あり',
    paysPlanTicks: true,
  }),
  rush: Object.freeze({
    id: 'rush',
    label: '計画なし',
    paysPlanTicks: false,
  }),
});

export function wanderRate(kind, policyId) {
  if (kind === 'simple') return PARAMS.simpleWanderRate;
  return policyId === 'plan' ? PARAMS.planWanderRate : PARAMS.rushWanderRate;
}

/**
 * 手計算の固定列。u の帯は方針より先に決まり、両方針が同じ u を読む。
 * complex では p_plan=0.25 < p_rush=0.50 なので「計画だけ迷走」は起きない。
 * 単純では両方針が同じ率なので、迷走は常に両方かどちらでもない。
 */
export const SMOKE_SEQUENCES = Object.freeze({
  complexTightBothWander: Object.freeze({
    id: 'complex-tight-both-wander',
    conditionId: 'complex-tight',
    u: 0.1,
    expected: Object.freeze({
      planWandered: true,
      rushWandered: true,
      plan: 0,
      rush: 12,
      winner: 'rush',
    }),
  }),
  complexTightOnlyRush: Object.freeze({
    id: 'complex-tight-only-rush',
    conditionId: 'complex-tight',
    u: 0.4,
    expected: Object.freeze({
      planWandered: false,
      rushWandered: true,
      plan: 18,
      rush: 12,
      winner: 'plan',
    }),
  }),
  complexTightNeither: Object.freeze({
    id: 'complex-tight-neither',
    conditionId: 'complex-tight',
    u: 0.8,
    expected: Object.freeze({
      planWandered: false,
      rushWandered: false,
      plan: 18,
      rush: 18,
      winner: 'tie',
    }),
  }),
  complexPlentyBothWander: Object.freeze({
    id: 'complex-plenty-both-wander',
    conditionId: 'complex-plenty',
    u: 0.1,
    expected: Object.freeze({
      planWandered: true,
      rushWandered: true,
      plan: 12,
      rush: 12,
      winner: 'tie',
    }),
  }),
  complexPlentyOnlyRush: Object.freeze({
    id: 'complex-plenty-only-rush',
    conditionId: 'complex-plenty',
    u: 0.4,
    expected: Object.freeze({
      planWandered: false,
      rushWandered: true,
      plan: 18,
      rush: 12,
      winner: 'plan',
    }),
  }),
  complexPlentyNeither: Object.freeze({
    id: 'complex-plenty-neither',
    conditionId: 'complex-plenty',
    u: 0.8,
    expected: Object.freeze({
      planWandered: false,
      rushWandered: false,
      plan: 18,
      rush: 18,
      winner: 'tie',
    }),
  }),
  simpleTightBothWander: Object.freeze({
    id: 'simple-tight-both-wander',
    conditionId: 'simple-tight',
    u: 0.1,
    expected: Object.freeze({
      planWandered: true,
      rushWandered: true,
      plan: 0,
      rush: 4,
      winner: 'rush',
    }),
  }),
  simpleTightNeither: Object.freeze({
    id: 'simple-tight-neither',
    conditionId: 'simple-tight',
    u: 0.8,
    expected: Object.freeze({
      planWandered: false,
      rushWandered: false,
      plan: 10,
      rush: 10,
      winner: 'tie',
    }),
  }),
  simplePlentyBothWander: Object.freeze({
    id: 'simple-plenty-both-wander',
    conditionId: 'simple-plenty',
    u: 0.1,
    expected: Object.freeze({
      planWandered: true,
      rushWandered: true,
      plan: 4,
      rush: 4,
      winner: 'tie',
    }),
  }),
  simplePlentyNeither: Object.freeze({
    id: 'simple-plenty-neither',
    conditionId: 'simple-plenty',
    u: 0.8,
    expected: Object.freeze({
      planWandered: false,
      rushWandered: false,
      plan: 10,
      rush: 10,
      winner: 'tie',
    }),
  }),
});

/**
 * RunEngine 系テストの共通フィクスチャ（テスト用）。
 *
 * run-engine-* の各ファイルで同一定義が重複していたものを集約した。
 * 既定値を変えると広範囲のテストの期待値に影響するため、変更時は利用側も確認すること。
 */
import { createRng } from '../../../src/sim/rng';
import type { QuarterReview, RunTotals } from '../../../src/sim/run/types';
import { createSprint } from '../../../src/sim/sprint';
import type { OrgState, SprintMetrics, SprintState } from '../../../src/sim/types';

/** すべて 0 のラン集計。 */
export const zeroTotals = (): RunTotals => ({
  delivered: 0,
  done: 0,
  rework: 0,
  incidents: 0,
  contained: 0,
  spread: 0,
  aiAssisted: 0,
  completed: 0,
  reviewQueuePeak: 0,
  maxCombo: 0,
  consecutiveIncidentSprints: 0,
});

/** 中庸な組織状態。指標の境界を跨がない値にそろえてある。 */
export const makeOrg = (overrides: Partial<OrgState> = {}): OrgState => ({
  aiEnabled: true,
  aiDependency: 35,
  aiLiteracy: 50,
  testCoverage: 45,
  documentation: 30,
  quality: 50,
  morale: 45,
  seniorHp: 50,
  techDebt: 40,
  deliveryScore: 0,
  ...overrides,
});

/**
 * タスク 0 件で即完了扱いにしたスプリント。resolveSprint の入力に使う。
 * seed はファイルごとに固定値を渡す（盤面が空なので結果は seed に依存しないが、
 * 決定論を明示するために引数として残している）。
 */
export const completeSprint = (
  seed: string,
  org: OrgState,
  metrics: Partial<SprintMetrics> = {},
): SprintState => {
  const sprint = createSprint(
    { taskCount: 0, codingSlots: 1, maxTicks: 1, focusMax: 3 },
    org,
    createRng(seed),
  );
  return {
    ...sprint,
    complete: true,
    metrics: {
      ...sprint.metrics,
      seniorHpStart: org.seniorHp,
      ...metrics,
    },
  };
};

/** 目標未達だが調整可能な四半期レビュー。 */
export const adjustableReview = (
  adjustments: QuarterReview['availableAdjustments'],
): QuarterReview => ({
  goal: {
    deliveryTarget: 80,
    qualityTarget: 50,
    techDebtLimit: 50,
    moraleTarget: 45,
    incidentLimit: 3,
    aiAdoptionTarget: 40,
  },
  outcome: 'missed_adjustable',
  trust: { management: 60, customers: 60, team: 60 },
  progress: [],
  missedReasons: [],
  availableAdjustments: adjustments,
  bossCleared: false,
});

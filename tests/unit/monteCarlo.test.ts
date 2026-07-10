import { describe, expect, it } from 'vitest';
import {
  assertMetricsHealthy,
  assertWithinRange,
  extractMetaRewardMetrics,
  extractReviewMetrics,
  extractRunMetrics,
  runMonteCarlo,
  runMonteCarloSummary,
  summarizeMetaRewardMonteCarlo,
  summarizeInterventionComparisons,
  summarizeMonteCarlo,
  summarizeNumeric,
  summarizeReviewMonteCarlo,
  type InterventionComparison,
  type RunMetrics,
} from './helpers/monteCarlo';
import {
  ALL_POINTS_RANGE,
  CHEAPEST_UNLOCK_COST,
  LOSS_POINTS_RANGE,
  MAX_WINS_FOR_CHEAPEST_UNLOCK,
  MAX_WINS_FOR_MOST_EXPENSIVE_UNLOCK,
  MOST_EXPENSIVE_UNLOCK_COST,
  TOTAL_UNLOCK_COST,
  WIN_POINTS_RANGE,
} from './helpers/metaRewardRanges';
import { REVIEW_FREEZE_PEAK } from '../../src/sim/outcome';
import { RunEngine } from '../../src/sim/run/engine';
import { runSprintSimulation, type SprintBaselineInput } from '../../src/sim/run/sprintBaseline';
import { applyAction } from '../../src/sim/actions';
import { IDENTITY_CARD_EFFECTS } from '../../src/sim/model';
import { createOrgState } from '../../src/sim/org';
import { resolveSprintConfig } from '../../src/sim/sprint';
import { playRun } from './helpers/runFlow';

const MC_SEEDS = ['mc-a', 'mc-b', 'mc-c', 'mc-d', 'mc-e'] as const;

describe('monteCarlo 基盤（RI-14）', () => {
  describe('summarizeNumeric', () => {
    it('平均・最小・最大を計算する', () => {
      expect(summarizeNumeric([10, 20, 30])).toEqual({
        mean: 20,
        min: 10,
        max: 30,
        values: [10, 20, 30],
      });
    });

    it('空配列は 0 で埋める', () => {
      expect(summarizeNumeric([])).toEqual({
        mean: 0,
        min: 0,
        max: 0,
        values: [],
      });
    });
  });

  describe('runMonteCarlo（決定論）', () => {
    it('同一 seed 群なら集計結果が完全再現する', () => {
      const opts = { seedPrefix: 'det', trials: 5, difficulty: 'normal' as const };
      const a = runMonteCarloSummary(opts);
      const b = runMonteCarloSummary(opts);
      expect(a).toEqual(b);
    });

    it('各試行の seed が prefix-index 形式になる', () => {
      const results = runMonteCarlo({ seedPrefix: 'seed', trials: 3, difficulty: 'easy' });
      expect(results.map((r) => r.seed)).toEqual(['seed-0', 'seed-1', 'seed-2']);
    });

    it('trials <= 0 なら例外を投げる', () => {
      expect(() => runMonteCarlo({ seedPrefix: 'empty', trials: 0 })).toThrow(/trials は 1 以上/);
    });

    it('guardMax 到達で未決着なら例外を投げる', () => {
      expect(() => runMonteCarlo({ seedPrefix: 'unfinished', trials: 1, guardMax: 1 })).toThrow(
        /決着しませんでした/,
      );
    });
  });

  describe('メトリクス健全性', () => {
    it('代表 seed 群で有限値・非負・決着済み status になる', () => {
      for (const prefix of MC_SEEDS) {
        const results = runMonteCarlo({ seedPrefix: prefix, trials: 3, difficulty: 'normal' });
        for (const m of results) {
          expect(() => assertMetricsHealthy(m)).not.toThrow();
        }
      }
    });

    it('extractRunMetrics が RunState から主要 KPI を取り出す', () => {
      const e = new RunEngine({ seed: 'extract', difficulty: 'easy' });
      const final = playRun(e);
      const m = extractRunMetrics('extract', final);
      expect(m.delivered).toBe(final.totals.delivered);
      expect(m.reviewQueuePeak).toBe(final.totals.reviewQueuePeak);
      expect(m.seniorHp).toBe(final.org.seniorHp);
      expect(['won', 'lost']).toContain(m.status);
    });
  });

  describe('難易度差', () => {
    it('easy と nightmare で統計に差が出る', () => {
      const easy = runMonteCarloSummary({
        seedPrefix: 'diff',
        trials: MC_SEEDS.length,
        difficulty: 'easy',
      });
      const nightmare = runMonteCarloSummary({
        seedPrefix: 'diff',
        trials: MC_SEEDS.length,
        difficulty: 'nightmare',
      });

      const differs =
        easy.winRate !== nightmare.winRate ||
        easy.delivered.mean !== nightmare.delivered.mean ||
        easy.rework.mean !== nightmare.rework.mean ||
        easy.incidents.mean !== nightmare.incidents.mean ||
        easy.seniorHp.mean !== nightmare.seniorHp.mean;
      expect(differs).toBe(true);
    });
  });

  describe('assertWithinRange（RI-15 以降向け）', () => {
    it('許容レンジ内なら例外を投げない', () => {
      const summary = summarizeNumeric([50, 60, 70]);
      expect(() => assertWithinRange(summary, { min: 40, max: 80 }, 'delivered')).not.toThrow();
    });

    it('許容レンジ外なら例外を投げる', () => {
      const summary = summarizeNumeric([5, 10, 15]);
      expect(() => assertWithinRange(summary, { min: 20, max: 100 }, 'delivered')).toThrow(
        /許容レンジ/,
      );
    });
  });

  describe('summarizeMonteCarlo', () => {
    it('勝率を正しく集計する', () => {
      const results = runMonteCarlo({ seedPrefix: 'winrate', trials: 8, difficulty: 'easy' });
      const summary = summarizeMonteCarlo(results);
      expect(summary.trials).toBe(8);
      expect(summary.settled).toBe(8);
      expect(summary.unfinished).toBe(0);
      expect(summary.wins + summary.losses).toBe(8);
      expect(summary.winRate).toBeCloseTo(summary.wins / 8, 10);
    });

    it('未決着試行は数値集計から除外し unfinished を数える', () => {
      const settled: RunMetrics = {
        seed: 'settled',
        status: 'won',
        delivered: 100,
        rework: 5,
        incidents: 1,
        seniorHp: 50,
        reviewQueuePeak: 3,
        sprintsPlayed: 6,
        deliveryScore: 200,
      };
      const unfinished: RunMetrics = {
        seed: 'unfinished',
        status: 'playing',
        delivered: 999,
        rework: 999,
        incidents: 999,
        seniorHp: 999,
        reviewQueuePeak: 999,
        sprintsPlayed: 1,
        deliveryScore: 999,
      };
      const summary = summarizeMonteCarlo([settled, unfinished]);
      expect(summary.trials).toBe(2);
      expect(summary.settled).toBe(1);
      expect(summary.unfinished).toBe(1);
      expect(summary.delivered).toEqual({
        mean: 100,
        min: 100,
        max: 100,
        values: [100],
      });
    });
  });

  describe('RI-15: スプリント主要メトリクスの許容レンジ', () => {
    /** 代表 seed 群（`${RI15_SEED_PREFIX}-${i}`）。10 は review-freeze 境界(48)のため除外。 */
    const RI15_SEED_PREFIX = 'ri15-mc';
    const RI15_SEED_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12] as const;

    /**
     * normal 難易度・既定オートプレイでの許容レンジ。
     * 2026-07 計測（上記 seed 群）を基準に、極端な崩壊検知用へ余裕を持たせる。
     */
    const RI15_RANGES = {
      delivered: { min: 200, max: 8000 },
      rework: { min: 0, max: 55 },
      incidents: { min: 0, max: 50 },
      /** ドメイン上限 100 未満。全試行 0 HP や全試行満タンは mean/max ガードで検知。 */
      seniorHp: { min: 0, max: 90 },
      /** REVIEW_FREEZE_PEAK 未満。境界到達 seed は代表群から除外。 */
      reviewQueuePeak: { min: 10, max: REVIEW_FREEZE_PEAK - 1 },
    } as const;

    /** 代表 seed 群を走らせて集計する（連番 trials では 10 番を除外できないため）。 */
    function runRi15Summary() {
      const results = RI15_SEED_INDICES.map((i) => {
        const seed = `${RI15_SEED_PREFIX}-${i}`;
        const engine = new RunEngine({ seed, difficulty: 'normal' });
        const final = playRun(engine);
        return extractRunMetrics(seed, final);
      });
      return summarizeMonteCarlo(results);
    }

    it('normal 難易度の代表 seed 群が主要 KPI の許容レンジ内', () => {
      const summary = runRi15Summary();
      const trials = RI15_SEED_INDICES.length;

      expect(summary.settled).toBe(trials);
      expect(summary.wins).toBeGreaterThanOrEqual(3);
      expect(summary.winRate).toBeGreaterThan(0.2);
      expect(summary.seniorHp.max).toBeGreaterThan(50);
      expect(summary.seniorHp.mean).toBeGreaterThan(15);
      expect(summary.seniorHp.mean).toBeLessThan(65);
      assertWithinRange(summary.delivered, RI15_RANGES.delivered, 'delivered');
      assertWithinRange(summary.rework, RI15_RANGES.rework, 'rework');
      assertWithinRange(summary.incidents, RI15_RANGES.incidents, 'incidents');
      assertWithinRange(summary.seniorHp, RI15_RANGES.seniorHp, 'seniorHp');
      assertWithinRange(summary.reviewQueuePeak, RI15_RANGES.reviewQueuePeak, 'reviewQueuePeak');
    });
  });

  describe('RI-17: 四半期レビューの代償・outcome 閾値・目標生成の許容レンジ', () => {
    /** 代表 seed 群（`${RI17_SEED_PREFIX}-${i}`）。RI-15 と独立させ、レビュー系の回帰検知に使う。 */
    const RI17_SEED_PREFIX = 'ri17-review';
    const RI17_SEED_INDICES = [0, 1, 2, 3, 4, 5, 6, 7] as const;

    /**
     * normal 難易度・既定オートプレイでの四半期レビュー許容レンジ。
     * 細かなバランス調整を縛らず、目標生成や代償が極端に崩れる変更を検知する。
     */
    const RI17_RANGES = {
      reviewCount: { min: 0, max: 4 },
      adjustmentCount: { min: 0, max: 3 },
      finalQuarter: { min: 1, max: 5 },
      finalDeliveryTarget: { min: 15, max: 180 },
      finalQualityTarget: { min: 35, max: 70 },
      finalTechDebtLimit: { min: 35, max: 90 },
      finalMoraleTarget: { min: 25, max: 60 },
      finalIncidentLimit: { min: 4, max: 12 },
      finalAiAdoptionTarget: { min: 0, max: 60 },
      minStakeholderTrust: { min: 10, max: 75 },
    } as const;

    function runRi17Summary() {
      const results = RI17_SEED_INDICES.map((i) => {
        const seed = `${RI17_SEED_PREFIX}-${i}`;
        const engine = new RunEngine({ seed, difficulty: 'normal' });
        const final = playRun(engine);
        return extractReviewMetrics(seed, final);
      });
      return summarizeReviewMonteCarlo(results);
    }

    it('normal 難易度の代表 seed 群がレビュー関連 KPI の許容レンジ内', () => {
      const summary = runRi17Summary();
      const trials = RI17_SEED_INDICES.length;

      expect(summary.trials).toBe(trials);
      expect(summary.settled).toBe(trials);
      expect(summary.unfinished).toBe(0);
      assertWithinRange(summary.reviewCount, RI17_RANGES.reviewCount, 'reviewCount');
      assertWithinRange(summary.adjustmentCount, RI17_RANGES.adjustmentCount, 'adjustmentCount');
      assertWithinRange(summary.finalQuarter, RI17_RANGES.finalQuarter, 'finalQuarter');
      assertWithinRange(
        summary.finalDeliveryTarget,
        RI17_RANGES.finalDeliveryTarget,
        'finalDeliveryTarget',
      );
      assertWithinRange(
        summary.finalQualityTarget,
        RI17_RANGES.finalQualityTarget,
        'finalQualityTarget',
      );
      assertWithinRange(
        summary.finalTechDebtLimit,
        RI17_RANGES.finalTechDebtLimit,
        'finalTechDebtLimit',
      );
      assertWithinRange(
        summary.finalMoraleTarget,
        RI17_RANGES.finalMoraleTarget,
        'finalMoraleTarget',
      );
      assertWithinRange(
        summary.finalIncidentLimit,
        RI17_RANGES.finalIncidentLimit,
        'finalIncidentLimit',
      );
      assertWithinRange(
        summary.finalAiAdoptionTarget,
        RI17_RANGES.finalAiAdoptionTarget,
        'finalAiAdoptionTarget',
      );
      assertWithinRange(
        summary.minStakeholderTrust,
        RI17_RANGES.minStakeholderTrust,
        'minStakeholderTrust',
      );
    });
  });

  describe('RI-18: メタ解放コスト・points 配分の許容レンジ', () => {
    /** 代表 seed 群（`${RI18_SEED_PREFIX}-${i}`）。RI-15/RI-17 と独立。 */
    const RI18_SEED_PREFIX = 'ri18-meta';
    const RI18_SEED_INDICES = [0, 1, 2, 3, 4, 5, 6, 7] as const;

    function runRi18Summary() {
      const results = RI18_SEED_INDICES.map((i) => {
        const seed = `${RI18_SEED_PREFIX}-${i}`;
        const engine = new RunEngine({ seed, difficulty: 'normal' });
        const final = playRun(engine);
        return extractMetaRewardMetrics(seed, final);
      });
      return summarizeMetaRewardMonteCarlo(results);
    }

    it('normal 難易度の代表 seed 群が points 報酬の許容レンジ内', () => {
      const summary = runRi18Summary();
      const trials = RI18_SEED_INDICES.length;

      expect(summary.trials).toBe(trials);
      expect(summary.settled).toBe(trials);
      expect(summary.unfinished).toBe(0);
      expect(summary.winPointsGained.values.length).toBeGreaterThan(0);
      expect(summary.lossPointsGained.values.length).toBeGreaterThan(0);

      assertWithinRange(summary.pointsGained, ALL_POINTS_RANGE, 'pointsGained');
      assertWithinRange(summary.winPointsGained, WIN_POINTS_RANGE, 'winPointsGained');
      assertWithinRange(summary.lossPointsGained, LOSS_POINTS_RANGE, 'lossPointsGained');
      assertWithinRange(summary.scoreMul, { min: 1, max: 1 }, 'scoreMul');
    });

    it('勝利報酬だけでは最安解放は 1 ランでは買えず、数ランで到達可能', () => {
      const summary = runRi18Summary();

      expect(summary.winPointsGained.max).toBeLessThan(CHEAPEST_UNLOCK_COST);
      expect(summary.winPointsGained.max * MAX_WINS_FOR_CHEAPEST_UNLOCK).toBeGreaterThanOrEqual(
        CHEAPEST_UNLOCK_COST,
      );
      expect(
        summary.winPointsGained.max * MAX_WINS_FOR_MOST_EXPENSIVE_UNLOCK,
      ).toBeGreaterThanOrEqual(MOST_EXPENSIVE_UNLOCK_COST);
    });

    it('全解放合計コストが現行報酬ペースで到達可能な範囲', () => {
      const summary = runRi18Summary();
      const avgWin = summary.winPointsGained.mean;
      const avgLoss = summary.lossPointsGained.mean;
      const blendedMean =
        summary.winPointsGained.values.length > 0 && summary.lossPointsGained.values.length > 0
          ? (avgWin * summary.winPointsGained.values.length +
              avgLoss * summary.lossPointsGained.values.length) /
            summary.settled
          : summary.pointsGained.mean;

      const estimatedRunsToComplete = Math.ceil(TOTAL_UNLOCK_COST / blendedMean);
      expect(estimatedRunsToComplete).toBeGreaterThan(5);
      expect(estimatedRunsToComplete).toBeLessThan(50);
    });
  });

  describe('RI-56: 介入効果量の許容レンジ', () => {
    const RI56_SEEDS = Array.from({ length: 24 }, (_, i) => `ri56-intervention-${i}`);

    interface Ri56Comparison extends InterventionComparison {
      interruptsUsed: number;
      firefightsUsed: number;
    }

    function runRi56Comparisons(): Ri56Comparison[] {
      return RI56_SEEDS.map((seed) => {
        const org = createOrgState('default', true);
        org.testCoverage = 0;
        org.aiLiteracy = 0;
        const input: SprintBaselineInput = {
          seed,
          config: resolveSprintConfig('default'),
          org,
          cardEffects: { ...IDENTITY_CARD_EFFECTS },
          aiAdoptionShare: 1,
          reviewLoadAdd: 6,
        };
        const baseline = runSprintSimulation(input);
        let interventionsUsed = 0;
        let interruptsUsed = 0;
        let firefightsUsed = 0;
        const intervention = runSprintSimulation(input, ({ sprint, org, rng, tick }) => {
          if (sprint.tasks.some((task) => task.lane === 'rework' && task.incident)) {
            if (applyAction('firefight', sprint, org, rng, tick).ok) {
              interventionsUsed += 1;
              firefightsUsed += 1;
            }
          }
          if (sprint.tasks.filter((task) => task.lane === 'review').length >= 6) {
            if (applyAction('interruptReview', sprint, org, rng, tick).ok) {
              interventionsUsed += 1;
              interruptsUsed += 1;
            }
          }
        });
        return {
          seed,
          baseline,
          intervention,
          interventionsUsed,
          interruptsUsed,
          firefightsUsed,
        };
      });
    }

    it('同一 seed 群と単純介入ポリシーなら結果が完全再現する', () => {
      expect(runRi56Comparisons()).toEqual(runRi56Comparisons());
    });

    it('介入が有効だが支配的ではない差分に収まる', () => {
      const comparisons = runRi56Comparisons();
      const summary = summarizeInterventionComparisons(comparisons);

      expect(summary.trials).toBe(RI56_SEEDS.length);
      expect(summary.interventionsUsed.min).toBeGreaterThan(0);
      expect(summary.interventionsUsed.mean).toBeGreaterThanOrEqual(3);
      expect(summary.interventionsUsed.mean).toBeLessThanOrEqual(8);
      expect(comparisons.reduce((sum, c) => sum + c.interruptsUsed, 0)).toBeGreaterThan(1);
      expect(comparisons.reduce((sum, c) => sum + c.firefightsUsed, 0)).toBeGreaterThan(1);

      // 平均 5〜25% の出荷改善を手応えの目安とし、単一 seed でも 75% 超の支配を許さない。
      expect(summary.deliveredDelta.mean).toBeGreaterThan(10);
      expect(summary.deliveredDeltaRatio.mean).toBeGreaterThanOrEqual(0.05);
      expect(summary.deliveredDeltaRatio.mean).toBeLessThanOrEqual(0.25);
      expect(summary.deliveredDeltaRatio.max).toBeLessThanOrEqual(0.75);

      // 緊急対応は延焼を悪化させず、平均では確実に抑える。
      expect(summary.spreadReduction.min).toBeGreaterThanOrEqual(0);
      expect(summary.spreadReduction.mean).toBeGreaterThanOrEqual(0.5);
      expect(summary.spreadReduction.mean).toBeLessThanOrEqual(4);

      // コンボ改善も有意だが、平均 +8 を超える唯一解にはしない。
      expect(summary.maxComboDelta.mean).toBeGreaterThanOrEqual(1);
      expect(summary.maxComboDelta.mean).toBeLessThanOrEqual(8);
    });
  });
});

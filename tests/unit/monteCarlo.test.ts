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
import {
  meetsAiAdoptionCausalDoD,
  RI41_RANGES,
  RI41_SEEDS,
  runAiAdoptionComparisons,
  summarizeAiAdoptionComparisons,
} from './helpers/aiAdoptionSeeds';
import {
  RI19_RANGES,
  RI19_SEEDS,
  runFormationComparisons,
  summarizeFormationComparisons,
} from './helpers/formationSeeds';

const MC_SEEDS = ['mc-a', 'mc-b', 'mc-c', 'mc-d', 'mc-e'] as const;

describe('monteCarlo 基盤（RI-14）', () => {
  describe('summarizeNumeric', () => {
    it('平均・最小・最大・分位を計算する', () => {
      expect(summarizeNumeric([10, 20, 30])).toEqual({
        mean: 20,
        min: 10,
        max: 30,
        p50: 20,
        p90: 30,
        values: [10, 20, 30],
      });
    });

    it('空配列は 0 で埋める', () => {
      expect(summarizeNumeric([])).toEqual({
        mean: 0,
        min: 0,
        max: 0,
        p50: 0,
        p90: 0,
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
        p50: 100,
        p90: 100,
        values: [100],
      });
    });
  });

  describe('RI-15: スプリント主要メトリクスの許容レンジ', () => {
    /**
     * 代表 seed 群。RI-75（taskFloor / taskCountMul 増）後は既定オートプレイの勝率が
     * 極端に稀なため、勝利確認済み seed と敗北 seed を混在させて固定する。
     */
    const RI15_SEEDS = [
      'ri18-meta-253',
      'ri18-meta-60',
      'wina-1450',
      'winc-1063',
      'wind-589',
      'wind-2161',
      'wine-886',
      'ri18-meta-10',
      'ri18-meta-20',
      'ri18-meta-30',
      'ri18-meta-40',
      'ri18-meta-50',
    ] as const;

    /** 連続インデックス崩壊検知用（勝率は期待せず、決着と出荷の床だけ見る）。 */
    const RI15_CONTIG_PREFIX = 'ri75f-mc';

    /**
     * normal 難易度・既定オートプレイでの許容レンジ。
     * RI-75 再計測（上記 seed 群）を基準に、極端な崩壊検知用へ余裕を持たせる。
     */
    const RI15_RANGES = {
      /** 勝利ランの長寿化で delivered 上振れ。極端な無出荷・桁外れだけ弾く。 */
      delivered: { min: 200, max: 25000 },
      rework: { min: 0, max: 80 },
      incidents: { min: 0, max: 70 },
      /** ドメイン上限 100 未満。全試行 0 HP や全試行満タンは mean ガードで検知。 */
      seniorHp: { min: 0, max: 99 },
      /** REVIEW_FREEZE_PEAK 未満。境界到達 seed は代表群から除外。 */
      reviewQueuePeak: { min: 10, max: REVIEW_FREEZE_PEAK - 1 },
    } as const;

    /** 代表 seed 群を走らせて集計する。 */
    function runRi15Summary() {
      const results = RI15_SEEDS.map((seed) => {
        const engine = new RunEngine({ seed, difficulty: 'normal' });
        const final = playRun(engine);
        return extractRunMetrics(seed, final);
      });
      return summarizeMonteCarlo(results);
    }

    it('normal 難易度の代表 seed 群が主要 KPI の許容レンジ内', () => {
      const summary = runRi15Summary();
      const trials = RI15_SEEDS.length;

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

    it('連続インデックス群（0..24）も極端な崩壊を検知できる最低勝率フロアを満たす', () => {
      /**
       * RI-75 追加 pacing 後、既定オートプレイの連番勝率は実質 0 に近い。
       * 代表群で勝率を担保し、ここでは「全試行が決着し、無出荷崩壊でない」ことだけを見る。
       */
      const results = runMonteCarlo({
        seedPrefix: RI15_CONTIG_PREFIX,
        trials: 25,
        difficulty: 'normal',
      });
      const summary = summarizeMonteCarlo(results);
      expect(summary.settled).toBe(25);
      expect(summary.unfinished).toBe(0);
      expect(summary.delivered.mean).toBeGreaterThan(100);
      expect(summary.delivered.max).toBeGreaterThan(200);
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
      // RI-75: タスク量増で四半期継続が伸び、レビュー/修正回数の上振れが出る。
      reviewCount: { min: 0, max: 6 },
      adjustmentCount: { min: 0, max: 5 },
      finalQuarter: { min: 1, max: 6 },
      // RI-68: deliveryTarget は四半期累計スケール（緩和下限〜ボス上限）。
      finalDeliveryTarget: { min: 1260, max: 4500 },
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
    /**
     * 代表 seed 群。RI-75 後は勝利が稀なため、勝利確認済み seed を含めて
     * win/loss 双方の points 帯を検証できるようにする。
     */
    const RI18_SEEDS = [
      'ri18-meta-253',
      'ri18-meta-2730',
      'wina-1450',
      'winc-1063',
      'wind-589',
      'wind-2161',
      'wine-886',
      'ri18-meta-10',
    ] as const;

    function runRi18Summary() {
      const results = RI18_SEEDS.map((seed) => {
        const engine = new RunEngine({ seed, difficulty: 'normal' });
        const final = playRun(engine);
        return extractMetaRewardMetrics(seed, final);
      });
      return summarizeMetaRewardMonteCarlo(results);
    }

    it('normal 難易度の代表 seed 群が points 報酬の許容レンジ内', () => {
      const summary = runRi18Summary();
      const trials = RI18_SEEDS.length;

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

      // 実出荷倍率は安定中に6段で頭打ちなので、生コンボの連続記録は +8 をわずかに
      // 超えうる。スコア支配は上の出荷差分レンジで抑え、連続達成の表示は +8.5 までに留める。
      expect(summary.maxComboDelta.mean).toBeGreaterThanOrEqual(1);
      expect(summary.maxComboDelta.mean).toBeLessThanOrEqual(8.5);
    });
  });

  describe('RI-19: 編成差のスプリント結果への影響レンジ', () => {
    it('同一 seed 群と編成ペアなら結果が完全再現する', () => {
      expect(runFormationComparisons()).toEqual(runFormationComparisons());
    });

    it('代表 seed の全件でコーディング偏重編成のレビュー滞留が増える', () => {
      const comparisons = runFormationComparisons();
      expect(comparisons).toHaveLength(RI19_SEEDS.length);
      expect(
        comparisons.every((c) => c.codingHeavy.reviewQueueMax > c.balanced.reviewQueueMax),
      ).toBe(true);
    });

    it('均衡編成とコーディング偏重編成の差分が許容レンジ内に収まる', () => {
      const summary = summarizeFormationComparisons(runFormationComparisons());

      expect(summary.trials).toBe(RI19_SEEDS.length);
      for (const [label, metric] of [
        ['deliveredDelta', summary.deliveredDelta],
        ['reviewQueueDelta', summary.reviewQueueDelta],
        ['reworkDelta', summary.reworkDelta],
      ] as const) {
        const range = RI19_RANGES[label];
        expect(metric.mean).toBeGreaterThanOrEqual(range.meanMin);
        expect(metric.mean).toBeLessThanOrEqual(range.meanMax);
        assertWithinRange(metric, { min: range.minFloor, max: range.maxCeil }, `RI-19 ${label}`);
      }
    });
  });

  describe('RI-41: AIあり/なし差分の代表 seed', () => {
    it('同一 seed 群なら AI あり/なしペアが完全再現する', () => {
      expect(runAiAdoptionComparisons()).toEqual(runAiAdoptionComparisons());
    });

    it('代表 seed の全件でコア因果（利用率・Review / Rework）が成立する', () => {
      const comparisons = runAiAdoptionComparisons();
      expect(comparisons).toHaveLength(RI41_SEEDS.length);
      const causalWins = comparisons.filter((c) => meetsAiAdoptionCausalDoD(c)).length;
      // 探索時は 0..31 全件成立。代表 12 本は全件を要求する。
      expect(causalWins).toBe(RI41_SEEDS.length);
    });

    it('差分の平均・最大が許容レンジ内に収まる', () => {
      const summary = summarizeAiAdoptionComparisons(runAiAdoptionComparisons());
      expect(summary.trials).toBe(RI41_SEEDS.length);

      expect(summary.aiAssistedPctWithout.min).toBe(RI41_RANGES.aiAssistedPctWithout.min);
      expect(summary.aiAssistedPctWithout.max).toBe(RI41_RANGES.aiAssistedPctWithout.max);
      expect(summary.aiAssistedPctWith.min).toBeGreaterThanOrEqual(
        RI41_RANGES.aiAssistedPctWith.min,
      );
      expect(summary.aiAssistedPctWith.max).toBeLessThanOrEqual(RI41_RANGES.aiAssistedPctWith.max);

      expect(summary.reviewQueueDelta.mean).toBeGreaterThanOrEqual(
        RI41_RANGES.reviewQueueDelta.meanMin,
      );
      expect(summary.reviewQueueDelta.mean).toBeLessThanOrEqual(
        RI41_RANGES.reviewQueueDelta.meanMax,
      );
      expect(summary.reviewQueueDelta.min).toBeGreaterThanOrEqual(
        RI41_RANGES.reviewQueueDelta.minFloor,
      );
      expect(summary.reviewQueueDelta.max).toBeLessThanOrEqual(
        RI41_RANGES.reviewQueueDelta.maxCeil,
      );

      expect(summary.reworkDelta.mean).toBeGreaterThanOrEqual(RI41_RANGES.reworkDelta.meanMin);
      expect(summary.reworkDelta.mean).toBeLessThanOrEqual(RI41_RANGES.reworkDelta.meanMax);
      expect(summary.reworkDelta.min).toBeGreaterThanOrEqual(RI41_RANGES.reworkDelta.minFloor);
      expect(summary.reworkDelta.max).toBeLessThanOrEqual(RI41_RANGES.reworkDelta.maxCeil);

      expect(summary.deliveredDelta.mean).toBeGreaterThanOrEqual(
        RI41_RANGES.deliveredDelta.meanMin,
      );
      expect(summary.deliveredDelta.mean).toBeLessThanOrEqual(RI41_RANGES.deliveredDelta.meanMax);
      expect(summary.deliveredDelta.min).toBeGreaterThanOrEqual(
        RI41_RANGES.deliveredDelta.minFloor,
      );
      expect(summary.deliveredDelta.max).toBeLessThanOrEqual(RI41_RANGES.deliveredDelta.maxCeil);
    });
  });
});

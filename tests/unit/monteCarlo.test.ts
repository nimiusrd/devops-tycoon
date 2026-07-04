import { describe, expect, it } from 'vitest';
import {
  assertMetricsHealthy,
  assertWithinRange,
  extractRunMetrics,
  runMonteCarlo,
  runMonteCarloSummary,
  summarizeMonteCarlo,
  summarizeNumeric,
  type RunMetrics,
} from './helpers/monteCarlo';
import { RunEngine } from '../../src/sim/run/engine';
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
    /** 代表 seed 群（`${RI15_SEED_PREFIX}-${i}`、i=0..RI15_TRIALS-1）。 */
    const RI15_SEED_PREFIX = 'ri15-mc';
    const RI15_TRIALS = 12;

    /**
     * normal 難易度・既定オートプレイでの許容レンジ。
     * 2026-07 計測（ri15-mc-0..11）を基準に、極端な崩壊検知用へ余裕を持たせる。
     */
    const RI15_RANGES = {
      delivered: { min: 200, max: 8000 },
      rework: { min: 0, max: 55 },
      incidents: { min: 0, max: 50 },
      seniorHp: { min: 0, max: 100 },
      reviewQueuePeak: { min: 10, max: 50 },
    } as const;

    it('normal 難易度の代表 seed 群が主要 KPI の許容レンジ内', () => {
      const summary = runMonteCarloSummary({
        seedPrefix: RI15_SEED_PREFIX,
        trials: RI15_TRIALS,
        difficulty: 'normal',
      });

      expect(summary.settled).toBe(RI15_TRIALS);
      assertWithinRange(summary.delivered, RI15_RANGES.delivered, 'delivered');
      assertWithinRange(summary.rework, RI15_RANGES.rework, 'rework');
      assertWithinRange(summary.incidents, RI15_RANGES.incidents, 'incidents');
      assertWithinRange(summary.seniorHp, RI15_RANGES.seniorHp, 'seniorHp');
      assertWithinRange(summary.reviewQueuePeak, RI15_RANGES.reviewQueuePeak, 'reviewQueuePeak');
    });
  });
});

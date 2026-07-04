/**
 * モンテカルロ統計テスト基盤（RI-14）。
 *
 * 代表 seed を掃引してラン結果を集計し、RI-15〜RI-19 の許容レンジテストで
 * 再利用できる純関数群を提供する。sim 層は変更せず RunEngine の公開 API のみ利用。
 */
import { RunEngine } from '../../../src/sim/run/engine';
import type { DifficultyId, RunState, RunStatus, RunTotals } from '../../../src/sim/run/types';
import { playRun, type PlayOptions } from './runFlow';

/** 1 試行分のラン終了メトリクス（RI-15 以降の許容レンジ検証用）。 */
export interface RunMetrics {
  seed: string;
  status: RunStatus;
  delivered: number;
  rework: number;
  incidents: number;
  seniorHp: number;
  reviewQueuePeak: number;
  sprintsPlayed: number;
  deliveryScore: number;
}

/** 数値メトリクスの集計結果。 */
export interface NumericMetricSummary {
  mean: number;
  min: number;
  max: number;
  /** 各試行の生値（許容レンジ検証・デバッグ用）。 */
  values: number[];
}

/** ランが勝敗確定済みか。 */
export function isSettledStatus(status: RunStatus): boolean {
  return status === 'won' || status === 'lost';
}

/** モンテカルロ試行の集計サマリー。 */
export interface MonteCarloSummary {
  trials: number;
  /** 決着済み試行数（wins + losses）。 */
  settled: number;
  /** 未決着試行数（guardMax 到達など）。 */
  unfinished: number;
  /** 勝利試行数 / 決着済み試行数。未決着のみのとき 0。 */
  winRate: number;
  /** 勝利試行数。 */
  wins: number;
  /** 敗北試行数。 */
  losses: number;
  delivered: NumericMetricSummary;
  rework: NumericMetricSummary;
  incidents: NumericMetricSummary;
  seniorHp: NumericMetricSummary;
  reviewQueuePeak: NumericMetricSummary;
  sprintsPlayed: NumericMetricSummary;
  deliveryScore: NumericMetricSummary;
}

export interface RunMonteCarloOptions {
  /** 試行 seed の接頭辞（各試行は `${seedPrefix}-${i}`）。 */
  seedPrefix: string;
  /** 試行数。 */
  trials: number;
  difficulty?: DifficultyId;
  play?: PlayOptions;
  /** playRun のガード上限。 */
  guardMax?: number;
}

type NumericMetricKey = keyof Omit<RunMetrics, 'seed' | 'status'>;

/** ラン終了状態から統計用メトリクスを抽出する。 */
export function extractRunMetrics(seed: string, state: RunState): RunMetrics {
  return {
    seed,
    status: state.status,
    delivered: state.totals.delivered,
    rework: state.totals.rework,
    incidents: state.totals.incidents,
    seniorHp: state.org.seniorHp,
    reviewQueuePeak: state.totals.reviewQueuePeak,
    sprintsPlayed: state.sprintsPlayed,
    deliveryScore: state.org.deliveryScore,
  };
}

/** 数値配列を集計する。空配列は 0 で埋める。 */
export function summarizeNumeric(values: readonly number[]): NumericMetricSummary {
  if (values.length === 0) {
    return { mean: 0, min: 0, max: 0, values: [] };
  }
  const copy = [...values];
  const sum = copy.reduce((a, b) => a + b, 0);
  return {
    mean: sum / copy.length,
    min: Math.min(...copy),
    max: Math.max(...copy),
    values: copy,
  };
}

/** 試行メトリクス群から集計サマリーを生成する。数値メトリクスは決着済み試行のみ集計。 */
export function summarizeMonteCarlo(results: readonly RunMetrics[]): MonteCarloSummary {
  const wins = results.filter((r) => r.status === 'won').length;
  const losses = results.filter((r) => r.status === 'lost').length;
  const settled = wins + losses;
  const unfinished = results.length - settled;
  const trials = results.length;
  const settledResults = results.filter((r) => isSettledStatus(r.status));

  const pick = (key: NumericMetricKey): NumericMetricSummary =>
    summarizeNumeric(settledResults.map((r) => r[key]));

  return {
    trials,
    settled,
    unfinished,
    winRate: settled === 0 ? 0 : wins / settled,
    wins,
    losses,
    delivered: pick('delivered'),
    rework: pick('rework'),
    incidents: pick('incidents'),
    seniorHp: pick('seniorHp'),
    reviewQueuePeak: pick('reviewQueuePeak'),
    sprintsPlayed: pick('sprintsPlayed'),
    deliveryScore: pick('deliveryScore'),
  };
}

/** seed prefix と試行数で RunEngine を複数回実行し、各試行のメトリクスを返す。 */
export function runMonteCarlo(opts: RunMonteCarloOptions): RunMetrics[] {
  const { seedPrefix, trials, difficulty = 'normal', play = {}, guardMax = 40_000 } = opts;

  if (trials <= 0) {
    throw new Error(`runMonteCarlo: trials は 1 以上である必要があります (got ${trials})`);
  }

  const results: RunMetrics[] = [];
  for (let i = 0; i < trials; i += 1) {
    const seed = `${seedPrefix}-${i}`;
    const engine = new RunEngine({ seed, difficulty });
    const final = playRun(engine, play, guardMax);
    const metrics = extractRunMetrics(seed, final);
    if (!isSettledStatus(metrics.status)) {
      throw new Error(
        `${seed}: ランが決着しませんでした (status=${metrics.status}, phase=${final.phase}, guardMax=${guardMax})`,
      );
    }
    results.push(metrics);
  }
  return results;
}

/** runMonteCarlo + summarizeMonteCarlo のショートカット。 */
export function runMonteCarloSummary(opts: RunMonteCarloOptions): MonteCarloSummary {
  return summarizeMonteCarlo(runMonteCarlo(opts));
}

/** 許容レンジ（min/max 含む）内か検証する。RI-15 以降で使用。 */
export function assertWithinRange(
  summary: NumericMetricSummary,
  range: { min: number; max: number },
  label: string,
): void {
  if (summary.min < range.min || summary.max > range.max) {
    throw new Error(
      `${label}: 許容レンジ [${range.min}, ${range.max}] を外れました ` +
        `(min=${summary.min}, max=${summary.max}, mean=${summary.mean.toFixed(2)})`,
    );
  }
}

/** メトリクスが有限かつ非負（seniorHp 等）であることを検証する。 */
export function assertMetricsHealthy(metrics: RunMetrics): void {
  const numeric: Array<[string, number]> = [
    ['delivered', metrics.delivered],
    ['rework', metrics.rework],
    ['incidents', metrics.incidents],
    ['seniorHp', metrics.seniorHp],
    ['reviewQueuePeak', metrics.reviewQueuePeak],
    ['sprintsPlayed', metrics.sprintsPlayed],
    ['deliveryScore', metrics.deliveryScore],
  ];
  for (const [name, value] of numeric) {
    if (!Number.isFinite(value)) {
      throw new Error(`${metrics.seed}: ${name} が有限値ではありません (${value})`);
    }
    if (value < 0) {
      throw new Error(`${metrics.seed}: ${name} が負です (${value})`);
    }
  }
  if (metrics.status !== 'won' && metrics.status !== 'lost') {
    throw new Error(`${metrics.seed}: status が決着していません (${metrics.status})`);
  }
}

/** RunTotals の主要 KPI を RunMetrics 相当の形で取り出す（スプリント単位検証用）。 */
export function totalsToMetrics(
  totals: RunTotals,
  seniorHp: number,
): Omit<RunMetrics, 'seed' | 'status'> {
  return {
    delivered: totals.delivered,
    rework: totals.rework,
    incidents: totals.incidents,
    seniorHp,
    reviewQueuePeak: totals.reviewQueuePeak,
    sprintsPlayed: 0,
    deliveryScore: 0,
  };
}

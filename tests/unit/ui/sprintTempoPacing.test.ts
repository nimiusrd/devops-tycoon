import { beforeAll, describe, expect, it } from 'vitest';
import type { DifficultyId } from '../../../src/sim/run/types';
import { BOSS_WALL_SEC, SPRINT_WALL_SEC, wallSecondsAt1x } from '../../../src/ui/sprintTempo';
import { runMatrix, type RunLog } from '../../playtest/harness';

/** RI-75 / F-4 の代表3方針。 */
const F4_POLICIES = ['naive', 'skilledNoHire', 'noInterventionCtl'] as const;

/** RI-84 / F-5 は介入以外の条件を揃えた統制と対にして比較する。 */
const F5_POLICIES = [
  'naive',
  'naiveNoInterventionCtl',
  'skilledNoHire',
  'noInterventionCtl',
] as const;

/** RI-75: 全難易度×種別の帯検証対象。 */
const RI75_DIFFICULTIES: readonly DifficultyId[] = ['easy', 'normal', 'hard', 'nightmare'] as const;

/** RI-75: F-4 と同じ playtest seed（結果を見て選ばない）。 */
const RI75_SEEDS = [
  'pt-1',
  'pt-2',
  'pt-3',
  'pt-4',
  'pt-5',
  'pt-6',
  'pt-7',
  'pt-8',
  'pt-9',
  'pt-10',
] as const;

/** RI-84 / F-5: 先頭3スプリントを同一番号で比較する。 */
const F5_SPRINT_NUMBERS = [1, 2, 3] as const;

/** playtest-report.mjs と同じ分位（`round((n-1)*p)`）。F-4 成立判定と揃える。 */
function f4Quantile(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.round((sorted.length - 1) * p)]!;
}

/** playtest-report.mjs と同じ母標準偏差 CV。S1 の共通 seed 比較に使う。 */
function f5Cv(values: readonly number[]): number {
  if (values.length < 2) return NaN;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean === 0) return NaN;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function deliveredBySeed(
  runs: readonly RunLog[],
  difficulty: DifficultyId,
  policy: string,
  sprintNumber: number,
): Map<string, number> {
  const bySeed = new Map<string, number>();
  for (const run of runs) {
    if (run.difficulty !== difficulty || run.policy !== policy) continue;
    const sprint = run.sprints.find((item) => item.quarter === 1 && item.index === sprintNumber);
    if (sprint) bySeed.set(run.seed, sprint.delivered);
  }
  return bySeed;
}

describe('sprintTempo 全難易度ペーシング（RI-75 / F-4、RI-84 / F-5）', () => {
  let runs: RunLog[];

  beforeAll(() => {
    // F-4の3方針に、F-5用の初見統制を加えた総当たりを1回だけ実行する。
    // ローカルは約 200s。GitHub Actions の Vitest 並列負荷では 300s を超えて
    // 同 SHA でも Lint & Unit が割れ落ちする。skip せずフック上限だけ 10 分にする。
    runs = runMatrix([...RI75_DIFFICULTIES], [...F5_POLICIES], [...RI75_SEEDS], 'fresh');
  }, 600_000);

  it('F-4 代表3方針×pt seed で通常・elite・ボスの壁時計帯を満たす', () => {
    const pacingRuns = runs.filter((run) =>
      F4_POLICIES.includes(run.policy as (typeof F4_POLICIES)[number]),
    );
    expect(pacingRuns.length).toBe(
      RI75_DIFFICULTIES.length * F4_POLICIES.length * RI75_SEEDS.length,
    );

    for (const difficulty of RI75_DIFFICULTIES) {
      const sprints = pacingRuns
        .filter((r) => r.difficulty === difficulty)
        .flatMap((r) => r.sprints);
      const normal = sprints
        .filter((s) => s.kind === 'normal')
        .map((s) => wallSecondsAt1x(s.ticks));
      const elite = sprints.filter((s) => s.kind === 'elite').map((s) => wallSecondsAt1x(s.ticks));
      const boss = sprints.filter((s) => s.kind === 'boss').map((s) => wallSecondsAt1x(s.ticks));

      expect(normal.length, `${difficulty} normal samples`).toBeGreaterThan(0);
      expect(boss.length, `${difficulty} boss samples`).toBeGreaterThan(0);

      // p50 だけでなく、早期ドレインした個別ボスも §3.1 の90秒を下回らない。
      for (const sec of boss) {
        expect(sec, `${difficulty} boss wall=${sec}s`).toBeGreaterThanOrEqual(BOSS_WALL_SEC.min);
      }

      for (const sec of normal) {
        expect(sec, `${difficulty} normal wall=${sec}s`).toBeGreaterThanOrEqual(
          SPRINT_WALL_SEC.absoluteMin,
        );
      }
      for (const sec of elite) {
        expect(sec, `${difficulty} elite wall=${sec}s`).toBeGreaterThanOrEqual(
          SPRINT_WALL_SEC.absoluteMin,
        );
      }

      const normalP50 = f4Quantile(normal, 0.5);
      expect(normalP50, `${difficulty} normal p50=${normalP50}`).toBeGreaterThanOrEqual(
        SPRINT_WALL_SEC.minTypical,
      );
      expect(normalP50, `${difficulty} normal p50=${normalP50}`).toBeLessThanOrEqual(
        SPRINT_WALL_SEC.maxTypical,
      );

      // elite も F-4 受入対象。サンプル不足で p50 検証をスキップしない。
      expect(elite.length, `${difficulty} elite samples`).toBeGreaterThanOrEqual(4);
      const eliteP50 = f4Quantile(elite, 0.5);
      expect(eliteP50, `${difficulty} elite p50=${eliteP50}`).toBeGreaterThanOrEqual(
        SPRINT_WALL_SEC.minTypical,
      );
      expect(eliteP50, `${difficulty} elite p50=${eliteP50}`).toBeLessThanOrEqual(
        SPRINT_WALL_SEC.maxTypical,
      );

      const bossP50 = f4Quantile(boss, 0.5);
      const bossP90 = f4Quantile(boss, 0.9);
      expect(bossP50, `${difficulty} boss p50=${bossP50}`).toBeGreaterThanOrEqual(
        BOSS_WALL_SEC.min,
      );
      expect(bossP50, `${difficulty} boss p50=${bossP50}`).toBeLessThanOrEqual(BOSS_WALL_SEC.max);
      expect(bossP90, `${difficulty} boss p90=${bossP90}`).toBeLessThanOrEqual(BOSS_WALL_SEC.max);
      expect(bossP50, `${difficulty} boss p50=${bossP50} vs normal ${normalP50}`).toBeGreaterThan(
        normalP50,
      );
    }
  }, 180_000);

  it('F-5 初見コホートでは、戦術・熟練介入とも先頭3スプリントの出荷ばらつきを抑える', () => {
    const comparisons = [
      { policy: 'naive', control: 'naiveNoInterventionCtl' },
      { policy: 'skilledNoHire', control: 'noInterventionCtl' },
    ] as const;
    let improvedComparisons = 0;

    for (const difficulty of RI75_DIFFICULTIES) {
      for (const sprintNumber of F5_SPRINT_NUMBERS) {
        const valuesByPolicy = new Map(
          F5_POLICIES.map(
            (policy) => [policy, deliveredBySeed(runs, difficulty, policy, sprintNumber)] as const,
          ),
        );

        // 生存状況で seed を選抜せず、事前固定した共通到達コホートを比較する。
        // S3 は敗北前の到達数が減るため、10 seed の40%以上（4本）を必須にする。
        const minSharedSeeds = sprintNumber === 1 ? RI75_SEEDS.length : sprintNumber === 2 ? 7 : 4;
        for (const { policy, control } of comparisons) {
          const policyValues = valuesByPolicy.get(policy)!;
          const controlValues = valuesByPolicy.get(control)!;
          const sharedSeeds = RI75_SEEDS.filter(
            (seed) => policyValues.has(seed) && controlValues.has(seed),
          );
          expect(
            sharedSeeds.length,
            `${difficulty} S${sprintNumber} ${policy}/${control} common seeds`,
          ).toBeGreaterThanOrEqual(minSharedSeeds);

          const controlSamples = sharedSeeds.map((seed) => controlValues.get(seed)!);
          const interventionSamples = sharedSeeds.map((seed) => policyValues.get(seed)!);
          const controlMean =
            controlSamples.reduce((sum, value) => sum + value, 0) / controlSamples.length;
          const interventionMean =
            interventionSamples.reduce((sum, value) => sum + value, 0) / interventionSamples.length;
          const meanRatio = interventionMean / controlMean;
          const controlCv = f5Cv(controlSamples);
          const interventionCv = f5Cv(interventionSamples);
          if (interventionCv < controlCv) improvedComparisons += 1;
          // 4〜10 seed の CV は1 seedの差で数ポイント動くため、同等帯を許容する。
          // RI-77 の出荷価値倍率で hard S3 のばらつきがやや増えるため 4pt まで見る。
          expect(
            interventionCv,
            `${difficulty} S${sprintNumber} ${policy} CV=${interventionCv} vs ${control}=${controlCv}`,
          ).toBeLessThanOrEqual(controlCv + 0.04);
          expect(
            meanRatio,
            `${difficulty} S${sprintNumber} ${policy}/${control} mean ratio=${meanRatio}`,
          ).toBeGreaterThanOrEqual(0.83);
          expect(
            meanRatio,
            `${difficulty} S${sprintNumber} ${policy}/${control} mean ratio=${meanRatio}`,
          ).toBeLessThanOrEqual(1.3);
        }
      }
    }
    expect(improvedComparisons).toBeGreaterThanOrEqual(18);
  });
});
